"use client";
import { useState, useCallback } from "react";
import { useVoice } from "./voice";
import { useChatSessions } from "./hooks/useChatSessions";
import { useMediaStream } from "./hooks/useMediaStream";
import Sidebar from "./components/Sidebar";
import VideoPreview from "./components/VideoPreview";
import ChatInterface from "./components/ChatInterface";

export default function Home() {
  const [inputValue, setInputValue] = useState("");
  
  // Voice hook
  const {
    transcript,
    listeningStatus,
    startVoiceRecognition,
    stopVoiceRecognition,
    abortRecognition,
    clearTranscript,
    setStatus,
    speakText,
    playAudio,
    isRecordingRef,
  } = useVoice();
  
  // Chat Sessions hook
  const {
    sessions,
    currentSessionId,
    currentMessages,
    createNewSession,
    updateSessionMessages,
    switchToSession,
  } = useChatSessions(clearTranscript);

  // Media Stream hook
  const {
    videoRef,
    isRecording,
    stream,
    startCapture: startMediaCapture,
    stopCapture: stopMediaCapture,
    captureScreenImage,
  } = useMediaStream();

  // --- SEND TO AI ---
  const handleSendToAI = useCallback(
    async (manualText?: string) => {
      if (!currentSessionId) return;

      const image = captureScreenImage();
      
      // Use manualText if provided (from voice), otherwise use inputs
      let textToSend = manualText 
        ? manualText.trim() 
        : (inputValue.trim() || transcript.trim());

      if (!textToSend) return; 

      // --- PREPARE HISTORY (before updating state) ---
      const currentSession = sessions.find(s => s.id === currentSessionId);
      const existingHistory = currentSession?.messages.filter(m => m.role !== 'system') || [];
      // Include the new user message in history
      const historyToSend = [...existingHistory, { role: "user" as const, content: textToSend }];

      // 1. Show User Message (update active session)
      updateSessionMessages(currentSessionId, (prev) => [...prev, { role: "user", content: textToSend }]);
      
      // 2. HARD RESET INPUTS & ENGINE
      setInputValue("");
      clearTranscript();
      setStatus("sending");

      // Critical: Abort recognition to clear the buffer ("Zombie Text" fix)
      abortRecognition();

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            image, 
            text: textToSend,
            history: historyToSend // <--- This enables the memory!
          }),
        });
        
        const result = await res.json();
        
        // 3. Show AI Response (update active session)
        if (result && result.response) {
          updateSessionMessages(currentSessionId, (prev) => [...prev, { role: "ai", content: result.response }]);
        }
        
        // 4. Play Audio
        if (result.audio) {
          // If backend sends audio (e.g. from OpenAI), play it
          playAudio("data:audio/mp3;base64," + result.audio);
        } else if (result.response) {
          // If no audio (Gemini), use Browser's built-in Robot Voice
          speakText(result.response);
        }

      } catch (err) {
        console.error("Error sending to AI:", err);
        updateSessionMessages(currentSessionId, (prev) => [...prev, { role: "system", content: "Error: Could not reach AI." }]);
      }
      
      // Reset status
      setTimeout(() => {
        if (isRecordingRef.current) setStatus("listening");
        else setStatus("idle");
      }, 700);
    },
    [
      currentSessionId,
      sessions,
      updateSessionMessages,
      captureScreenImage,
      transcript,
      inputValue,
      clearTranscript,
      setStatus,
      abortRecognition,
      playAudio,
      speakText,
      isRecordingRef,
    ]
  );

  // --- RECORDING ---
  const stopCapture = useCallback(() => {
    stopMediaCapture();
    // Stop voice recognition
    stopVoiceRecognition();
  }, [stopMediaCapture, stopVoiceRecognition]);

  const startCapture = useCallback(async () => {
    if (isRecordingRef.current) return;
    try {
      await startMediaCapture();
      // Start voice recognition
      startVoiceRecognition(handleSendToAI);
    } catch (err) {
      stopCapture();
    }
  }, [handleSendToAI, startVoiceRecognition, startMediaCapture, stopCapture]);

  // Handle new session creation with input clearing
  const handleNewChat = useCallback(() => {
    createNewSession();
    setInputValue("");
  }, [createNewSession]);

  // Handle session switching with input clearing
  const handleSwitchSession = useCallback((sessionId: string) => {
    switchToSession(sessionId);
    setInputValue("");
  }, [switchToSession]);

  // --- RENDER ---
  return (
    <main className="flex h-screen w-full overflow-hidden relative bg-[#FAF8F7] font-inter text-[#231C16]">
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
        onSend={() => handleSendToAI()}
        listeningStatus={listeningStatus}
        transcript={transcript}
      />

      <VideoPreview
        videoRef={videoRef}
        isRecording={isRecording}
        stream={stream}
        onStartCapture={startCapture}
        onStopCapture={stopCapture}
      />
    </main>
  );
}