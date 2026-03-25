import { Upload, Download } from "lucide-react";
import type { MusicTrack } from "@/types/music";
import { useAudioPlayer } from "../useAudioPlayer";
import { useWaveform } from "./useWaveform";
import { selectAudioSource } from "../trackParser";
import { useDownload } from "../useDownload";

function formatDuration(seconds?: number): string {
  if (!seconds || !isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "Unknown";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMimeLabel(mime?: string): string {
  if (!mime) return "Unknown";
  const map: Record<string, string> = {
    "audio/mpeg": "MP3",
    "audio/mp3": "MP3",
    "audio/ogg": "OGG",
    "audio/flac": "FLAC",
    "audio/wav": "WAV",
    "audio/x-wav": "WAV",
    "audio/aac": "AAC",
    "audio/mp4": "M4A",
    "audio/webm": "WebM",
  };
  return map[mime] ?? mime;
}

interface AudioTabProps {
  track: MusicTrack;
  isOwner: boolean;
  onReplaceAudio: () => void;
  onExport: () => void;
  exporting: boolean;
}

export function AudioTab({ track, isOwner, onReplaceAudio, onExport, exporting }: AudioTabProps) {
  const { seek, player } = useAudioPlayer();
  const { downloadTrack, removeDownload, isDownloaded, downloading } = useDownload();
  const downloaded = isDownloaded(track.addressableId);
  const isDownloading = downloading === track.addressableId;

  const audioUrl = selectAudioSource(track.variants);
  const isCurrent = player.currentTrackId === track.addressableId;

  const handleSeek = (fraction: number) => {
    if (isCurrent && player.duration > 0) {
      seek(fraction * player.duration);
    }
  };

  const { canvasRef, loading: waveformLoading } = useWaveform(
    audioUrl,
    isCurrent,
    isCurrent ? handleSeek : undefined,
  );

  const variant = track.variants[0];
  const bitrate = variant?.bitrate;

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* ── Waveform ── */}
      <div className="relative rounded-xl bg-surface/30 p-3">
        {waveformLoading ? (
          <div className="flex h-[80px] items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className={`h-[80px] w-full ${isCurrent ? "cursor-pointer" : "cursor-default"}`}
          />
        )}
        {!isCurrent && !waveformLoading && (
          <p className="mt-1 text-center text-[10px] text-muted">
            Play this track to enable seeking
          </p>
        )}
      </div>

      {/* ── Metadata Grid ── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-surface/50 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted/60">Format</p>
          <p className="mt-0.5 text-sm text-heading">{getMimeLabel(variant?.mimeType)}</p>
        </div>
        <div className="rounded-xl bg-surface/50 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted/60">Duration</p>
          <p className="mt-0.5 text-sm text-heading">{formatDuration(track.duration)}</p>
        </div>
        <div className="rounded-xl bg-surface/50 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted/60">File Size</p>
          <p className="mt-0.5 text-sm text-heading">{formatFileSize(variant?.size)}</p>
        </div>
        <div className="rounded-xl bg-surface/50 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted/60">Bitrate</p>
          <p className="mt-0.5 text-sm text-heading">
            {bitrate ? `${Math.round(bitrate / 1000)} kbps` : "Unknown"}
          </p>
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="flex flex-col gap-1.5">
        {isOwner && (
          <button
            onClick={onReplaceAudio}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs text-body transition-colors hover:bg-surface hover:text-heading"
          >
            <Upload size={14} />
            Replace Audio
          </button>
        )}
        {downloaded ? (
          <button
            onClick={() => removeDownload(track.addressableId)}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs text-body transition-colors hover:bg-surface hover:text-heading"
          >
            <Download size={14} className="text-green-400" />
            Remove Download
          </button>
        ) : (
          <button
            onClick={() => downloadTrack(track)}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs text-body transition-colors hover:bg-surface hover:text-heading"
          >
            <Download size={14} />
            {isDownloading ? "Downloading..." : "Download"}
          </button>
        )}
        {(isOwner || !track.sharingDisabled) && (
          <button
            onClick={onExport}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs text-body transition-colors hover:bg-surface hover:text-heading"
          >
            <Download size={14} />
            {exporting ? "Exporting..." : "Export File"}
          </button>
        )}
      </div>
    </div>
  );
}
