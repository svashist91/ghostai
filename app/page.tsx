"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useChatSessions } from "./hooks/useChatSessions";
import Sidebar from "./components/Sidebar";
import ChatInterface from "./components/ChatInterface";
import Link from "next/link";
import { FiCreditCard, FiLogOut } from "react-icons/fi";
import { useSession, useUser, useClerk, SignIn } from '@clerk/nextjs';
import { createClerkSupabaseClient } from '@/utils/supabase/client';
import { GoogleGenAI, Modality } from "@google/genai";
import { decode, decodeAudioData } from "../utils/audio-stream";

// Speech Recognition types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function Home() {
  const { session } = useSession();
  const { user } = useUser();
  const { signOut } = useClerk();
  
  // Create the authenticated client
  const supabase = createClerkSupabaseClient(session);
  
  // --- DRONA STATE ---
  const [mode, setMode] = useState<'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING'>('IDLE');
  const [isPaused, setIsPaused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [liveTranscript, setLiveTranscript] = useState("");
  
  // --- REFS ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const passiveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isStoppingRef = useRef(false);
  const modeRef = useRef<'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING'>('IDLE');
  
  // --- SESSION MANAGEMENT ---
  const sessionIdRef = useRef<number>(0);
  const activeSessionIdRef = useRef<number>(0);
  
  // --- INTERACTION TRACKING ---
  const interactionCountRef = useRef<number>(0);
  const queryStartTimeRef = useRef<number>(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // --- AUTH TOKEN CACHE ---
  const latestTokenRef = useRef<string | null>(null);
  
  // --- GEMINI LIVE ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  
  // --- CHAT SESSIONS ---
  const {
    sessions,
    currentSessionId,
    currentMessages,
    createNewSession,
    updateSessionMessages,
    switchToSession,
  } = useChatSessions(() => {});

  // --- LOGGING ---
  const addLog = (message: string, tag?: string, interactionId?: number) => {
    const timestamp = new Date().toLocaleTimeString();
    const intId = interactionId !== undefined ? `[INT-${interactionId}]` : '';
    const tagStr = tag ? `[${tag}]` : '';
    const formattedLog = `[${timestamp}] ${intId} ${tagStr} ${message}`.trim();
    setLogs((prev) => [...prev, formattedLog].slice(-100)); // Keep last 100 logs
  };

  // --- SESSION VALIDATION ---
  const isValidSession = (sessionId: number): boolean => {
    return sessionId === activeSessionIdRef.current && !isStoppingRef.current;
  };

  // --- CONNECT TO GEMINI LIVE ---
  const connectToGemini = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext ||
          (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      const client = new GoogleGenAI({
        apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY,
      });

      // Connect
      const result = await client.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO, Modality.TEXT],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
          },
          systemInstruction: {
            parts: [{
              text: "You are Drona, a helpful and knowledgeable male AI assistant. Speak with a confident, masculine tone. Keep your answers concise and conversational.",
            }],
          },
        },
        callbacks: {
          onopen: () => addLog('🔗 Connected to Gemini Live', 'SYSTEM'),
          onmessage: async (message: any) => {
            const parts = message.serverContent?.modelTurn?.parts || [];
            let hasAudio = false;
            
            for (const part of parts) {
              // Audio Handling
              if (part.inlineData) {
                hasAudio = true;
                try {
                  const audioData = decode(part.inlineData.data);
                  const audioBuffer = await decodeAudioData(
                    audioData,
                    audioContextRef.current!,
                    24000,
                    1
                  );
                  
                  const source = audioContextRef.current!.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(audioContextRef.current!.destination);
                  
                  const currentTime = audioContextRef.current!.currentTime;
                  const startTime = Math.max(currentTime, nextStartTimeRef.current);
                  source.start(startTime);
                  
                  const endTime = startTime + audioBuffer.duration;
                  nextStartTimeRef.current = endTime;
                  
                  // Transition back to LISTENING when audio finishes
                  source.onended = () => {
                    const remainingTime = (endTime - audioContextRef.current!.currentTime) * 1000;
                    if (remainingTime <= 0) {
                      setTimeout(() => {
                        if (modeRef.current === 'SPEAKING' && !isStoppingRef.current && !isPaused) {
                          addLog('🤫 Finished speaking (Ready for next input)', 'TTS');
                          addLog('🔄 Transition: SPEAKING -> LISTENING', 'STATE');
                          setMode('LISTENING');
                          modeRef.current = 'LISTENING';
                        }
                      }, 1000); 
                    }
                  };
                } catch (e) {
                  console.error('Audio decode error:', e);
                }
              }
              
              // Text Handling
              if (part.text) {
                setLiveTranscript(prev => prev + part.text);
                if (currentSessionId) {
                  updateSessionMessages(currentSessionId, (prev) => {
                    const lastMessage = prev[prev.length - 1];
                    if (lastMessage && lastMessage.role === 'ai') {
                      return [...prev.slice(0, -1), { ...lastMessage, content: lastMessage.content + part.text }];
                    } else {
                      return [...prev, { role: 'ai', content: part.text }];
                    }
                  });
                }
              }
            }
            
            // Fallback: If AI sends text but NO audio (rare, but happens)
            if (!hasAudio && parts.length > 0 && modeRef.current === 'SPEAKING') {
               // Use a simple timeout to reset state if no audio arrives
               setTimeout(() => {
                  if (modeRef.current === 'SPEAKING') {
                    setMode('LISTENING');
                    modeRef.current = 'LISTENING';
                  }
               }, 3000);
            }
          },
          onerror: (err: any) => addLog(`❌ Gemini Error: ${err.message}`, 'ERROR'),
        }
      });

      // --- CRITICAL FIX: CHECK RETURN VALUE ---
      console.log("⚠️ DEBUG: Connect returned:", result);
      
      // If the result contains 'session', use that. Otherwise use the result itself.
      // @ts-ignore
      const actualSession = result.session || result; 
      
      sessionRef.current = actualSession;
      
    } catch (error: any) {
      console.error('Gemini Live connection error:', error);
      addLog(`❌ Gemini Live connection failed: ${error.message}`, 'ERROR');
    }
  };

  // --- CAPTURE SCREEN IMAGE ---
  const captureScreenImage = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg");
  }, []);

  // --- START DRONA MODE ---
  const startInteractMode = async () => {
    try {
      if (mode !== 'IDLE') return;

      // Check for Speech Recognition support
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        addLog('❌ Speech Recognition not supported');
        alert('Speech Recognition not supported in this browser');
        return;
      }

      // Increment session ID for fresh start
      sessionIdRef.current += 1;
      activeSessionIdRef.current = sessionIdRef.current;
      const currentSessionId = sessionIdRef.current;

      isStoppingRef.current = false;
      setIsPaused(false);
      addLog('🚀 Starting Drona Interact Mode...');
      
      // Screen Capture
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { width: 1920, height: 1080 } 
      });
      
      if (!isValidSession(currentSessionId)) {
        screenStream.getTracks().forEach(track => track.stop());
        return;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = screenStream;
        videoRef.current.play();
      }
      streamRef.current = screenStream;
      addLog('📹 Screen capture started');
      
      // Stop Handler
      screenStream.getVideoTracks()[0].onended = () => {
        if (!isStoppingRef.current && isValidSession(currentSessionId)) {
          addLog('🛑 Screen share ended');
          stopInteractMode();
        }
      };

      // Initialize Speech Recognition
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      // Handle results
      recognition.onresult = (event: any) => {
        if (!isValidSession(currentSessionId) || isPaused) return;

        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          }
        }

        // If we have a final result, process it
        if (finalTranscript.trim()) {
          const transcript = finalTranscript.trim();
          
          // Check guard clause: if already processing, ignore input
          if (modeRef.current === 'PROCESSING') {
            const currentInteractionId = interactionCountRef.current;
            addLog(`🛑 Ignored input "${transcript}" because Drona is already thinking.`, 'GUARD', currentInteractionId);
            return;
          }
          
          // Start of new interaction: increment counter and set start time
          interactionCountRef.current += 1;
          queryStartTimeRef.current = Date.now();
          const currentInteractionId = interactionCountRef.current;
          
          addLog(`❓ User asked: "${transcript}"`, 'VOICE', currentInteractionId);
          addLog(`🔄 Transition: LISTENING -> PROCESSING`, 'STATE', currentInteractionId);
          
          // BARGE-IN: Cancel any ongoing speech
          setMode((currentMode) => {
            if (currentMode === 'SPEAKING') {
              // Note: Gemini Live handles interruption automatically
              addLog('🛑 Interrupted speech to listen', 'VOICE', currentInteractionId);
            }
            return currentMode;
          });

          // Process the active query
          processActiveQuery(transcript, currentSessionId, currentInteractionId);
        }
      };

      // Handle errors
      recognition.onerror = (event: any) => {
        if (!isValidSession(currentSessionId)) return;
        
        addLog(`⚠️ Recognition error: ${event.error}`);
        
        // Auto-restart if not stopped by user
        if (event.error !== 'no-speech' && event.error !== 'aborted' && !isStoppingRef.current) {
          setTimeout(() => {
            if (isValidSession(currentSessionId) && !isStoppingRef.current && !isPaused) {
              try {
                recognition.start();
                addLog('🔄 Restarting recognition...');
              } catch (e) {
                // Already started, ignore
              }
            }
          }, 1000);
        }
      };

      // Handle start
      recognition.onstart = () => {
        if (isValidSession(currentSessionId)) {
          addLog('👂 Recognition started');
        }
      };

      // Handle end (recognition stopped)
      recognition.onend = () => {
        if (!isValidSession(currentSessionId) || isStoppingRef.current || isPaused) return;
        
        // Watchdog: Restart immediately if we are supposed to be listening
        setTimeout(() => {
          if (!isStoppingRef.current && !isPaused && speechRecognitionRef.current) {
            try {
              recognition.start();
              // Optional: console.log('🔄 Watchdog restart');
            } catch(e) { 
              // Already started or error, ignore
            }
          }
        }, 100);
      };

      // Start recognition
      recognition.start();
      speechRecognitionRef.current = recognition;

      setMode('LISTENING');
      modeRef.current = 'LISTENING';
      addLog('👂 Drona is listening...');
      
      // Start Passive Loop (Background Screenshots)
      startPassiveLoop(currentSessionId);

    } catch (err: any) {
      addLog(`❌ Start Error: ${err.message}`);
      console.error('Start Error:', err);
      stopInteractMode();
    }
  };

  // --- STOP DRONA MODE ---
  const stopInteractMode = () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    
    // Invalidate current session
    sessionIdRef.current += 1;
    addLog('🛑 Stopping Interaction...');
    
    // Clear processing timeout
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
    
    // Kill all timers
    if (passiveIntervalRef.current) {
      clearInterval(passiveIntervalRef.current);
      passiveIntervalRef.current = null;
    }
    
    // Stop Speech Recognition
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
        speechRecognitionRef.current.onresult = null;
        speechRecognitionRef.current.onerror = null;
        speechRecognitionRef.current.onend = null;
        speechRecognitionRef.current.onstart = null;
      } catch (e) {
        // Ignore errors
      }
      speechRecognitionRef.current = null;
    }
    
    // Kill Screen
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => { 
        try { 
          track.stop(); 
          track.onended = null;
        } catch(e){} 
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    // Cancel speech (Gemini Live handles this)
    setMode('IDLE');
    modeRef.current = 'IDLE';
    setIsPaused(false);
    addLog('✅ Stopped');
  };

  // --- PAUSE DRONA MODE ---
  const pauseInteractMode = () => {
    setIsPaused(!isPaused);
    if (isPaused) {
      // Resume
      addLog('▶️ Resuming...');
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.start();
        } catch (e) {
          // Already started, ignore
        }
      }
      setMode('LISTENING');
      modeRef.current = 'LISTENING';
    } else {
      // Pause
      addLog('⏸️ Paused');
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch (e) {
          // Ignore errors
        }
      }
      // Note: Gemini Live handles cancellation
      setMode('IDLE');
      modeRef.current = 'IDLE';
    }
  };

  // --- PASSIVE LOOP (Background Screenshots) ---
  const startPassiveLoop = (sessionId: number) => {
    if (passiveIntervalRef.current) {
      clearInterval(passiveIntervalRef.current);
    }

    const passiveCapture = async () => {
      if (!isValidSession(sessionId) || !videoRef.current || !user) return;
      if (mode === 'PROCESSING' || mode === 'SPEAKING' || isPaused) return;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(videoRef.current, 0, 0);

        canvas.toBlob(async (imageBlob) => {
          if (!imageBlob || !isValidSession(sessionId)) return;
          
          let token = latestTokenRef.current;
          if (!token && session) {
            token = await session.getToken({ template: 'supabase' });
            latestTokenRef.current = token;
          }
          if (!token) return;

          // Upload image
          const resImg = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ 
              contentType: 'image/png',
              sessionId: currentSessionId
            })
          }).then(r => r.json());

          await fetch(resImg.url, { 
            method: 'PUT', 
            body: imageBlob, 
            headers: { 'Content-Type': 'image/png' } 
          });

          // Create DB record
          const { data: dbData, error: dbError } = await supabase.from('user_states')
            .insert({ 
              user_id: user.id, 
              text_content: 'Passive Observation...', 
              screen_image_path: resImg.key 
            })
            .select().single();

          if (dbError || !dbData) {
            // Just log to console for passive loop, no need to alert user
            console.error('Passive DB Insert Error:', dbError);
            return;
          }

          if (!isValidSession(sessionId)) return;

          // Send to API with "Passive Observation" prompt (silent, no chat spam)
          fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ 
              s3Key: resImg.key, 
              recordId: dbData.id,
              userPrompt: 'Passive Observation'
            })
          }).catch(err => console.log('Passive observation:', err));
        }, 'image/png');
      } catch (err: any) {
        if (isValidSession(sessionId)) {
          console.log('Passive capture error:', err.message);
        }
      }
    };

    // Run immediately, then every 10 seconds
    passiveCapture();
    passiveIntervalRef.current = setInterval(passiveCapture, 10000);
  };

  // --- PROCESS ACTIVE QUERY ---
  const processActiveQuery = async (transcript: string, sessionId: number, interactionId: number) => {
    if (!isValidSession(sessionId) || !videoRef.current || !user || !currentSessionId) {
      return;
    }

    // Fix "Awkward Silence" - Wake Word Filter
    const cleanText = transcript.trim().toLowerCase();
    if (cleanText.length < 2 || ['drona', 'hey drona', 'hi', 'hello'].includes(cleanText)) {
      addLog('🚫 Ignoring wake word only', 'SYSTEM', interactionId);
      setMode('LISTENING');
      modeRef.current = 'LISTENING';
      return;
    }

    try {
      setMode('PROCESSING');
      modeRef.current = 'PROCESSING';
      addLog('📸 Capturing screenshot...', 'PROCESS', interactionId);

      // Set timeout safety (12 seconds - fail fast)
      processingTimeoutRef.current = setTimeout(() => {
        if (modeRef.current === 'PROCESSING' && isValidSession(sessionId)) {
          const latency = Date.now() - queryStartTimeRef.current;
          addLog(`⏱️ Processing timeout! Resetting... (Latency: ${latency}ms)`, 'ERROR', interactionId);
          setMode('LISTENING');
          modeRef.current = 'LISTENING';
          updateSessionMessages(currentSessionId, (prev) => [
            ...prev, 
            { 
              role: "system", 
              content: "Error: Request timed out. Please try again." 
            }
          ]);
        }
      }, 12000);

      // Add user message to chat
      updateSessionMessages(currentSessionId, (prev) => [
        ...prev, 
        { 
          role: "user", 
          content: transcript 
        }
      ]);

      // Capture screenshot immediately
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx || !isValidSession(sessionId)) {
        if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
        setMode('LISTENING');
        modeRef.current = 'LISTENING';
        return;
      }
      
      ctx.drawImage(videoRef.current, 0, 0);
      addLog(`📸 Screenshot captured (Size: ${videoRef.current.videoWidth}x${videoRef.current.videoHeight})`, 'PROCESS', interactionId);

      canvas.toBlob(async (imageBlob) => {
        addLog('🔍 Blob created, fetching auth token...', 'PROCESS', interactionId);
        
        if (!imageBlob || !isValidSession(sessionId)) {
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          modeRef.current = 'LISTENING';
          return;
        }
        
        let token = latestTokenRef.current;
        if (!token && session) {
          token = await session.getToken({ template: 'supabase' });
          latestTokenRef.current = token;
        }
        addLog('🔑 Auth token received', 'PROCESS', interactionId);
        
        if (!token || !isValidSession(sessionId)) {
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          modeRef.current = 'LISTENING';
          return;
        }

        addLog('☁️ Uploading image...', 'PROCESS', interactionId);

        // Upload image
        const resImg = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ 
            contentType: 'image/png',
            sessionId: currentSessionId
          })
        }).then(r => r.json());

        if (!isValidSession(sessionId)) {
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          modeRef.current = 'LISTENING';
          return;
        }

        await fetch(resImg.url, { 
          method: 'PUT', 
          body: imageBlob, 
          headers: { 'Content-Type': 'image/png' } 
        });

        addLog('💾 Creating database record...', 'PROCESS', interactionId);

          // Create DB record
          const { data: dbData, error: dbError } = await supabase.from('user_states')
            .insert({ 
              user_id: user.id, 
              text_content: transcript, 
              screen_image_path: resImg.key 
            })
            .select().single();

        if (dbError || !dbData) {
          addLog(`❌ DB Error: ${dbError?.message || 'Insert failed'}`, 'ERROR', interactionId);
          // Clean up and exit
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          modeRef.current = 'LISTENING';
          return;
        }

        if (!isValidSession(sessionId)) {
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          modeRef.current = 'LISTENING';
          return;
        }

        addLog('📡 Connecting to Gemini Live...', 'API', interactionId);

        // Connect to Gemini Live if not already connected
        if (!sessionRef.current) {
          await connectToGemini();
        }

        if (!sessionRef.current) {
          addLog('❌ Failed to connect to Gemini Live', 'ERROR', interactionId);
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          modeRef.current = 'LISTENING';
          return;
        }

        // Convert image to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Image = (reader.result as string).split(',')[1];
          
          // Clear timeout on success
          if (processingTimeoutRef.current) {
            clearTimeout(processingTimeoutRef.current);
            processingTimeoutRef.current = null;
          }

          // Reset transcript for new response
          setLiveTranscript("");

          // 🔴 CRITICAL FIX: reset audio scheduling for this turn
          if (audioContextRef.current) {
            nextStartTimeRef.current = audioContextRef.current.currentTime;
          }
          
          // Clear any existing AI message to start fresh
          if (currentSessionId) {
            updateSessionMessages(currentSessionId, (prev) => {
              // Remove last AI message if it exists
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.role === 'ai') {
                return prev.slice(0, -1);
              }
              return prev;
            });
          }

          // --- SMART SEND LOGIC ---
          try {
            // 1. Safety Check
            if (!sessionRef.current) throw new Error('Session is not connected');

            const session = sessionRef.current;
            let sendFn = session.send;

            // 2. Auto-Fix: If .send() is missing, find the correct method
            if (typeof sendFn !== 'function') {
                // Plan A: Check if it's hidden inside the 'conn' property
                // @ts-ignore
                if (session.conn && typeof session.conn.send === 'function') {
                    // @ts-ignore
                    sendFn = session.conn.send.bind(session.conn);
                    console.log('⚠️ DEBUG: Using session.conn.send()');
                }
                // Plan B: Search the prototype for the correct method name
                else {
                    const proto = Object.getPrototypeOf(session);
                    const methods = Object.getOwnPropertyNames(proto);
                    
                    // Look for any method containing 'send'
                    const candidate = methods.find(m => m.includes('send') && typeof (session as any)[m] === 'function');
                    
                    if (candidate) {
                        // @ts-ignore
                        sendFn = session[candidate].bind(session);
                        console.log(`⚠️ DEBUG: Found method '${candidate}', using it.`);
                    } else {
                        // Plan C: Last resort, log everything to console to debug
                        console.log("⚠️ DEBUG PROTOTYPE:", methods);
                        throw new Error(`SDK Mismatch: No send method found. Own Keys: ${Object.keys(session).join(', ')}`);
                    }
                }
            }

            // 3. Send the message
            // @ts-ignore
            await sessionRef.current.send({
              clientContent: {
                turns: [
                  {
                    role: "user",
                    parts: [
                      { text: transcript },
                      {
                        inlineData: {
                          mimeType: "image/jpeg",
                          data: base64Image,
                        },
                      },
                    ],
                  },
                ],
              },
            });

            addLog('✅ Sent to Gemini Live', 'API', interactionId);
            setMode('SPEAKING');
            modeRef.current = 'SPEAKING';

          } catch (error: any) {
            console.error('Live Send Error:', error);
            addLog(`❌ Live Error: ${error.message}`, 'ERROR', interactionId);
            
            // Cleanup
            if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
            setMode('LISTENING');
            modeRef.current = 'LISTENING';
          }
        }; // End of reader.onloadend
        reader.readAsDataURL(imageBlob);

      }, 'image/png'); // End of canvas.toBlob

    } catch (err: any) { // Catch for outer try
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      if (isValidSession(sessionId)) {
        const latency = Date.now() - queryStartTimeRef.current;
        addLog(`❌ Process Error: ${err.message} (Latency: ${latency}ms)`, 'ERROR', interactionId);
        updateSessionMessages(currentSessionId, (prev) => [
          ...prev, 
          { 
            role: "system", 
            content: `Error: ${err.message}` 
          }
            ]);
        setMode('LISTENING');
        modeRef.current = 'LISTENING';
      }
    }
  }; // End of processActiveQuery


  // --- HANDLE TEXT INPUT (Manual Chat) ---
  const handleSendToAI = useCallback(
    async (manualText?: string) => {
      if (!currentSessionId || !user) return;

      const image = captureScreenImage();
      
      let textToSend = manualText?.trim() || "";
      if (!textToSend) return;

      // Clear input
      setInputValue("");

      // Add user message
      updateSessionMessages(currentSessionId, (prev) => [
        ...prev, 
        { 
          role: "user", 
          content: textToSend 
        }
      ]);

      try {
        let token = latestTokenRef.current;
        if (!token && session) {
          token = await session.getToken({ template: 'supabase' });
          latestTokenRef.current = token;
        }
        if (!token) return;

        // Upload image if available
        let s3Key = null;
        if (image) {
          const canvas = document.createElement('canvas');
          const img = new Image();
          img.src = image;
          await new Promise((resolve) => {
            img.onload = () => {
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              ctx?.drawImage(img, 0, 0);
              canvas.toBlob(async (blob) => {
                if (blob) {
                  const resImg = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ 
                      contentType: 'image/png',
                      sessionId: currentSessionId
                    })
                  }).then(r => r.json());
                  await fetch(resImg.url, { 
                    method: 'PUT', 
                    body: blob, 
                    headers: { 'Content-Type': 'image/png' } 
                  });
                  s3Key = resImg.key;
                }
                resolve(null);
              }, 'image/png');
            };
          });
        }

        // Call analyze API
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ 
            s3Key: s3Key,
            userPrompt: textToSend,
            recordId: null
          }),
        });
        
        const result = await res.json();
        
        if (result && result.response) {
          updateSessionMessages(currentSessionId, (prev) => [
            ...prev, 
            { 
              role: "ai", 
              content: result.response 
            }
          ]);
        }

      } catch (err) {
        console.error("Error sending to AI:", err);
        updateSessionMessages(currentSessionId, (prev) => [
          ...prev, 
          { 
            role: "system", 
            content: "Error: Could not reach AI." 
          }
        ]);
      }
    },
    [currentSessionId, updateSessionMessages, captureScreenImage, user]
  );

  // --- HANDLE SESSION MANAGEMENT ---
  const handleNewChat = useCallback(() => {
    createNewSession();
  }, [createNewSession]);

  const handleSwitchSession = useCallback((sessionId: string) => {
    switchToSession(sessionId);
  }, [switchToSession]);

  // --- EXPORT LOGS ---
  const handleExportLogs = () => {
    if (logs.length === 0) {
      alert("No logs to export!");
      return;
    }
    const element = document.createElement("a");
    const file = new Blob([logs.join("\n")], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `drona_debug_logs_${new Date().getTime()}.txt`;
    document.body.appendChild(element); 
    element.click();
    document.body.removeChild(element);
  };

  // --- HELPER FOR STATUS CIRCLE ---
  const getCircleColor = () => {
    if (mode === 'LISTENING') return 'bg-green-100 border-4 border-green-500 animate-pulse';
    if (mode === 'PROCESSING') return 'bg-yellow-100 border-4 border-yellow-500';
    if (mode === 'SPEAKING') return 'bg-blue-100 border-4 border-blue-500';
    return 'bg-gray-100 border-4 border-gray-300';
  };

  // --- CLEANUP ON UNMOUNT ---
  useEffect(() => {
    return () => {
      stopInteractMode();
    };
  }, []);

  // --- AUTO-SCROLL LOGS ---
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // --- BACKGROUND TOKEN REFRESH ---
  useEffect(() => {
    if (!session) return;

    const fetchToken = async () => {
      try {
        const token = await session.getToken({ template: 'supabase' });
        latestTokenRef.current = token;
      } catch (e) {
        console.error('Token refresh failed', e);
      }
    };

    fetchToken(); // Initial fetch
    const interval = setInterval(fetchToken, 55000); // Refresh every 55s

    return () => clearInterval(interval);
  }, [session]);

  // --- RENDER LOGIN SCREEN ---
  if (!user) {
    return (
      <main className="flex h-screen w-full items-center justify-center bg-[#FAF8F7] font-sans">
        <div className="flex items-center justify-center w-full">
          <SignIn />
        </div>
      </main>
    );
  }

  // --- RENDER MAIN DASHBOARD ---
  return (
    <main className="flex h-screen w-full overflow-hidden relative bg-[#FAF8F7] font-inter text-[#231C16]">
      {/* Hidden video for Drona vision */}
      <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-1 h-1" muted playsInline></video>

      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSwitchSession={handleSwitchSession}
        onNewChat={handleNewChat}
      />

      <ChatInterface
        messages={currentMessages}
        inputValue={inputValue}
        setInputValue={setInputValue}
        onSend={(text) => handleSendToAI(text)}
        listeningStatus={mode.toLowerCase()}
        transcript=""
      />

      {/* Right Panel: Account, Drona Status & Controls */}
      <aside className="w-[265px] flex flex-col px-7 py-10 bg-[#F3F2F1] h-full border-l border-[#EBEBEB] gap-6 font-sans">
        {/* Top: Account & Subscription */}
        <div className="flex flex-col gap-2">
          {/* Account / Sign Out */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-[#ebd6c2] shadow-sm">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                {user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() || user?.emailAddresses[0]?.emailAddress?.[0]?.toUpperCase() || 'U'}
              </div>
              <span className="text-sm font-bold text-[#d47e21] truncate max-w-[100px]">
                {user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || 'User'}
              </span>
            </div>
            <button 
              onClick={() => signOut()}
              className="text-xs text-red-500 hover:text-red-700 font-semibold underline flex items-center gap-1"
            >
              <FiLogOut className="w-3 h-3" />
              Sign Out
            </button>
          </div>

          {/* Subscription Link */}
          <Link
            href="/pricing"
            className="flex items-center justify-center gap-2 w-full py-2 px-4 rounded-xl bg-white border border-[#ebd6c2] shadow-sm hover:bg-[#fff9f2] transition text-sm font-bold text-[#d47e21]"
          >
            <FiCreditCard className="w-4 h-4" />
            Subscription
          </Link>
        </div>

        {/* Middle: Drona Status Indicator & Debug Logs */}
        <div className="flex-1 flex flex-col items-center justify-center border-t border-b border-[#EBEBEB] py-6 gap-4">
          {/* Status Circle */}
          <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${getCircleColor()}`}>
            <div className="text-4xl">
              {mode === 'LISTENING' && '👂'}
              {mode === 'PROCESSING' && '🧠'}
              {mode === 'SPEAKING' && '🗣️'}
              {mode === 'IDLE' && '⏸️'}
            </div>
          </div>
          
          {/* Status Text */}
          <p className="font-bold text-gray-600 text-center text-sm">
            {mode === 'LISTENING' && "I'm listening..."}
            {mode === 'PROCESSING' && "Thinking..."}
            {mode === 'SPEAKING' && "Speaking..."}
            {mode === 'IDLE' && "Idle"}
          </p>

          {/* Debug Logs */}
          <div className="w-full">
            <div className="text-[10px] font-bold uppercase tracking-wide text-[#B6B0A5] mb-2">Debug Logs</div>
            <div className="w-full h-64 bg-black text-green-400 font-mono text-xs p-3 overflow-y-auto rounded border border-[#EBEBEB]">
              {logs.length === 0 ? (
                <div className="text-gray-600">No logs yet...</div>
              ) : (
                logs.map((log, i) => {
                  // Color-code tags
                  let coloredLog = log;
                  if (log.includes('[API]')) {
                    coloredLog = log.replace('[API]', '<span class="text-yellow-400">[API]</span>');
                  } else if (log.includes('[VOICE]')) {
                    coloredLog = log.replace('[VOICE]', '<span class="text-blue-400">[VOICE]</span>');
                  } else if (log.includes('[ERROR]') || log.includes('[GUARD]')) {
                    coloredLog = log.replace(/\[(ERROR|GUARD)\]/g, '<span class="text-red-400">[$1]</span>');
                  } else if (log.includes('[TTS]')) {
                    coloredLog = log.replace('[TTS]', '<span class="text-cyan-400">[TTS]</span>');
                  } else if (log.includes('[STATE]')) {
                    coloredLog = log.replace('[STATE]', '<span class="text-purple-400">[STATE]</span>');
                  } else if (log.includes('[AI]')) {
                    coloredLog = log.replace('[AI]', '<span class="text-green-300">[AI]</span>');
                  } else if (log.includes('[PROCESS]')) {
                    coloredLog = log.replace('[PROCESS]', '<span class="text-orange-400">[PROCESS]</span>');
                  }
                  
                  return (
                    <div 
                      key={i} 
                      className="mb-1 border-b border-gray-800 pb-1 last:border-0"
                      dangerouslySetInnerHTML={{ __html: coloredLog }}
                    />
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>

        {/* Bottom: Control Buttons */}
        <div className="mt-auto flex flex-col gap-3">
          {/* Live Transcript Display */}
          <div className="p-4 bg-gray-900 text-green-400 font-mono h-32 overflow-y-auto border border-gray-700 rounded mb-4">
            {liveTranscript || <span className="text-gray-600">Waiting for response...</span>}
          </div>
          {/* --- NEW EXPORT BUTTON --- */}
          <button 
            onClick={handleExportLogs}
            className="text-[10px] uppercase font-bold text-gray-400 hover:text-gray-600 tracking-wide self-center mb-2"
          >
            ⬇ Export Logs
          </button>
          <button 
            className={`w-full font-bold flex items-center justify-center gap-2 rounded-full py-4 text-white shadow-lg transition
              ${mode === 'IDLE' 
                ? "bg-gradient-to-r from-[#fcab59] to-[#e97d2b] hover:from-[#e19655]" 
                : "bg-red-500 hover:bg-red-600"}`}
            onClick={mode === 'IDLE' ? startInteractMode : stopInteractMode}
          >
            <div className={`w-2.5 h-2.5 bg-white rounded-full mr-2 ${mode === 'IDLE' ? "animate-pulse" : ""}`}></div>
            {mode === 'IDLE' ? 'Start Recording' : 'Stop'}
          </button>
          <div className="flex gap-2.5">
            <button 
              onClick={pauseInteractMode} 
              disabled={mode === 'IDLE'}
              className="flex-1 py-3 bg-[#faf8f7] border border-[#e9e2da] rounded-full font-bold text-[#b09572] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f5f3f0] transition"
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}