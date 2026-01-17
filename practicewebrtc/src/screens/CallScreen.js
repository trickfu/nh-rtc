import { useParams } from "react-router-dom";
import { useRef, useEffect } from "react";
import socketio from "socket.io-client";
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

  return (
    <div>
      <label>{"Username: " + localUsername}</label>
      <label>{"Room Id: " + roomName}</label>
      <video autoPlay muted playsInline ref={localVideoRef} />
      <video autoPlay playsInline ref={remoteVideoRef} />
    </div>
  );
}

export default CallScreen;

