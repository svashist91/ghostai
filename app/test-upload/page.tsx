'use client';

import { useState, useRef, useEffect } from 'react';
import { createBrowserClient } from '@/utils/supabase/client'; 

// Speech Recognition types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function DronaLab() {
  const supabase = createBrowserClient();
  
  // --- STATE ---
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<any>(null);
  
  const [mode, setMode] = useState<'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING'>('IDLE');
  const [logs, setLogs] = useState<string[]>([]);
  const [lastAnalysis, setLastAnalysis] = useState('');
  
  // --- REFS ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);      
  
  const speechRecognitionRef = useRef<any>(null);
  const passiveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isStoppingRef = useRef(false);

  // --- SESSION MANAGEMENT ---
  const sessionIdRef = useRef<number>(0);
  const activeSessionIdRef = useRef<number>(0);
  
  const addLog = (msg: string, type: 'system' | 'user' | 'drona' = 'system') => {
    const prefix = type === 'user' ? '🗣️' : type === 'drona' ? '🤖' : '⚙️';
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${prefix} ${msg}`, ...prev]);
  };

  // --- SESSION VALIDATION ---
  const isValidSession = (sessionId: number): boolean => {
    return sessionId === activeSessionIdRef.current && !isStoppingRef.current;
  };

  // --- 1. AUTH ---
  const handleLogin = async () => {
    addLog('Attempting Login...');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const { data: up, error: upError } = await supabase.auth.signUp({ email, password });
      if (!upError) { setUser(up.user); addLog('✅ SignUp Success!'); }
    } else {
      setUser(data.user);
      addLog(`✅ Logged in as ${data.user?.email}`);
    }
  };

  // --- 2. START ---
  const startInteractMode = async () => {
    try {
      if (mode !== 'IDLE') return; 

      // Check for Speech Recognition support
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        addLog('❌ Speech Recognition not supported in this browser');
        return;
      }

      // Increment session ID for fresh start
      sessionIdRef.current += 1;
      activeSessionIdRef.current = sessionIdRef.current;
      const currentSessionId = sessionIdRef.current;

      addLog('🚀 Starting Drona Interact Mode...');
      isStoppingRef.current = false;
      
      // Screen
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1920, height: 1080 } });
      if (!isValidSession(currentSessionId)) {
        screenStream.getTracks().forEach(track => track.stop());
        return;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = screenStream;
        videoRef.current.play();
      }
      streamRef.current = screenStream;
      
      // Stop Handler
      screenStream.getVideoTracks()[0].onended = () => {
          if (!isStoppingRef.current && isValidSession(currentSessionId)) {
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
        if (!isValidSession(currentSessionId)) return;

        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        // If we have a final result, process it
        if (finalTranscript.trim()) {
          const transcript = finalTranscript.trim();
          addLog(`You said: ${transcript}`, 'user');
          
          // BARGE-IN: Cancel any ongoing speech (check current mode state)
          setMode((currentMode) => {
            if (currentMode === 'SPEAKING') {
              window.speechSynthesis.cancel();
              addLog('🛑 Interrupted speech to listen', 'system');
            }
            return currentMode; // Don't change mode here, processActiveQuery will handle it
          });

          // Process the active query
          processActiveQuery(transcript, currentSessionId);
        }
      };

      // Handle errors
      recognition.onerror = (event: any) => {
        if (!isValidSession(currentSessionId)) return;

        addLog(`⚠️ Recognition error: ${event.error}`, 'system');
        
        // Auto-restart if not stopped by user
        if (event.error !== 'no-speech' && event.error !== 'aborted' && !isStoppingRef.current) {
          setTimeout(() => {
            if (isValidSession(currentSessionId) && !isStoppingRef.current) {
              try {
                recognition.start();
                addLog('🔄 Restarting recognition...', 'system');
              } catch (e) {
                // Already started, ignore
              }
            }
          }, 1000);
        }
      };

      // Handle end (recognition stopped)
      recognition.onend = () => {
        if (!isValidSession(currentSessionId) || isStoppingRef.current) return;
        
        // Auto-restart if not stopped by user
        if (!isStoppingRef.current) {
          try {
            recognition.start();
          } catch (e) {
            // Already started or error, ignore
          }
        }
      };

      // Start recognition
      recognition.start();
      speechRecognitionRef.current = recognition;

      setMode('LISTENING');
      addLog('👂 Drona is listening... (Speak now)', 'drona');
      
      // Start Passive Loop (Background Screenshots)
      startPassiveLoop(currentSessionId);

    } catch (err: any) {
      addLog(`❌ Start Error: ${err.message}`);
      stopInteractMode(); 
    }
  };

  // --- 3. STOP ---
  const stopInteractMode = () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true; 
    
    // Invalidate current session
    sessionIdRef.current += 1;
    
    addLog('🛑 Stopping Interaction...');

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
  };

  // --- 4. PASSIVE LOOP (Background Screenshots) ---
  const startPassiveLoop = (sessionId: number) => {
    // Clear any existing interval
    if (passiveIntervalRef.current) {
      clearInterval(passiveIntervalRef.current);
    }

    const passiveCapture = async () => {
      // Only run if session is valid and in LISTENING or IDLE mode
      if (!isValidSession(sessionId) || !videoRef.current || !user) return;
      // Pause during PROCESSING/SPEAKING
      if (mode === 'PROCESSING' || mode === 'SPEAKING') return;

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

          // Send to API with "Passive Observation" prompt
          await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ 
              s3Key: resImg.key, 
              recordId: dbData.id,
              userPrompt: 'Passive Observation'
            })
          });

          addLog('📸 Passive observation captured', 'system');
        }, 'image/png');
      } catch (err: any) {
        if (isValidSession(sessionId)) {
          addLog(`⚠️ Passive capture error: ${err.message}`);
        }
      }
    };

    // Run immediately, then every 10 seconds
    passiveCapture();
    passiveIntervalRef.current = setInterval(passiveCapture, 10000);
  };

  // --- 5. ACTIVE QUERY PROCESSING ---
  const processActiveQuery = async (transcript: string, sessionId: number) => {
    if (!isValidSession(sessionId) || !videoRef.current || !user) {
      return;
    }

    try {
      setMode('PROCESSING');
      addLog('📸 Capturing screenshot...', 'system');

      // IMMEDIATELY capture screenshot when user finishes speaking
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx || !isValidSession(sessionId)) return;
      
      ctx.drawImage(videoRef.current, 0, 0);

      canvas.toBlob(async (imageBlob) => {
        if (!imageBlob || !isValidSession(sessionId)) {
          setMode('LISTENING');
          return;
        }
        
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token || !isValidSession(sessionId)) {
          setMode('LISTENING');
          return;
        }

        // Upload image
        const resImg = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ contentType: 'image/png' })
        }).then(r => r.json());

        if (!isValidSession(sessionId)) {
          setMode('LISTENING');
          return;
        }

        await fetch(resImg.url, { 
          method: 'PUT', 
          body: imageBlob, 
          headers: { 'Content-Type': 'image/png' } 
        });

        // Create DB record
        const { data: dbData } = await supabase.from('user_states')
          .insert({ 
            user_id: user.id, 
            text_content: transcript, 
            screen_image_path: resImg.key 
          })
            .select().single();

        if (!isValidSession(sessionId)) {
          setMode('LISTENING');
          return;
        }

        addLog('🧠 Processing query...', 'system');

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
          setMode('LISTENING');
          return;
        }
        
        const analysis = await resAnalyze.json();

        if (!resAnalyze.ok || analysis.error) {
          if (isValidSession(sessionId)) {
            console.error("Drona API Error:", analysis);
            addLog(`❌ Brain Error: ${analysis.error || 'Unknown Error'}`, 'system');
            speakResponse("I'm sorry, I encountered an error.", sessionId); 
          }
          return;
        }

        if (!isValidSession(sessionId)) {
            return;
        }

        const response = analysis.response || "I am silent."; 
        setLastAnalysis(response);
        addLog(`Drona: ${response}`, 'drona');
        speakResponse(response, sessionId);

      }, 'image/png');

    } catch (err: any) {
      if (isValidSession(sessionId)) {
        addLog(`❌ Process Error: ${err.message}`, 'system');
        setMode('LISTENING');
      }
    }
  };

  // --- 6. SPEAK ---
  const speakResponse = (text: string, sessionId: number) => {
    if (!isValidSession(sessionId)) {
      return;
    }

    // Handle empty/null responses gracefully
    if (!text || text.trim() === "") {
      if (isValidSession(sessionId)) {
        addLog('⚠️ Received empty response. Listening again...', 'system');
        setMode('LISTENING');
      }
        return;
    }

    setMode('SPEAKING');
    
    // Clear any pending speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    
    utterance.onend = () => {
        if (isValidSession(sessionId) && !isStoppingRef.current) {
            addLog('👂 Listening again...', 'drona');
            setMode('LISTENING');
        }
    };
    
    // Error Watchdog
    utterance.onerror = () => {
         if (isValidSession(sessionId) && !isStoppingRef.current) {
            addLog('⚠️ Speech error. Restarting listener.', 'system');
            setMode('LISTENING');
         }
    };
    
    window.speechSynthesis.speak(utterance);
  };

  // --- HELPER FOR STYLES ---
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

  return (
    <div className="p-10 max-w-4xl mx-auto font-mono text-sm">
      <h1 className="text-3xl font-bold mb-5 text-indigo-600">👁️ Drona.ai Always-On Lab</h1>
      
      {!user && (
        <div className="bg-gray-100 p-5 rounded mb-5">
            <input className="border p-2 mr-2" placeholder="Email" onChange={e => setEmail(e.target.value)} suppressHydrationWarning />
            <input className="border p-2 mr-2" type="password" placeholder="Password" onChange={e => setPassword(e.target.value)} suppressHydrationWarning />
            <button onClick={handleLogin} className="bg-indigo-600 text-white p-2 rounded">Connect</button>
        </div>
      )}

      {user && (
        <div className="grid grid-cols-2 gap-5">
            <div className="bg-gray-50 p-5 rounded border relative flex flex-col items-center justify-center text-center">
                
                {mode === 'IDLE' ? (
                    <button onClick={startInteractMode} className="bg-indigo-600 hover:bg-indigo-700 text-white p-6 rounded-full text-xl shadow-xl transition-all w-full">
                        🟢 Start Interact Mode
                    </button>
                ) : (
                    <div className="w-full">
                        <button onClick={stopInteractMode} className="mb-5 bg-red-100 text-red-600 px-4 py-2 rounded border border-red-200 text-xs">
                            Stop Interaction
                        </button>

                        <div className={`w-40 h-40 rounded-full flex items-center justify-center mx-auto transition-all duration-300 ${getCircleColor()}`}>
                            <div className="text-4xl">
                                {mode === 'LISTENING' && '👂'}
                                {mode === 'PROCESSING' && '🧠'}
                                {mode === 'SPEAKING' && '🗣️'}
                            </div>
                        </div>
                        <p className="mt-4 font-bold text-gray-600">
                            {mode === 'LISTENING' && "I'm listening..."}
                            {mode === 'PROCESSING' && "Thinking..."}
                            {mode === 'SPEAKING' && "Speaking..."}
                        </p>
                    </div>
                )}
                
                <video ref={videoRef} className="hidden" muted playsInline></video>

                <div className="mt-5 w-full text-left">
                    <h4 className="font-bold text-gray-500 text-xs uppercase">Latest Response</h4>
                    <div className="p-3 bg-white border rounded h-32 overflow-auto whitespace-pre-wrap mt-2 text-indigo-800 text-xs">
                        {lastAnalysis || "Waiting for interaction..."}
                    </div>
                </div>
            </div>

            <div className="bg-black text-green-400 p-4 rounded h-[500px] overflow-auto">
                {logs.map((log, i) => <div key={i} className="mb-1 border-b border-gray-800 pb-1">{log}</div>)}
            </div>
        </div>
      )}
    </div>
  );
}
