import React, { Suspense, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackgroundAlt } from '../components/BackgroundAlt';
import { HeroAlt } from '../components/HeroAlt';
import { analyzeText } from '../services/aiService';

const HomeAlt = () => {
    const navigate = useNavigate();
    const [audioStream, setAudioStream] = useState(null);
    const [transcript, setTranscript] = useState('');
    const [entityData, setEntityData] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState(null);
    const [inputMode, setInputMode] = useState(null); // 'voice', 'text', or null

    // Refs to avoid closure staleness issues in callbacks
    const recognitionRef = useRef(null);
    const audioStreamRef = useRef(null);
    const silenceTimer = useRef(null);
    const transcriptRef = useRef(''); // Keep track of latest transcript for onend

    // Check for API Key on mount
    useEffect(() => {
        if (!process.env.REACT_APP_OPENROUTER_API_KEY) {
            console.warn("WARNING: REACT_APP_OPENROUTER_API_KEY is not set!");
            setError("Missing API Key. Check console.");
        } else {
            console.log("API Key found.");
        }

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                stopEverything();
                setTranscript('');
                transcriptRef.current = '';
                setInputMode(null);
                setError(null);
                setEntityData(null);
                return;
            }

            // Should not type if:
            // 1. Analyzing
            // 2. Microphone is active (voice mode)
            // 3. Error state
            // 4. Entity data is showing
            if (isAnalyzing || audioStreamRef.current || error || entityData) return;

            if (e.key === 'Enter') {
                e.preventDefault();
                if (transcriptRef.current.trim()) {
                    performAnalysis(transcriptRef.current);
                }
                return;
            }

            // Backspace handling moved inside explicit typing check or separate block if needed based on inputMode
            // For now, if we are in text mode (which is determined by state), Backspace works.
            // But here we are in the block where specific states return early.

            // Re-implementing Backspace/Typing logic to be cleaner with the new Escape priority

            if (e.key === 'Backspace') {
                setInputMode('text');
                setTranscript(prev => {
                    const next = prev.slice(0, -1);
                    transcriptRef.current = next;
                    if (next === '') setInputMode(null); // Return to idle if empty
                    return next;
                });
                return;
            }

            // Regular typing (allow letters, numbers, punctuation, space)
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Determine if we should start text mode
                if (!audioStreamRef.current && !entityData && !error) {
                    setInputMode('text');
                    setTranscript(prev => {
                        const next = prev + e.key;
                        transcriptRef.current = next;
                        return next;
                    });
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isAnalyzing, error, entityData]); // Dependencies for the effect closure

    const stopEverything = () => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            recognitionRef.current = null; // Clear the ref after stopping
        }
        if (audioStreamRef.current) {
            audioStreamRef.current.getTracks().forEach(track => track.stop());
            setAudioStream(null); // Update state
            audioStreamRef.current = null; // Clear the ref
        }
        if (silenceTimer.current) {
            clearTimeout(silenceTimer.current);
            silenceTimer.current = null;
        }
    };

    const performAnalysis = async (text) => {
        if (!text || isAnalyzing) return;

        console.log("Performing analysis on:", text);
        stopEverything(); // Stop recognition and audio before analysis
        setIsAnalyzing(true);
        setError(null); // Clear previous errors

        try {
            const result = await analyzeText(text);
            console.log("Analysis result:", result);
            if (result) {
                setEntityData(result);
            } else {
                throw new Error("No result from AI");
            }
        } catch (error) {
            console.error("Analysis failed:", error);
            setError(error.message || "Analysis Failed");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleAudioAccess = async () => {
        if (audioStream) return; // Check state for UI feedback

        // Reset state for new session
        setError(null);
        setEntityData(null);
        setTranscript('');
        transcriptRef.current = '';

        try {
            setInputMode('voice');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setAudioStream(stream); // Update state
            audioStreamRef.current = stream; // Update ref

            // Initialize Speech Recognition
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onresult = (event) => {
                    if (silenceTimer.current) clearTimeout(silenceTimer.current);

                    let interimTranscript = '';
                    let finalTranscript = '';

                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalTranscript += event.results[i][0].transcript;
                        } else {
                            interimTranscript += event.results[i][0].transcript;
                        }
                    }

                    const currentText = finalTranscript || interimTranscript;
                    if (currentText) {
                        // Update visible transcript
                        setTranscript(currentText);
                        transcriptRef.current = currentText; // Update ref

                        if (finalTranscript) {
                            console.log("Final transcript triggered:", finalTranscript);
                            performAnalysis(finalTranscript);
                        } else {
                            // Set silence timer
                            silenceTimer.current = setTimeout(() => {
                                console.log("Silence timeout triggered:", interimTranscript);
                                performAnalysis(interimTranscript);
                            }, 2000); // 2 seconds silence
                        }
                    }
                };

                // Failsafe: if recognition stops for any reason (browser decides), analyze what we have
                recognition.onend = () => {
                    console.log("Recognition ended. Checking if we need to analyze...");
                    const current = transcriptRef.current;
                    // Guard against double submission: check if we are analyzing, or if we have error, or if we have entity data
                    if (isAnalyzing || error || entityData) return;

                    // If we have text, but no entity data yet, and we aren't already analyzing
                    if (current && !audioStreamRef.current) {
                        // If we already stopped audio, we probably already triggered analysis or user canceled.
                    } else if (current) {
                        console.log("onend triggered analysis on:", current);
                        performAnalysis(current);
                    }
                };

                recognition.onerror = (event) => {
                    console.error("Speech recognition error", event.error);
                    if (event.error !== 'no-speech' && event.error !== 'aborted') {
                        setError("Speech Error: " + event.error);
                        stopEverything();
                    }
                };

                recognition.start();
                recognitionRef.current = recognition;
            }

        } catch (error) {
            console.error("Error accessing audio:", error);
            setError("Mic Error: " + error.message);
        }
    };

    // Cleanup
    useEffect(() => {
        return () => {
            stopEverything();
        };
    }, []); // Empty dependency array means this runs once on mount and once on unmount

    return (
        <div
            className={`relative w-full h-screen overflow-hidden bg-[#020202] flex flex-col ${!audioStream && !entityData && !isAnalyzing && !error && inputMode !== 'text' ? 'cursor-pointer' : ''}`}
            onClick={!audioStream && !entityData && !isAnalyzing && !error && inputMode !== 'text' ? handleAudioAccess : undefined}
        >
            {/* Debug Navigation Button */}
            <div className="absolute top-6 right-6 z-50 pointer-events-auto">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate('/call/debug-user/debug-room');
                    }}
                    className="px-6 py-2 bg-white/5 hover:bg-purple-500/20 text-white/40 hover:text-white rounded-full backdrop-blur-md border border-white/5 hover:border-purple-500/30 transition-all duration-300 text-xs tracking-[0.2em] font-light uppercase"
                >
                    Debug Call
                </button>
            </div>

            <div className="absolute inset-0 z-0">
                <Suspense fallback={<div className="w-full h-full bg-black flex items-center justify-center text-white">Initializing Engine...</div>}>
                    <BackgroundAlt audioStream={audioStream} inputMode={inputMode} />
                </Suspense>
            </div>

            <div className="relative z-10 w-full h-full flex flex-col items-center justify-center pointer-events-none">
                <main className="pointer-events-auto">
                    <HeroAlt
                        isActive={!!audioStream || !!entityData || isAnalyzing || !!error || inputMode === 'text'}
                        transcript={transcript}
                        entityData={entityData}
                        isAnalyzing={isAnalyzing}
                        error={error}
                        inputMode={inputMode}
                    />
                </main>
            </div>

            {/* Click to Speak Overlay */}
            {!audioStream && !entityData && !isAnalyzing && !error && inputMode !== 'text' && (
                <div className="absolute bottom-12 left-0 w-full flex justify-center items-center z-20 pointer-events-auto h-6 group cursor-pointer">
                    <span className="absolute text-sm tracking-[0.3em] uppercase transition-colors duration-500 text-white/70 group-hover:text-white animate-text-cycle-1">
                        Click to Speak
                    </span>
                    <span className="absolute text-sm tracking-[0.3em] uppercase transition-colors duration-500 text-white/70 group-hover:text-white animate-text-cycle-2">
                        Start Typing
                    </span>
                </div>
            )}

            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.6)_100%)]"></div>

            <style>{`
                @keyframes textCycle1 {
                    0%, 45% { opacity: 1; filter: blur(0px); }
                    55%, 95% { opacity: 0; filter: blur(4px); }
                    100% { opacity: 1; filter: blur(0px); }
                }
                @keyframes textCycle2 {
                    0%, 45% { opacity: 0; filter: blur(4px); }
                    55%, 95% { opacity: 1; filter: blur(0px); }
                    100% { opacity: 0; filter: blur(4px); }
                }
                .animate-text-cycle-1 {
                    animation: textCycle1 6s infinite ease-in-out;
                }
                .animate-text-cycle-2 {
                    animation: textCycle2 6s infinite ease-in-out;
                }
            `}</style>
        </div>
    );
};

export default HomeAlt;
