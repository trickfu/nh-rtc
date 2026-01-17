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

  // Use REACT_APP_SIGNALING_SERVER env var, or fallback to localhost for development
  const socketRef = useRef(
    socketio(process.env.REACT_APP_SIGNALING_SERVER || "http://localhost:9000", {
      autoConnect: false,
    })
  );

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
    console.log("Adding remote track", event.streams);
    if (remoteVideoRef.current && event.streams[0]) {
      remoteVideoRef.current.srcObject = event.streams[0];
    }
  };

  const createPeerConnection = () => {
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
        for (const track of localStream.getTracks()) {
          pc.addTrack(track, localStream);
        }
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
      createPeerConnection();
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
    const socket = socketRef.current;
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
          socket.connect();
          socket.emit("join", { username: localUsername, room: roomName });
        })
        .catch((error) => {
          console.error("Stream not found: ", error);
        });
    };

    const handleReady = () => {
      console.log("Ready to Connect!");
      createPeerConnection();
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
      pcRef.current?.close();
      // Stop local media tracks
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
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

