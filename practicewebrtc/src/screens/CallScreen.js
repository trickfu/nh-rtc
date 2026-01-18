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
  const localBubbleRef = useRef(null);
  const remoteBubbleRef = useRef(null);
  const localAudioContextRef = useRef(null);
  const remoteAudioContextRef = useRef(null);
  const pcRef = useRef(null); // Use ref to persist peer connection across renders
  const pendingCandidates = useRef([]); // Queue for ICE candidates that arrive early
  const socketRef = useRef(null);
  const isConnectedRef = useRef(false); // Track if we've already connected
  const isLocalMutedRef = useRef(false); // Track mute state for analyzer

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

  const getDefaultTranscriptionLayout = () => ({
    x: window.innerWidth - 320,
    y: 100,
    width: 300,
    height: 400,
  });

  const [remoteLayout, setRemoteLayout] = useState(getDefaultRemoteLayout());
  const [localLayout, setLocalLayout] = useState(getDefaultLocalLayout());
  const [transcriptionLayout, setTranscriptionLayout] = useState(getDefaultTranscriptionLayout());
  const [transcripts, setTranscripts] = useState([]);
  const [isResetting, setIsResetting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const recognitionRef = useRef(null);

  // Sync ref with state to ensure audio analysis respects mute
  useEffect(() => {
    isLocalMutedRef.current = isMuted;
  }, [isMuted]);

  const resetLayout = () => {
    setIsResetting(true);
    setRemoteLayout(getDefaultRemoteLayout());
    setLocalLayout(getDefaultLocalLayout());
    setTranscriptionLayout(getDefaultTranscriptionLayout());

    setTimeout(() => {
      setIsResetting(false);
    }, 500);
  };

  const toggleMute = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      const audioTracks = localVideoRef.current.srcObject.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
      isLocalMutedRef.current = !isMuted; // Update ref immediately for visualizer
      console.log("Muted toggled, ref set to:", !isMuted);
    }
  };

  const toggleTranscript = () => {
    setShowTranscript(!showTranscript);
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

  const setupAudioAnalysis = (stream, bubbleRef, isLocal = false) => {
    if (!stream || !stream.getAudioTracks().length) return null;

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      // Clone stream to avoid interfering with playback/sending
      const analysisStream = stream.clone();
      const source = audioContext.createMediaStreamSource(analysisStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateVolume = () => {
        if (audioContext.state === "closed") return;

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        // Visual Effects
        // Volume is 0-255. Normalize somewhat.
        let intensity = average / 255;

        // If this is the local stream and we are muted, force intensity to 0
        if (isLocal && isLocalMutedRef.current) {
          // console.log("Local mute active, forcing 0, isLocal:", isLocal, "ref:", isLocalMutedRef.current);
          intensity = 0;
        }

        if (bubbleRef.current) {
          // Apply glow if audio is detected above noise floor
          if (intensity > 0.05) {
            const spread = 10 + (intensity * 40);
            const alpha = 0.4 + (intensity * 0.6);
            // Purple/Blue metaverse glow
            bubbleRef.current.style.boxShadow = `0 0 ${spread}px ${intensity * 10}px rgba(138, 43, 226, ${alpha})`;
            bubbleRef.current.style.border = `2px solid rgba(138, 43, 226, ${alpha})`;
          } else {
            // Default state
            bubbleRef.current.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.2)';
            bubbleRef.current.style.border = '2px solid transparent';
          }
        }
        requestAnimationFrame(updateVolume);
      };
      updateVolume();
      return audioContext;
    } catch (error) {
      console.error("Audio analysis setup failed:", error);
      return null;
    }
  };

  const setupSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition API not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        setTranscripts((prev) => [
          ...prev,
          { sender: "You", text: finalTranscript, timestamp: new Date() },
        ]);
        // Ideally emit this to socket so other peer sees it too
        // sendData({ type: "transcript", text: finalTranscript }); 
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
    };

    recognition.onend = () => {
      // Auto-restart if it stops unexpectedly?
      // For now, let's just log it.
      // console.log("Speech recognition ended");
      // if (isConnectedRef.current) recognition.start();
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const onTrack = (event) => {
    console.log("onTrack fired!", event);
    console.log("Track kind:", event.track.kind);
    console.log("Streams:", event.streams);
    console.log("remoteVideoRef.current:", remoteVideoRef.current);
    if (remoteVideoRef.current && event.streams[0]) {
      console.log("Setting remote video srcObject");
      remoteVideoRef.current.srcObject = event.streams[0];

      // Setup remote audio analysis
      if (remoteAudioContextRef.current) remoteAudioContextRef.current.close();
      remoteAudioContextRef.current = setupAudioAnalysis(event.streams[0], remoteBubbleRef);
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
          // Setup local audio analysis
          localAudioContextRef.current = setupAudioAnalysis(stream, localBubbleRef, true);
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

    setupSpeechRecognition();
    startConnection();

    return function cleanup() {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
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
      if (localAudioContextRef.current) localAudioContextRef.current.close();
      if (remoteAudioContextRef.current) remoteAudioContextRef.current.close();
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
        <div className="video-bubble remote-bubble" ref={remoteBubbleRef} style={{ transition: "box-shadow 0.1s ease, border-color 0.1s ease", border: "2px solid transparent" }}>
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
        <div className="video-bubble local-bubble" ref={localBubbleRef} style={{ transition: "box-shadow 0.1s ease, border-color 0.1s ease", border: "2px solid transparent", position: "relative" }}>
          <video
            autoPlay
            muted
            playsInline
            ref={localVideoRef}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "20px" }}
          />
          {isMuted && (
            <div style={{
              position: "absolute",
              top: "10px",
              right: "10px",
              backgroundColor: "rgba(0, 0, 0, 0.6)",
              borderRadius: "50%",
              padding: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(4px)"
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="white" style={{ width: "20px", height: "20px" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4m-3 0h6" />
              </svg>
            </div>
          )}
        </div>
      </Rnd>

      {/* Transcription Bubble */}
      {showTranscript && (
        <Rnd
          size={{ width: transcriptionLayout.width, height: transcriptionLayout.height }}
          position={{ x: transcriptionLayout.x, y: transcriptionLayout.y }}
          onDragStop={(e, d) => {
            setTranscriptionLayout(prev => ({ ...prev, x: d.x, y: d.y }));
          }}
          onResizeStop={(e, direction, ref, delta, position) => {
            setTranscriptionLayout({
              width: parseInt(ref.style.width),
              height: parseInt(ref.style.height),
              ...position,
            });
          }}
          bounds="parent"
          style={{ zIndex: 12, transition: isResetting ? "all 0.5s ease" : "none" }}
        >
          <div className="transcription-bubble">
            {transcripts.length === 0 ? (
              <div style={{ opacity: 0.5, fontStyle: 'italic' }}>Conversation transcript will appear here...</div>
            ) : (
              transcripts.map((t, i) => (
                <div key={i} className="transcription-line">
                  <span className="transcription-sender">{t.sender}:</span>
                  {t.text}
                </div>
              ))
            )}
          </div>
        </Rnd>
      )}

      {/* Bottom Control Bar */}
      <div className="control-bar-container">
        <div className="control-bar">
          <button className="reset-btn" onClick={resetLayout} title="Reset Layout">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
          <button className="transcript-btn" onClick={toggleTranscript} title={showTranscript ? "Hide Transcript" : "Show Transcript"} style={{ backgroundColor: showTranscript ? "#3b82f6" : undefined }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          </button>
          <button className="mute-btn" onClick={toggleMute} title={isMuted ? "Unmute" : "Mute"} style={{ backgroundColor: isMuted ? "#ef4444" : undefined }}>
            {isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="white" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4m-3 0h6" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>
          <button className="end-call-btn" onClick={handleEndCall}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 3.75L18 6m0 0l2.25-2.25M18 6l2.25-2.25M18 6l-2.25 2.25m1.5 13.5c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 014.5 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 00-.38 1.21 12.035 12.035 0 007.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 011.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 01-2.25 2.25h-2.25z" />
            </svg>
          </button>
        </div>
      </div >
    </div >
  );
}

export default CallScreen;

