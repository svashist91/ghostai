"use client";
import { useState, useCallback, useEffect } from "react";
import type { Message, Session } from "../types/chat";

const STORAGE_KEY = "ghost_ai_sessions";

// Helper: Generate unique ID
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Helper: Generate session title from first user message
const generateTitle = (messages: Message[]): string => {
  const firstUserMessage = messages.find(m => m.role === "user");
  if (firstUserMessage) {
    const text = firstUserMessage.content.trim();
    return text.length > 30 ? text.substring(0, 30) + "..." : text;
  }
  return "New Chat";
};

export function useChatSessions(clearTranscript: () => void) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Helper: Create new session
  const createNewSession = useCallback(() => {
    const newId = generateId();
    const newSession: Session = {
      id: newId,
      title: "New Chat",
      messages: [
        {
          role: "system",
          content: "Hello! I am ready to help. Start recording to share your screen.",
        },
      ],
      date: new Date().toISOString(),
    };
    
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newId);
    clearTranscript();
  }, [clearTranscript]);

  // Helper: Update session messages
  const updateSessionMessages = useCallback((sessionId: string, updater: (prev: Message[]) => Message[]) => {
    setSessions((prevSessions) => {
      const updated = prevSessions.map((session) => {
        if (session.id === sessionId) {
          const newMessages = updater(session.messages);
          // Auto-update title if it's still "New Chat" and we have a user message
          const title = session.title === "New Chat" ? generateTitle(newMessages) : session.title;
          return { ...session, messages: newMessages, title };
        }
        return session;
      });
      return updated;
    });
  }, []);

  // Helper: Switch to a session
  const switchToSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
    clearTranscript();
  }, [clearTranscript]);

  // Get current session messages
  const currentMessages = sessions.find(s => s.id === currentSessionId)?.messages || [];

  // Load sessions from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Session[];
        if (parsed.length > 0) {
          setSessions(parsed);
          setCurrentSessionId(parsed[0].id);
          return;
        }
      }
    } catch (err) {
      console.error("Error loading sessions from localStorage:", err);
    }
    // If no stored sessions, create initial session
    const newId = generateId();
    const initialSession: Session = {
      id: newId,
      title: "New Chat",
      messages: [
        {
          role: "system",
          content: "Hello! I am ready to help. Start recording to share your screen.",
        },
      ],
      date: new Date().toISOString(),
    };
    setSessions([initialSession]);
    setCurrentSessionId(newId);
  }, []);

  // Save sessions to localStorage whenever they change
  useEffect(() => {
    if (sessions.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
      } catch (err) {
        console.error("Error saving sessions to localStorage:", err);
      }
    }
  }, [sessions]);

  return {
    sessions,
    currentSessionId,
    currentMessages,
    createNewSession,
    updateSessionMessages,
    switchToSession,
  };
}

