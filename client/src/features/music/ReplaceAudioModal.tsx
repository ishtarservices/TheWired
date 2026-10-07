import { useState, useRef } from "react";
import { X, Upload, Music, FileAudio, ChevronLeft } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { uploadAudio } from "@/lib/api/music";
import { buildTrackEvent, buildPrivateTrackEvent } from "./musicEventBuilder";
import { spacePublishRelaysForAll } from "./spacePublish";
import { signAndPublish } from "@/lib/nostr/publish";
import { isSharedRelease } from "./sharedKey/members";
import { editAuthorFor } from "./sharedKey/releaseEdit";
import { selectAudioSource } from "./trackParser";
import { readAudioMetadata } from "./trackFileParser";
import type { MusicTrack } from "@/types/music";

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/flac",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/mp4",
  "audio/webm",
]);

interface ReplaceAudioModalProps {
  track: MusicTrack;
  onClose: () => void;
  onBack?: () => void;
}

function formatDuration(seconds?: number): string {
  if (!seconds || !isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/");
    return decodeURIComponent(segments[segments.length - 1] || "audio file");
  } catch {
    return "audio file";
  }
}

function formatMime(mime?: string): string {
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

export function ReplaceAudioModal({ track, onClose, onBack }: ReplaceAudioModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [newDuration, setNewDuration] = useState<number | undefined>(undefined);
  const [revisionSummary, setRevisionSummary] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const currentUrl = selectAudioSource(track.variants);
  const currentFilename = currentUrl ? getFilenameFromUrl(currentUrl) : "Unknown";
  const currentMime = track.variants[0]?.mimeType;

  const handleAudioChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file && !ALLOWED_AUDIO_TYPES.has(file.type)) {
      setError("Invalid audio format. Supported: MP3, OGG, FLAC, WAV, AAC, M4A, WebM");
      setAudioFile(null);
      e.target.value = "";
      return;
    }
    setError(null);
    setAudioFile(file);

    if (file) {
      const meta = await readAudioMetadata(file);
      if (meta.duration) {
        setNewDuration(meta.duration);
      }
    }
  };

  const handleSubmit = async () => {
    if (!audioFile || !pubkey) return;
    setError(null);
    setUploading(true);

    try {
      // A shared track's audio is uploaded AS its project key: the backend
      // gates a blob by its uploader, so a human-signed upload under a
      // project-signed private track would be public by URL.
      const author = await editAuthorFor(track, pubkey);
      const auth = { signer: author.signer };
      const shared = !!author.signer || isSharedRelease(track);

      // Upload the new audio file
      const audioResult = await uploadAudio(audioFile, {
        title: track.title,
        artist: track.artist,
      }, auth);

      // Extract the existing d-tag to preserve addressable identity
      const existingDTag = track.addressableId.split(":").slice(2).join(":");

      // Rebuild the track event with the new audio but same metadata. Every
      // visibility-bearing field is threaded through: dropping `spaceIds`
      // here silently turned a space release public, and rebuilding a private
      // track with the cleartext builder de-encrypted it.
      const params = {
        title: track.title,
        artist: track.artist,
        slug: existingDTag,
        duration: newDuration ?? audioResult.duration ?? track.duration,
        genre: track.genre || undefined,
        audioUrl: audioResult.url,
        audioHash: audioResult.sha256,
        audioSize: audioResult.size,
        audioMime: audioResult.mimeType,
        imageUrl: track.imageUrl,
        hashtags: track.hashtags.length > 0 ? track.hashtags : undefined,
        albumRef: track.albumRef,
        artistPubkeys: track.artistPubkeys.length > 0 ? track.artistPubkeys : undefined,
        featuredArtists: track.featuredArtists.length > 0 ? track.featuredArtists : undefined,
        visibility: track.visibility,
        spaceId: track.visibility === "space" ? track.spaceId : undefined,
        spaceIds: track.visibility === "space" ? track.spaceIds : undefined,
        channelId: track.visibility === "space" ? track.channelId : undefined,
        sharingDisabled: track.sharingDisabled,
        inCatalog: track.inCatalog,
        revisionSummary: revisionSummary || undefined,
        members: track.members,
      };
      // Shared private tracks keep the relay-gated form (no NIP-44 copies).
      const unsigned =
        track.visibility === "private" && !shared
          ? await buildPrivateTrackEvent(author.pubkey, { ...params, collaborators: track.collaborators })
          : buildTrackEvent(author.pubkey, params);

      const targetRelays =
        track.visibility === "space" ? await spacePublishRelaysForAll(track.spaceIds) : undefined;
      await signAndPublish(unsigned, targetRelays, auth);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to replace audio");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="text-soft hover:text-heading">
                <ChevronLeft size={18} />
              </button>
            )}
            <h2 className="text-lg font-semibold text-heading">Replace Audio</h2>
          </div>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Current audio info */}
          <div className="rounded-xl border border-border bg-surface/50 p-3">
            <p className="mb-2 text-xs font-medium text-soft">Current Audio</p>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card">
                <FileAudio size={18} className="text-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-heading">{currentFilename}</p>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>{formatMime(currentMime)}</span>
                  <span className="text-border">|</span>
                  <span>{formatDuration(track.duration)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* New audio file picker */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              New Audio File *
            </label>
            <input
              ref={audioInputRef}
              type="file"
              accept=".mp3,.ogg,.flac,.wav,.aac,.m4a,.webm,.mpeg"
              className="hidden"
              onChange={handleAudioChange}
            />
            <button
              onClick={() => audioInputRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-soft transition-colors hover:border-primary/40 hover:text-heading"
            >
              {audioFile ? (
                <>
                  <Music size={16} />
                  <span className="truncate">{audioFile.name}</span>
                  {newDuration && (
                    <span className="ml-auto shrink-0 text-xs text-muted">
                      {formatDuration(newDuration)}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Upload size={16} />
                  <span>Choose replacement audio file</span>
                </>
              )}
            </button>
          </div>

          {/* Revision summary (Phase 2 prep) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              What changed? <span className="text-muted">(optional)</span>
            </label>
            <input
              type="text"
              value={revisionSummary}
              onChange={(e) => setRevisionSummary(e.target.value)}
              className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
              placeholder="e.g., Remastered mix, fixed intro timing..."
            />
          </div>

          {/* Duration change notice */}
          {audioFile && newDuration && track.duration && Math.abs(newDuration - track.duration) > 1 && (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              Duration will change from {formatDuration(track.duration)} to {formatDuration(newDuration)}
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!audioFile || uploading}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
          >
            {uploading ? "Uploading & Replacing..." : "Replace Audio"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
