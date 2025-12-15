"use client";
import { useRef, useState, useCallback } from "react";

export type ListeningStatus = "idle" | "listening" | "sending";

export function useVoice() {
  const [transcript, setTranscript] = useState("");
  const [listeningStatus, setListeningStatus] = useState<ListeningStatus>("idle");
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  
  const recognitionRef = useRef<any>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRecordingRef = useRef(false);
  const isAISpeakingRef = useRef(false);

  // --- NEW: Cooldown Ref to prevent Echo ---
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start voice recognition
  const startVoiceRecognition = useCallback((onTranscriptReady: (text: string) => void) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.warn("Speech Recognition not supported in this browser");
      return;
    }

    setTranscript("");
    setListeningStatus("listening");
    
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      // 🔴 GUARD CLAUSE: Strictly ignore everything if AI is speaking OR in cooldown
      if (isAISpeakingRef.current) {
        console.log("Ignored speech (AI Speaking/Cooldown)");
        return;
      }

      if (silenceTimer.current) clearTimeout(silenceTimer.current);

      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        interimTranscript += event.results[i][0].transcript;
      }

      if (interimTranscript.trim()) {
        setTranscript(interimTranscript);
        setListeningStatus("listening");
        
        // Auto-send timer
        silenceTimer.current = setTimeout(() => {
          // Double-check before sending
          if (!isAISpeakingRef.current) {
            onTranscriptReady(interimTranscript);
          }
        }, 2000);
      }
    };

    recognition.onend = () => {
      // If the user is still "recording" (the button is on), restart the engine
      if (isRecordingRef.current) {
        try {
          recognition.start();
          // We do NOT clear transcript here to preserve flow
        } catch (e) {
          console.error("Restart error", e);
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      console.error("Speech error:", event.error);
    };

    recognitionRef.current = recognition;
    recognition.start();
    isRecordingRef.current = true;
  }, []);

  const stopVoiceRecognition = useCallback(() => {
    isRecordingRef.current = false;
    
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
    setListeningStatus("idle");
    setTranscript("");
  }, []);

  const abortRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
  }, []);

  const setStatus = useCallback((status: ListeningStatus) => {
    setListeningStatus(status);
  }, []);

  // --- HELPER: Handle AI Stop Speaking with Cooldown ---
  const handleAIStopSpeaking = useCallback(() => {
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    
    // 🔴 THE FIX: Wait 1.5 seconds AFTER audio ends before listening again.
    // This lets the room echo die down so the mic doesn't pick up the last word.
    cooldownTimerRef.current = setTimeout(() => {
      setIsAISpeaking(false);
      isAISpeakingRef.current = false;
      cooldownTimerRef.current = null;
    }, 1500); 
  }, []);

  // Speak text using browser TTS
  const speakText = useCallback((text: string) => {
    if (!text) return;
    window.speechSynthesis.cancel();
    
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
    
    // Lock the mic immediately
    setIsAISpeaking(true);
    isAISpeakingRef.current = true;
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = handleAIStopSpeaking; // Use safe handler
    utterance.onerror = handleAIStopSpeaking;
    
    window.speechSynthesis.speak(utterance);
  }, [handleAIStopSpeaking]);

  // Play audio from base64 data URL
  const playAudio = useCallback((audioDataUrl: string) => {
    try {
      // If there is active audio, pause it (simple overlap prevention)
      const existingAudio = document.querySelector('audio');
      if (existingAudio) existingAudio.pause();

      const audio = new Audio(audioDataUrl);
      
      if (silenceTimer.current) {
        clearTimeout(silenceTimer.current);
        silenceTimer.current = null;
      }
      
      // Lock the mic immediately
      setIsAISpeaking(true);
      isAISpeakingRef.current = true;
      
      audio.onended = handleAIStopSpeaking; // Use safe handler
      audio.onerror = handleAIStopSpeaking;
      
      audio.play().catch(e => {
        console.error("Audio play error:", e);
        handleAIStopSpeaking();
      });
    } catch (error) {
      console.error("Error creating audio:", error);
      handleAIStopSpeaking();
    }
  }, [handleAIStopSpeaking]);

  return {
    transcript,
    listeningStatus,
    isAISpeaking,
    startVoiceRecognition,
    stopVoiceRecognition,
    abortRecognition,
    clearTranscript,
    setStatus,
    speakText,
    playAudio,
    isRecordingRef,
  };
}