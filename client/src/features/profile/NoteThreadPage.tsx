import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { Avatar } from "../../components/ui/Avatar";
import { Spinner } from "../../components/ui/Spinner";
import { RichContent } from "../../components/content/RichContent";
import { NoteActionBar } from "../spaces/notes/NoteActionBar";
import { useZap } from "../wallet/WalletProvider";
import { QuotedNote } from "../spaces/notes/QuotedNote";
import { ReplyComposer } from "../spaces/notes/ReplyComposer";
import { useProfile } from "./useProfile";
import { useProfileNoteActions } from "./useProfileNoteActions";
import { useNoteEngagement } from "../spaces/useNoteEngagement";
import { EngagementCollectorProvider, useEngagementReporter } from "./engagementCollector";
import { parseQuoteRef } from "../spaces/noteParser";
import { extractMediaUrls, stripMediaUrls } from "../../lib/media/mediaUrlParser";
import { MediaGallery } from "../../components/media";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { PROFILE_RELAYS } from "../../lib/nostr/constants";
import type { NostrEvent } from "../../types/nostr";

function formatTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

interface NoteThreadPageProps {
  noteId: string;
}

export function NoteThreadPage({ noteId }: NoteThreadPageProps) {
  const navigate = useNavigate();
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const event = useAppSelector((s) => eventsSelectors.selectById(s.events, noteId));
  const [fetching, setFetching] = useState(!event);

  // Fetch the root note if not in store
  useEffect(() => {
    if (event) {
      setFetching(false);
      return;
    }
    const subId = subscriptionManager.subscribe({
      filters: [{ ids: [noteId] }],
      relayUrls: PROFILE_RELAYS,
      onEOSE: () => setFetching(false),
    });
    return () => { subscriptionManager.close(subId); };
  }, [noteId, event]);

  // Fetch replies
  const replyIds = useAppSelector((s) => s.events.replies[noteId]);
  const entities = useAppSelector((s) => s.events.entities);

  useEffect(() => {
    const subId = subscriptionManager.subscribe({
      filters: [{ kinds: [1], "#e": [noteId], limit: 100 }],
      relayUrls: PROFILE_RELAYS,
    });
    return () => { subscriptionManager.close(subId); };
  }, [noteId]);

  const replies = useMemo(() => {
    if (!replyIds || replyIds.length === 0) return [];
    return replyIds
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e)
      .sort((a, b) => a.created_at - b.created_at);
  }, [replyIds, entities]);

  // Engagement is fetched per-card (root + each reply) as it scrolls into view
  // via the EngagementCollectorProvider below — no longer truncated at 20.

  if (fetching) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${scrollPaddingClass}`}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            className="rounded-full p-1.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-lg font-semibold text-heading">Note</h2>
        </div>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted">This note could not be found.</p>
          <button
            onClick={() => navigate(-1)}
            className="rounded-lg bg-surface-hover px-4 py-2 text-sm text-heading hover:bg-surface-hover/80 transition-colors"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <EngagementCollectorProvider relayUrls={PROFILE_RELAYS}>
    <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${scrollPaddingClass}`}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="rounded-full p-1.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-lg font-semibold text-heading">Note</h2>
      </div>

      {/* Main note — expanded view */}
      <div className="px-6 py-5 border-b border-border">
        <RootNoteExpanded event={event} />
      </div>

      {/* Replies */}
      <div className="px-6 py-4 flex-1">
        {replies.length > 0 && (
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">
            {replies.length} {replies.length === 1 ? "Reply" : "Replies"}
          </p>
        )}
        <div className="flex flex-col gap-3">
          {replies.map((reply, i) => (
            <ReplyCard
              key={reply.id}
              event={reply}
              index={i + 1}
              animationDelay={i < 15 ? i * 40 : undefined}
            />
          ))}
        </div>
        {replies.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">No replies yet</p>
        )}
      </div>
    </div>
    </EngagementCollectorProvider>
  );
}

