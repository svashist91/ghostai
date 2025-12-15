"use client";
import type { Session } from "../types/chat";

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSwitchSession: (sessionId: string) => void;
  onNewChat: () => void;
}

export default function Sidebar({ sessions, currentSessionId, onSwitchSession, onNewChat }: SidebarProps) {
  return (
    <aside className="w-[250px] flex flex-col justify-between h-full bg-[#F3F2F1] border-r border-[#EBEBEB]">
      <div className="flex items-center px-7 py-6 border-b border-[#ECE9E7] h-[70px]">
        <span className="text-[22px] font-bold tracking-tight font-sans">
          <span className="text-[#bb601f]">AI</span>&nbsp;Workspace
        </span>
      </div>
      <div className="flex-1 px-5 py-7 overflow-y-auto flex flex-col gap-3">
        <div className="mb-2 text-xs uppercase tracking-wider text-[#C0BBB7] font-semibold select-none">History</div>
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => onSwitchSession(session.id)}
            className={`cursor-pointer text-sm font-medium rounded-lg py-3 px-5 transition border font-sans ${
              currentSessionId === session.id
                ? "bg-[#fcf7f3] border-[#d47e21] shadow"
                : "bg-transparent hover:bg-[#f0eae7] border-[#eee0d9]"
            }`}
          >
            <div className="truncate">{session.title}</div>
            <div className="text-xs text-[#C0BBB7] mt-1">
              {new Date(session.date).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
      <div className="px-7 pb-6">
        <button 
          onClick={onNewChat}
          className="w-full py-2 rounded-full font-bold text-[15px] bg-gradient-to-r from-[#ffe4c1] to-[#FBE8D8] text-[#d47e21] border border-[#ebd6c2] shadow transition hover:from-[#f0d4a8] hover:to-[#f5dcc4]"
        >
          + New Chat
        </button>
      </div>
    </aside>
  );
}

