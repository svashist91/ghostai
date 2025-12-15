"use client";
import { RefObject } from "react";
import Link from "next/link";
// 1. Import Clerk components
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { FiCreditCard } from "react-icons/fi";

interface VideoPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  isRecording: boolean;
  stream: MediaStream | null;
  onStartCapture: () => void;
  onStopCapture: () => void;
}

export default function VideoPreview({ videoRef, isRecording, stream, onStartCapture, onStopCapture }: VideoPreviewProps) {
  return (
    <aside className="w-[265px] flex flex-col px-7 py-10 bg-[#F3F2F1] h-full border-l border-[#EBEBEB] gap-9 font-sans">
      <div className="flex flex-col w-full items-center pb-6">
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#B6B0A5] mb-4">Vision Preview</div>
        <div className="w-full aspect-video bg-[#231C16] rounded-2xl border border-[#ECE9E7] overflow-hidden relative">
          <video ref={videoRef} autoPlay playsInline muted className={stream ? "w-full h-full object-cover block" : "hidden"} />
          {!stream && <span className="text-xs text-[#B0ACA6] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">Camera Off</span>}
        </div>
      </div>

      {/* 2. REPLACED STATIC BUTTON WITH CLERK LOGIC */}
      
      {/* CASE A: User is NOT logged in */}
      <SignedOut>
        <Link href="/sign-in">
          <button className="w-full py-2 rounded-xl bg-white border border-[#ebd6c2] text-[#d47e21] font-bold shadow-sm mb-2 hover:bg-[#fff9f2] transition">
            Sign Up / Log In
          </button>
        </Link>
      </SignedOut>

      {/* CASE B: User IS logged in */}
      <SignedIn>
        <div className="flex flex-col gap-2 mb-2">
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
        </div>
      </SignedIn>
      
      <div className="mt-auto flex flex-col gap-3">
        <button 
          className={`w-full font-bold flex items-center justify-center gap-2 rounded-full py-4 text-white shadow-lg transition
            ${isRecording ? "bg-[#cfc6bf] cursor-not-allowed" : "bg-gradient-to-r from-[#fcab59] to-[#e97d2b] hover:from-[#e19655]"}`}
          onClick={onStartCapture}
          disabled={isRecording}
        >
          <div className={`w-2.5 h-2.5 bg-white rounded-full mr-2 ${isRecording ? "" : "animate-pulse"}`}></div>
          Start Recording
        </button>
        <div className="flex gap-2.5">
           <button className="flex-1 py-3 bg-[#faf8f7] border border-[#e9e2da] rounded-full font-bold text-[#b09572]">Pause</button>
           <button onClick={onStopCapture} disabled={!isRecording} className="flex-1 py-3 bg-[#faf8f7] border border-[#e9e2da] rounded-full font-bold text-[#df7931]">Stop</button>
        </div>
      </div>
    </aside>
  );
}