/** The root note in expanded/detail form */
function RootNoteExpanded({ event }: { event: NostrEvent }) {
  const { profile } = useProfile(event.pubkey);
  const engagement = useNoteEngagement(event.id);
  const actions = useProfileNoteActions(event);
  const { openZap } = useZap();
  const navigate = useNavigate();
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [showQuoteComposer, setShowQuoteComposer] = useState(false);

  const displayName = profile?.display_name || profile?.name || event.pubkey.slice(0, 12) + "...";
  const quoteRef = useMemo(() => parseQuoteRef(event), [event]);
  const media = useMemo(() => extractMediaUrls(event.content), [event.content]);
  const cleanedContent = useMemo(
    () => media.length > 0 ? stripMediaUrls(event.content) : event.content,
    [event.content, media],
  );

  const engagementRef = useEngagementReporter(event.id, 0);

  return (
    <div ref={engagementRef}>
      {/* Author row */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => navigate(`/profile/${event.pubkey}`)}
          className="rounded-full shrink-0"
        >
          <Avatar src={profile?.picture} alt={displayName} size="md" />
        </button>
        <div className="min-w-0 flex-1">
          <button
            onClick={() => navigate(`/profile/${event.pubkey}`)}
            className="text-sm font-semibold text-heading hover:underline"
          >
            {displayName}
          </button>
          {profile?.nip05 && (
            <p className="text-xs text-muted truncate">{profile.nip05}</p>
          )}
        </div>
      </div>

      {/* Content — larger text for expanded view */}
      {cleanedContent && (
        <div className="text-[15px] leading-relaxed text-body mb-3">
          <RichContent
            content={cleanedContent}
            suppressEventIds={quoteRef ? [quoteRef.eventId] : undefined}
          />
        </div>
      )}

      {/* Media */}
      {media.length > 0 && <MediaGallery media={media} density="expanded" />}

      {quoteRef && (
        <QuotedNote eventId={quoteRef.eventId} relayHint={quoteRef.relayHint} pubkey={quoteRef.pubkey} />
      )}

      {/* Timestamp */}
      <p className="mt-3 mb-3 text-xs text-muted border-b border-border pb-3">
        {formatTime(event.created_at)}
      </p>

      {/* Engagement bar */}
      <NoteActionBar
        engagement={engagement}
        canInteract={actions.canInteract}
        canWrite={actions.canWrite}
        onReply={() => setShowReplyComposer((v) => !v)}
        onRepost={actions.repost}
        onLike={actions.like}
        onQuote={() => setShowQuoteComposer((v) => !v)}
        onZap={() => openZap({ recipientPubkey: event.pubkey, event })}
      />

      {showReplyComposer && (
        <ReplyComposer
          targetPubkey={event.pubkey}
          onSend={(content) => {
            actions.reply(content);
            setShowReplyComposer(false);
          }}
          onCancel={() => setShowReplyComposer(false)}
        />
      )}

      {showQuoteComposer && (
        <ReplyComposer
          targetPubkey={event.pubkey}
          label="Quoting"
          placeholder="Add a comment…"
          onSend={(content) => {
            actions.quote(content);
            setShowQuoteComposer(false);
          }}
          onCancel={() => setShowQuoteComposer(false)}
        />
      )}
    </div>
  );
}

/** Individual reply card */
function ReplyCard({ event, index, animationDelay }: { event: NostrEvent; index: number; animationDelay?: number }) {
  const { profile } = useProfile(event.pubkey);
  const engagement = useNoteEngagement(event.id);
  const actions = useProfileNoteActions(event);
  const { openZap } = useZap();
  const navigate = useNavigate();
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [showQuoteComposer, setShowQuoteComposer] = useState(false);

  const displayName = profile?.display_name || profile?.name || event.pubkey.slice(0, 12) + "...";

  const media = useMemo(() => extractMediaUrls(event.content), [event.content]);
  const cleanedContent = useMemo(
    () => media.length > 0 ? stripMediaUrls(event.content) : event.content,
    [event.content, media],
  );

  const engagementRef = useEngagementReporter(event.id, index);

  return (
    <div
      ref={engagementRef}
      className="animate-fade-in-up border-l-2 border-border pl-4 py-3"
      style={animationDelay ? { animationDelay: `${animationDelay}ms` } : undefined}
    >
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => navigate(`/profile/${event.pubkey}`)}
          className="rounded-full shrink-0"
        >
          <Avatar src={profile?.picture} alt={displayName} size="xs" />
        </button>
        <button
          onClick={() => navigate(`/profile/${event.pubkey}`)}
          className="text-xs font-medium text-heading hover:underline"
        >
          {displayName}
        </button>
        <span className="text-xs text-muted">{formatRelativeTime(event.created_at)}</span>
      </div>

      {cleanedContent && (
        <div className="text-sm leading-relaxed text-body mb-2">
          <RichContent content={cleanedContent} />
        </div>
      )}

      {media.length > 0 && <MediaGallery media={media} density="compact" />}

      <NoteActionBar
        engagement={engagement}
        canInteract={actions.canInteract}
        canWrite={actions.canWrite}
        onReply={() => setShowReplyComposer((v) => !v)}
        onRepost={actions.repost}
        onLike={actions.like}
        onQuote={() => setShowQuoteComposer((v) => !v)}
        onZap={() => openZap({ recipientPubkey: event.pubkey, event })}
      />

      {showReplyComposer && (
        <ReplyComposer
          targetPubkey={event.pubkey}
          onSend={(content) => {
            actions.reply(content);
            setShowReplyComposer(false);
          }}
          onCancel={() => setShowReplyComposer(false)}
        />
      )}

      {showQuoteComposer && (
        <ReplyComposer
          targetPubkey={event.pubkey}
          label="Quoting"
          placeholder="Add a comment…"
          onSend={(content) => {
            actions.quote(content);
            setShowQuoteComposer(false);
          }}
          onCancel={() => setShowQuoteComposer(false)}
        />
      )}
    </div>
  );
}
