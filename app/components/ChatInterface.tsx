"use client";
import { useRef, useEffect } from "react";
import { FiSend } from "react-icons/fi";
import type { Message } from "../types/chat";

interface ChatInterfaceProps {
  messages: Message[];
  inputValue: string;
  setInputValue: (value: string) => void;
  onSend: () => void;
  listeningStatus: string;
  transcript: string;
}

export default function ChatInterface({ 
  messages, 
  inputValue, 
  setInputValue, 
  onSend, 
  listeningStatus,
  transcript 
}: ChatInterfaceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // --- AUTO SCROLL ---
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <section className="flex flex-col flex-1 h-full justify-between relative bg-[#FAF8F7] px-0 font-sans">
      {/* CHAT FEED */}
      <div ref={chatContainerRef} className="flex-grow px-8 md:px-20 pt-14 pb-8 w-full overflow-y-auto flex flex-col gap-6">
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role === "user" ? "ml-auto max-w-[70%]" : "mr-auto max-w-[70%]"}>
            <div 
              // FORCE COLORS HERE: This guarantees White text on Dark background
              style={{ 
                backgroundColor: msg.role === 'user' ? '#231C16' : '#F4F1EF',
                color: msg.role === 'user' ? '#FFFFFF' : '#231C16' 
              }}
              className={`p-6 text-[1.04rem] shadow-sm rounded-3xl
                ${msg.role === 'user' 
                  ? "rounded-br-none" 
                  : "rounded-bl-none border border-[#EBE6DC]"}
              `}
            >
              {msg.role === 'system' && <strong className="text-[#bb601f]">System: </strong>}
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* INPUT AREA */}
      <div className="w-full border-t border-[#ECE9E7] bg-[#F6F2F1] px-0 pt-0 pb-7">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-1 mb-5 pt-6">
          <div className="text-[11px] font-semibold tracking-wide uppercase text-[#C0BBB7]">Live Transcript</div>
          <div className="h-10 flex items-center font-medium italic text-[#a98053] min-h-[2.5rem]">
             {transcript || <span className="text-[#B9B3AD]">Waiting for voice...</span>}
          </div>
        </div>
        
        <div className="max-w-2xl mx-auto w-full bg-[#fff] rounded-full shadow-lg border border-[#EFECE8] flex items-center px-2 py-1.5">
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a message…"
            className="flex-1 px-5 py-[14px] rounded-full font-normal text-base bg-transparent outline-none text-[#231C16]"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            suppressHydrationWarning
          />
          <button onClick={onSend} className="rounded-full p-[13px] ml-1 hover:bg-[#fbecd8]">
            <FiSend size={22} color="#bb601f" />
          </button>
          
           <div className="ml-4 w-24 text-xs font-bold text-[#bb601f] flex items-center">
             {listeningStatus === 'sending' && "Sending..."}
             {listeningStatus === 'listening' && "Listening..."}
          </div>
        </div>
      </div>
    </section>
  );
}

