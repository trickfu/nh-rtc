import { useParams, useNavigate } from "react-router-dom";
import { useRef, useEffect, useState } from "react";
import socketio from "socket.io-client";
import { Rnd } from "react-rnd";
import "./CallScreen.css";

function CallScreen() {
  const params = useParams();
  const localUsername = params.username;
  const roomName = params.room;
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null); // Use ref to persist peer connection across renders
  const pendingCandidates = useRef([]); // Queue for ICE candidates that arrive early
  const socketRef = useRef(null);
  const isConnectedRef = useRef(false); // Track if we've already connected

  const getDefaultRemoteLayout = () => ({
    x: window.innerWidth * 0.05,
    y: window.innerHeight * 0.05,
    width: window.innerWidth * 0.9,
    height: window.innerHeight * 0.75,
  });

  const getDefaultLocalLayout = () => ({
    x: 20,
    y: window.innerHeight - 240,
    width: 200,
    height: 200,
  });

  const [remoteLayout, setRemoteLayout] = useState(getDefaultRemoteLayout());
  const [localLayout, setLocalLayout] = useState(getDefaultLocalLayout());
  const [isResetting, setIsResetting] = useState(false);

  const resetLayout = () => {
    setIsResetting(true);
    setRemoteLayout(getDefaultRemoteLayout());
    setLocalLayout(getDefaultLocalLayout());

    setTimeout(() => {
      setIsResetting(false);
    }, 500);
  };

  const sendData = (data) => {
    socketRef.current.emit("data", {
      username: localUsername,
      room: roomName,
      data: data,
    });
  };

  const onIceCandidate = (event) => {
    if (event.candidate) {
      console.log("Sending ICE candidate");
      sendData({
        type: "candidate",
        candidate: event.candidate,
      });
    }
  };

  const onTrack = (event) => {
    console.log("onTrack fired!", event);
    console.log("Track kind:", event.track.kind);
    console.log("Streams:", event.streams);
    console.log("remoteVideoRef.current:", remoteVideoRef.current);
    if (remoteVideoRef.current && event.streams[0]) {
      console.log("Setting remote video srcObject");
      remoteVideoRef.current.srcObject = event.streams[0];
    } else {
      console.warn("Could not set remote video - ref or stream missing");
    }
  };

  const createPeerConnection = () => {
    // Prevent creating duplicate peer connections (React StrictMode calls useEffect twice)
    if (pcRef.current) {
      console.log("PeerConnection already exists, skipping creation");
      return pcRef.current;
    }

    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      pc.onicecandidate = onIceCandidate;
      pc.ontrack = onTrack;

      // Log connection state changes for debugging
      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
      };
      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState);
      };

      const localStream = localVideoRef.current.srcObject;
      if (localStream) {
        const tracks = localStream.getTracks();
        console.log("Adding local tracks to PC:", tracks.length, "tracks");
        for (const track of tracks) {
          console.log("Adding track:", track.kind, track.id);
          pc.addTrack(track, localStream);
        }
      } else {
        console.warn("No local stream available when creating PC!");
      }
      pcRef.current = pc;
      console.log("PeerConnection created");
      return pc;
    } catch (error) {
      console.error("PeerConnection failed: ", error);
      return null;
    }
  };

  const setAndSendLocalDescription = async (sessionDescription) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setLocalDescription(sessionDescription);
    console.log("Local description set");
    sendData(sessionDescription);
  };

  const sendOffer = async () => {
    const pc = pcRef.current;
    if (!pc) return;
    console.log("Sending offer");
    try {
      const offer = await pc.createOffer();
      await setAndSendLocalDescription(offer);
    } catch (error) {
      console.error("Send offer failed: ", error);
    }
  };

  const sendAnswer = async () => {
    const pc = pcRef.current;
    if (!pc) return;
    console.log("Sending answer");
    try {
      const answer = await pc.createAnswer();
      await setAndSendLocalDescription(answer);
    } catch (error) {
      console.error("Send answer failed: ", error);
    }
  };

  const processPendingCandidates = async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;

    while (pendingCandidates.current.length > 0) {
      const candidate = pendingCandidates.current.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("Added pending ICE candidate");
      } catch (error) {
        console.error("Error adding pending ICE candidate:", error);
      }
    }
  };

  const signalingDataHandler = async (data) => {
    if (data.type === "offer") {
      // Peer connection already created in startConnection
      const pc = pcRef.current;
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        console.log("Remote description set (offer)");
        await processPendingCandidates();
        await sendAnswer();
      } catch (error) {
        console.error("Error handling offer:", error);
      }
    } else if (data.type === "answer") {
      const pc = pcRef.current;
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        console.log("Remote description set (answer)");
        await processPendingCandidates();
      } catch (error) {
        console.error("Error handling answer:", error);
      }
    } else if (data.type === "candidate") {
      const pc = pcRef.current;

      // Queue candidate if remote description not yet set
      if (!pc || !pc.remoteDescription) {
        console.log("Queuing ICE candidate (no remote description yet)");
        pendingCandidates.current.push(data.candidate);
        return;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log("Added ICE candidate");
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    } else {
      console.log("Unknown Data");
    }
  };

  useEffect(() => {
    // Skip if already connected (React StrictMode protection)
    if (isConnectedRef.current) {
      console.log("Already connected, skipping duplicate mount");
      return;
    }
    isConnectedRef.current = true;

    // Create socket for this connection
    const socket = socketio(
      process.env.REACT_APP_SIGNALING_SERVER || "https://webrtc-signallingserver.onrender.com"
    );
    socketRef.current = socket;

    const localVideo = localVideoRef.current;
    let localStream = null;

    const startConnection = () => {
      navigator.mediaDevices
        .getUserMedia({
          audio: true,
          video: {
            height: 350,
            width: 350,
          },
        })
        .then((stream) => {
          console.log("Local Stream found");
          localStream = stream;
          localVideo.srcObject = stream;
          // Create peer connection early so tracks are ready before signaling
          createPeerConnection();
          socket.emit("join", { username: localUsername, room: roomName });
        })
        .catch((error) => {
          console.error("Stream not found: ", error);
        });
    };

    const handleReady = () => {
      console.log("Ready to Connect!");
      // Peer connection already created in startConnection, just send offer
      sendOffer();
    };

    const handleData = (data) => {
      console.log("Data received: ", data);
      signalingDataHandler(data);
    };

    socket.on("ready", handleReady);
    socket.on("data", handleData);

    startConnection();

    return function cleanup() {
      socket.off("ready", handleReady);
      socket.off("data", handleData);
      socket.disconnect();
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      isConnectedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localUsername, roomName]);

  const navigate = useNavigate();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  // cleanup function to stop tracks
  const stopTracks = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    if (pcRef.current) {
      pcRef.current.close();
    }
  };

  const handleEndCall = () => {
    stopTracks();
    navigate('/');
    window.location.reload(); // Ensure clean state ensuring socket disconnect
  };

  return (
    <div className="call-screen-container">
      <div style={{ position: "absolute", top: 20, left: 20, zIndex: 100 }}>
        {/* Optional: Hide labels or keep them based on preference. Keeping for debug for now but styled properly in CSS */}
      </div>

      {/* Remote Video - Large, Top Center */}
      <Rnd
        size={{ width: remoteLayout.width, height: remoteLayout.height }}
        position={{ x: remoteLayout.x, y: remoteLayout.y }}
        onDragStop={(e, d) => {
          setRemoteLayout(prev => ({ ...prev, x: d.x, y: d.y }));
        }}
        onResizeStop={(e, direction, ref, delta, position) => {
          setRemoteLayout({
            width: parseInt(ref.style.width),
            height: parseInt(ref.style.height),
            ...position,
          });
        }}
        bounds="parent"
        style={{ zIndex: 10, transition: isResetting ? "all 0.5s ease" : "none" }}
        enableResizing={true}
        disableDragging={false}
      >
        <div className="video-bubble remote-bubble">
          <video
            autoPlay
            playsInline
            ref={remoteVideoRef}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "20px" }}
          />
        </div>
      </Rnd>

      {/* Local Video - Bottom Left */}
      <Rnd
        size={{ width: localLayout.width, height: localLayout.height }}
        position={{ x: localLayout.x, y: localLayout.y }}
        onDragStop={(e, d) => {
          setLocalLayout(prev => ({ ...prev, x: d.x, y: d.y }));
        }}
        onResizeStop={(e, direction, ref, delta, position) => {
          setLocalLayout({
            width: parseInt(ref.style.width),
            height: parseInt(ref.style.height),
            ...position,
          });
        }}
        bounds="parent"
        style={{ zIndex: 11, transition: isResetting ? "all 0.5s ease" : "none" }}
      >
        <div className="video-bubble local-bubble">
          <video
            autoPlay
            muted
            playsInline
            ref={localVideoRef}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "20px" }}
          />
        </div>
      </Rnd>

      {/* Bottom Control Bar */}
      <div className="control-bar-container">
        <div className="control-bar">
          <button className="reset-btn" onClick={resetLayout} title="Reset Layout">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
          <button className="end-call-btn" onClick={handleEndCall}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 3.75L18 6m0 0l2.25-2.25M18 6l2.25-2.25M18 6l-2.25 2.25m1.5 13.5c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 014.5 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 00-.38 1.21 12.035 12.035 0 007.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 011.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 01-2.25 2.25h-2.25z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default CallScreen;

