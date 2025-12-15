"use client";
import { useRef, useState, useCallback, useEffect } from "react";

export function useMediaStream() {
  const [isRecording, setIsRecording] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // --- SNAPSHOT HELPER ---
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

  // --- VIDEO PREVIEW ---
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.play().catch(() => {});
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  // --- RECORDING ---
  const stopCapture = useCallback(() => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setIsRecording(false);
  }, [stream]);

  const startCapture = useCallback(async (): Promise<void> => {
    try {
      const captureStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
      setStream(captureStream);
      setIsRecording(true);

      const [track] = captureStream.getVideoTracks();
      if (track) track.onended = () => stopCapture();

    } catch (err) {
      stopCapture();
      throw err;
    }
  }, [stopCapture]);

  return {
    videoRef,
    isRecording,
    stream,
    startCapture,
    stopCapture,
    captureScreenImage,
  };
}

