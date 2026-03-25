import { useState, useCallback } from "react";
import { Lock, Trash2, Pin, Link2, Check, Repeat2, Quote } from "lucide-react";
import type { MusicAnnotation } from "@/types/music";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useAppSelector } from "@/store/hooks";
import { eventsSelectors } from "@/store/slices/eventsSlice";
import { buildRepost, buildQuoteNote } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { buildNaddrReference } from "@/lib/nostr/naddrEncode";
import { copyToClipboard } from "@/lib/clipboard";

function formatRelativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface AnnotationCardProps {
  annotation: MusicAnnotation;
  /** Whether this annotation is by the track/album owner */
  isArtistNote: boolean;
  onDelete?: () => void;
  onTogglePin?: () => void;
}

export function AnnotationCard({ annotation, isArtistNote, onDelete, onTogglePin }: AnnotationCardProps) {
  const { profile } = useProfile(annotation.authorPubkey);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isOwn = myPubkey === annotation.authorPubkey;
  const name = profile?.display_name || profile?.name || annotation.authorPubkey.slice(0, 8) + "...";
  const [copied, setCopied] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quoteText, setQuoteText] = useState("");

  // Get the raw event from the events store for embedding in reposts
  const rawEvent = useAppSelector((s) =>
    eventsSelectors.selectById(s.events, annotation.eventId),
  );

  const labelText = annotation.label === "custom"
    ? annotation.customLabel
    : annotation.label;

  const handleRepost = useCallback(async () => {
    if (!myPubkey || !rawEvent) return;
    const unsigned = buildRepost(
      myPubkey,
      { id: rawEvent.id, pubkey: rawEvent.pubkey },
      JSON.stringify(rawEvent),
    );
    try {
      await signAndPublish(unsigned);
      setReposted(true);
      setTimeout(() => setReposted(false), 2000);
    } catch {
      // Best-effort
    }
  }, [myPubkey, rawEvent]);

  const handleQuoteSubmit = useCallback(async () => {
    if (!myPubkey || !quoteText.trim() || !rawEvent) return;
    const unsigned = buildQuoteNote(
      myPubkey,
      quoteText.trim(),
      { eventId: rawEvent.id, pubkey: rawEvent.pubkey },
    );
    try {
      await signAndPublish(unsigned);
      setQuoting(false);
      setQuoteText("");
    } catch {
      // Best-effort
    }
  }, [myPubkey, quoteText, rawEvent]);

  const handleCopyLink = async () => {
    const ref = buildNaddrReference(annotation.addressableId);
    const ok = await copyToClipboard(ref);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className={`group relative rounded-xl border p-4 transition-colors ${
        isArtistNote
          ? "border-primary/20 bg-primary/[0.03]"
          : "border-border/40 bg-surface/30"
      }`}
    >
      {/* Author row */}
      <div className="mb-2.5 flex items-center gap-2">
        <Avatar src={profile?.picture} alt={name} size="sm" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-heading">{name}</span>
          {isArtistNote && (
            <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
              Artist
            </span>
          )}
          {annotation.isPinned && (
            <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
              Pinned
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted">{formatRelativeTime(annotation.createdAt)}</span>
      </div>

      {/* Label badge */}
      {labelText && (
        <span className="mb-2 inline-block rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-soft">
          {labelText}
        </span>
      )}

      {/* Content */}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-body">
        {annotation.content}
      </p>

      {/* Private indicator */}
      {annotation.isPrivate && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-amber-400/70">
          <Lock size={10} />
          Only you can see this
        </div>
      )}

      {/* Space indicator */}
      {annotation.spaceId && (
        <div className="mt-1 text-[10px] text-blue-400/70">
          Space-only
        </div>
      )}

      {/* Inline quote composer */}
      {quoting && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={quoteText}
            onChange={(e) => setQuoteText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleQuoteSubmit(); if (e.key === "Escape") setQuoting(false); }}
            placeholder="Add your thoughts..."
            autoFocus
            className="flex-1 rounded-lg border border-border/50 bg-transparent px-2.5 py-1 text-xs text-heading placeholder-muted/50 outline-none focus:border-primary/30"
          />
          <button
            onClick={handleQuoteSubmit}
            disabled={!quoteText.trim()}
            className="rounded-lg bg-primary/10 px-3 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
          >
            Post
          </button>
          <button
            onClick={() => { setQuoting(false); setQuoteText(""); }}
            className="rounded-lg px-2 py-1 text-[10px] text-muted hover:text-heading transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Actions (visible on hover) */}
      <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {/* Pin toggle (own artist notes only) */}
        {onTogglePin && (
          <button
            onClick={onTogglePin}
            className={`rounded-lg p-1 transition-all ${
              annotation.isPinned
                ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                : "text-muted hover:text-soft hover:bg-surface"
            }`}
            title={annotation.isPinned ? "Unpin" : "Pin to top"}
          >
            <Pin size={12} />
          </button>
        )}

        {/* Repost (public annotations only, when raw event is available) */}
        {!annotation.isPrivate && myPubkey && rawEvent && (
          <button
            onClick={handleRepost}
            className={`rounded-lg p-1 transition-all ${
              reposted
                ? "text-green-400"
                : "text-muted hover:text-soft hover:bg-surface"
            }`}
            title={reposted ? "Reposted!" : "Repost"}
          >
            <Repeat2 size={12} />
          </button>
        )}

        {/* Quote (public annotations only, when raw event is available) */}
        {!annotation.isPrivate && myPubkey && rawEvent && (
          <button
            onClick={() => setQuoting((v) => !v)}
            className={`rounded-lg p-1 transition-all ${
              quoting
                ? "text-primary"
                : "text-muted hover:text-soft hover:bg-surface"
            }`}
            title="Quote"
          >
            <Quote size={12} />
          </button>
        )}

        {/* Copy link (public annotations only) */}
        {!annotation.isPrivate && (
          <button
            onClick={handleCopyLink}
            className={`rounded-lg p-1 transition-all ${
              copied
                ? "text-green-400"
                : "text-muted hover:text-soft hover:bg-surface"
            }`}
            title={copied ? "Copied!" : "Copy link"}
          >
            {copied ? <Check size={12} /> : <Link2 size={12} />}
          </button>
        )}

        {/* Delete action (own annotations only) */}
        {isOwn && onDelete && (
          <button
            onClick={onDelete}
            className="rounded-lg p-1 text-muted transition-all hover:text-red-400 hover:bg-red-500/10"
            title="Delete annotation"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
