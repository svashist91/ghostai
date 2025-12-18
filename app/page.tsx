"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useChatSessions } from "./hooks/useChatSessions";
import Sidebar from "./components/Sidebar";
import ChatInterface from "./components/ChatInterface";
import { createBrowserClient } from "@/utils/supabase/client";
import Link from "next/link";
import { SignedIn, UserButton } from "@clerk/nextjs";
import { FiCreditCard } from "react-icons/fi";

// Speech Recognition types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function Home() {
  const supabase = createBrowserClient();
  
  // --- AUTH STATE ---
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<any>(null);
  
  // --- DRONA STATE ---
  const [mode, setMode] = useState<'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING'>('IDLE');
  const [isPaused, setIsPaused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  
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
  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timestamp}] ${msg}`, ...prev].slice(0, 50)); // Keep last 50 logs
  };

  // --- SESSION VALIDATION ---
  const isValidSession = (sessionId: number): boolean => {
    return sessionId === activeSessionIdRef.current && !isStoppingRef.current;
  };

  // --- AUTH ---
  const handleLogin = async () => {
    addLog('🔐 Attempting login...');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const { data: up, error: upError } = await supabase.auth.signUp({ email, password });
      if (!upError) { 
        setUser(up.user);
        addLog('✅ SignUp Success!');
      } else {
        addLog(`❌ SignUp Error: ${upError.message}`);
      }
    } else {
      setUser(data.user);
      addLog(`✅ Logged in as ${data.user?.email}`);
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
          addLog(`🗣️ Voice detected: "${transcript}"`);
          
          // BARGE-IN: Cancel any ongoing speech
          setMode((currentMode) => {
            if (currentMode === 'SPEAKING') {
              window.speechSynthesis.cancel();
              addLog('🛑 Interrupted speech to listen');
            }
            return currentMode;
          });

          // Process the active query
          processActiveQuery(transcript, currentSessionId);
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
        
        // Auto-restart if not stopped by user
        if (!isStoppingRef.current && !isPaused) {
          try {
            recognition.start();
            addLog('🔄 Auto-restarting recognition...');
          } catch (e) {
            // Already started or error, ignore
          }
        }
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

    // Cancel speech
    window.speechSynthesis.cancel();
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
      window.speechSynthesis.cancel();
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
          
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return;

          // Upload image
          const resImg = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ contentType: 'image/png' })
          }).then(r => r.json());

          await fetch(resImg.url, { 
            method: 'PUT', 
            body: imageBlob, 
            headers: { 'Content-Type': 'image/png' } 
          });

          // Create DB record
          const { data: dbData } = await supabase.from('user_states')
            .insert({ 
              user_id: user.id, 
              text_content: 'Passive Observation...', 
              screen_image_path: resImg.key 
            })
            .select().single();

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
  const processActiveQuery = async (transcript: string, sessionId: number) => {
    if (!isValidSession(sessionId) || !videoRef.current || !user || !currentSessionId) {
      return;
    }

    try {
      setMode('PROCESSING');
      modeRef.current = 'PROCESSING';
      addLog('📸 Capturing screenshot...');

      // Set timeout safety (15 seconds)
      processingTimeoutRef.current = setTimeout(() => {
        if (modeRef.current === 'PROCESSING' && isValidSession(sessionId)) {
          addLog('⏱️ Processing timeout! Resetting...');
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
      }, 15000);

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
      addLog('📸 Screenshot captured');

      canvas.toBlob(async (imageBlob) => {
        if (!imageBlob || !isValidSession(sessionId)) {
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          modeRef.current = 'LISTENING';
          return;
        }
        
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token || !isValidSession(sessionId)) {
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          modeRef.current = 'LISTENING';
          return;
        }

        addLog('☁️ Uploading image...');

        // Upload image
        const resImg = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ contentType: 'image/png' })
        }).then(r => r.json());

        if (!isValidSession(sessionId)) {
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          return;
        }

        await fetch(resImg.url, { 
          method: 'PUT', 
          body: imageBlob, 
          headers: { 'Content-Type': 'image/png' } 
        });

        addLog('💾 Creating database record...');

        // Create DB record
        const { data: dbData } = await supabase.from('user_states')
          .insert({ 
            user_id: user.id, 
            text_content: transcript, 
            screen_image_path: resImg.key 
          })
          .select().single();

        if (!isValidSession(sessionId)) {
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          modeRef.current = 'LISTENING';
          return;
        }

        addLog('🧠 Sending to API...');

        // Call API with text + image
        const resAnalyze = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ 
            s3Key: resImg.key, 
            recordId: dbData.id,
            userPrompt: transcript
          })
        });
        
        if (!isValidSession(sessionId)) {
          if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
          setMode('LISTENING');
          return;
        }

        // Clear timeout on success
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }

        const analysis = await resAnalyze.json();

        if (!resAnalyze.ok || analysis.error) {
          if (isValidSession(sessionId)) {
            addLog(`❌ API Error: ${analysis.error || 'Unknown Error'}`);
            updateSessionMessages(currentSessionId, (prev) => [
              ...prev, 
              { 
                role: "system", 
                content: `Error: ${analysis.error || 'Unknown Error'}` 
              }
            ]);
            speakResponse("I'm sorry, I encountered an error.", sessionId); 
          }
          return;
        }

        if (!isValidSession(sessionId)) {
          return;
        }

        const response = analysis.response || "I am silent."; 
        addLog(`✅ Response received: "${response.substring(0, 30)}..."`);
        
        // Add assistant message to chat
        updateSessionMessages(currentSessionId, (prev) => [
          ...prev, 
          { 
            role: "ai", 
            content: response 
          }
        ]);
        
        speakResponse(response, sessionId);

      }, 'image/png');

    } catch (err: any) {
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      if (isValidSession(sessionId)) {
        addLog(`❌ Process Error: ${err.message}`);
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
  };

  // --- SPEAK RESPONSE ---
  const speakResponse = (text: string, sessionId: number) => {
    if (!isValidSession(sessionId)) {
      return;
    }

    if (!text || text.trim() === "") {
      if (isValidSession(sessionId)) {
        addLog('⚠️ Empty response received');
        setMode('LISTENING');
        modeRef.current = 'LISTENING';
      }
      return;
    }

    setMode('SPEAKING');
    modeRef.current = 'SPEAKING';
    addLog(`🗣️ Speaking: "${text.substring(0, 30)}..."`);
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    
    utterance.onend = () => {
      if (isValidSession(sessionId) && !isStoppingRef.current && !isPaused) {
        addLog('👂 Listening again...');
        setMode('LISTENING');
        modeRef.current = 'LISTENING';
      }
    };
    
    utterance.onerror = () => {
      if (isValidSession(sessionId) && !isStoppingRef.current) {
        addLog('⚠️ Speech error');
        setMode('LISTENING');
        modeRef.current = 'LISTENING';
      }
    };
    
    window.speechSynthesis.speak(utterance);
  };

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
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
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
                    body: JSON.stringify({ contentType: 'image/png' })
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

  // --- CHECK AUTH ON MOUNT ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
      }
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
  }, [supabase]);

  // --- RENDER LOGIN SCREEN ---
  if (!user) {
    return (
      <main className="flex h-screen w-full items-center justify-center bg-[#FAF8F7] font-sans">
        <div className="bg-white rounded-2xl border-2 border-[#EBE6DC] p-8 shadow-lg max-w-md w-full">
          <h1 className="text-3xl font-bold mb-6 text-center text-[#231C16]">
            <span className="text-[#bb601f]">AI</span>&nbsp;Workspace
          </h1>
          <div className="space-y-4">
            <input 
              className="w-full border border-[#EBE6DC] rounded-lg p-3 text-[#231C16]" 
              placeholder="Email" 
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)} 
              suppressHydrationWarning 
            />
            <input 
              className="w-full border border-[#EBE6DC] rounded-lg p-3 text-[#231C16]" 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={e => setPassword(e.target.value)} 
              suppressHydrationWarning 
            />
            <button 
              onClick={handleLogin} 
              className="w-full bg-gradient-to-r from-[#fcab59] to-[#e97d2b] text-white font-bold py-3 rounded-lg shadow-lg hover:from-[#e19655] transition"
            >
              Connect
            </button>
          </div>
        </div>
      </main>
    );
  }

  // --- RENDER MAIN DASHBOARD ---
  return (
    <main className="flex h-screen w-full overflow-hidden relative bg-[#FAF8F7] font-inter text-[#231C16]">
      {/* Hidden video for Drona vision */}
      <video ref={videoRef} className="hidden" muted playsInline></video>

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
          <SignedIn>
            <div className="flex items-center justify-center gap-3 w-full py-2 px-4 rounded-xl bg-white border border-[#ebd6c2] shadow-sm">
              <UserButton afterSignOutUrl="/" />
              <span className="text-sm font-bold text-[#d47e21]">My Account</span>
            </div>
            <Link
              href="/pricing"
              className="flex items-center justify-center gap-2 w-full py-2 px-4 rounded-xl bg-white border border-[#ebd6c2] shadow-sm hover:bg-[#fff9f2] transition text-sm font-bold text-[#d47e21]"
            >
              <FiCreditCard className="w-4 h-4" />
              Subscription
            </Link>
          </SignedIn>
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
            <div className="w-full h-48 bg-black text-green-400 font-mono text-xs p-3 overflow-auto rounded border border-[#EBEBEB]">
              {logs.length === 0 ? (
                <div className="text-gray-600">No logs yet...</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="mb-1 border-b border-gray-800 pb-1 last:border-0">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Bottom: Control Buttons */}
        <div className="mt-auto flex flex-col gap-3">
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
