import { useState, useEffect, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useMediaDevices } from "./useMediaDevices";
import { getUserMedia, stopMediaStream } from "@/lib/webrtc/mediaDevices";
import { Mic, MicOff, Video, VideoOff, X } from "lucide-react";

interface PreJoinModalProps {
  open: boolean;
  onClose: () => void;
  onJoin: (options: { audioEnabled: boolean; videoEnabled: boolean }) => void;
  channelName: string;
  showVideo?: boolean;
}

/**
 * Pre-join modal for camera/mic preview before joining a voice/video channel.
 */
export function PreJoinModal({
  open,
  onClose,
  onJoin,
  channelName,
  showVideo = false,
}: PreJoinModalProps) {
  const { selectedAudioInput, selectedVideoInput } =
    useMediaDevices();
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(showVideo);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start preview stream
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function startPreview() {
      try {
        const stream = await getUserMedia({
          audio: audioEnabled,
          video: videoEnabled,
          audioDeviceId: selectedAudioInput || undefined,
          videoDeviceId: selectedVideoInput || undefined,
        });

        if (cancelled) {
          stopMediaStream(stream);
          return;
        }

        streamRef.current = stream;
        if (videoRef.current && videoEnabled) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.warn("[preJoin] Failed to get media:", err);
      }
    }

    startPreview();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        stopMediaStream(streamRef.current);
        streamRef.current = null;
      }
    };
  }, [open, audioEnabled, videoEnabled, selectedAudioInput, selectedVideoInput]);

  const handleJoin = () => {
    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    onJoin({ audioEnabled, videoEnabled });
  };

  const handleClose = () => {
    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <div className="w-full max-w-md rounded-2xl card-glass p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">Join {channelName}</h2>
          <button
            onClick={handleClose}
            className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Video preview */}
        {showVideo && (
          <div className="mb-4 aspect-video rounded-xl bg-black overflow-hidden">
            {videoEnabled ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover mirror"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted">
                <VideoOff size={32} />
              </div>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            className={`rounded-full p-3 transition-colors ${
              audioEnabled
                ? "bg-surface-hover text-heading"
                : "bg-red-500/20 text-red-400"
            }`}
            title={audioEnabled ? "Turn off microphone" : "Turn on microphone"}
          >
            {audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}
          </button>

          {showVideo && (
            <button
              onClick={() => setVideoEnabled(!videoEnabled)}
              className={`rounded-full p-3 transition-colors ${
                videoEnabled
                  ? "bg-surface-hover text-heading"
                  : "bg-red-500/20 text-red-400"
              }`}
              title={videoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              {videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
          )}
        </div>

        {/* Join button */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={handleJoin}>
            Join
          </Button>
        </div>
      </div>
    </Modal>
  );
}
