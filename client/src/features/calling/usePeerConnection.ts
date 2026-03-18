import { useEffect, useRef, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { getLocalStream, getRemoteStream } from "./callService";

/**
 * Hook for managing local and remote media streams in a P2P call.
 * Provides refs for attaching to video/audio elements.
 */
export function usePeerConnection() {
  const activeCall = useAppSelector((s) => s.call.activeCall);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Poll for stream changes
  useEffect(() => {
    if (!activeCall) {
      setLocalStream(null);
      setRemoteStream(null);
      return;
    }

    const interval = setInterval(() => {
      const ls = getLocalStream();
      const rs = getRemoteStream();
      if (ls !== localStream) setLocalStream(ls);
      if (rs !== remoteStream) setRemoteStream(rs);
    }, 500);

    return () => clearInterval(interval);
  }, [activeCall, localStream, remoteStream]);

  // Attach streams to video elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return {
    localStream,
    remoteStream,
    localVideoRef,
    remoteVideoRef,
  };
}
