import { useContext, useMemo, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { MediaGallery } from "../media";
import { NoteShareMenu } from "../sharing/NoteShareMenu";
import { MusicEmbedCard } from "./MusicEmbedCard";
import { MusicPostMedia } from "./MusicPostMedia";
import { PollCard } from "../../features/polls/PollCard";
import { RichContent } from "./RichContent";
import { EmbedDepthContext, MAX_EMBED_DEPTH } from "./embedDepth";
import { EmbedSurfaceContext } from "./embedSurface";
import { useEmbeddedEvent, type EventRef } from "./useEmbeddedEvent";
import { useProfile } from "../../features/profile/useProfile";
import { useNoteEngagement } from "../../features/spaces/useNoteEngagement";
import { useProfileNoteActions } from "../../features/profile/useProfileNoteActions";
import { NoteActionBar } from "../../features/spaces/notes/NoteActionBar";
import { useZap } from "../../features/wallet/WalletProvider";
import { parseLongFormEvent } from "../../features/longform/useLongForm";
import { parseVideoEvent, selectVideoSource } from "../../features/media/imetaParser";
import { extractMediaUrls, stripMediaUrls, type ExtractedMedia } from "../../lib/media/mediaUrlParser";
import { splitTrailingMusicRefs } from "../../lib/content/musicPost";
import { EVENT_KINDS, type NostrEvent } from "../../types/nostr";
import { hasSpaceTag, imetaByUrl, imetaFor, tokenizeEventMediaUrl } from "../../lib/media/eventMedia";
import { useMediaGrant } from "../../lib/media/mediaGrant";

interface EmbeddedNoteProps {
  /** A note / event reference (nevent / note / hex id). */
  idRef?: { id: string; relays?: string[]; author?: string; kind?: number };
  /** An addressable reference (naddr). */
  addrRef?: { kind: number; pubkey: string; identifier: string; relays?: string[] };
}

const MUSIC_KINDS = new Set<number>([
  EVENT_KINDS.MUSIC_TRACK,
  EVENT_KINDS.MUSIC_ALBUM,
  EVENT_KINDS.MUSIC_PLAYLIST,
]);

const VIDEO_KINDS = new Set<number>([
  EVENT_KINDS.VIDEO_HORIZONTAL,
  EVENT_KINDS.VIDEO_VERTICAL,
  EVENT_KINDS.VIDEO_HORIZONTAL_ADDR,
  EVENT_KINDS.VIDEO_VERTICAL_ADDR,
]);

/**
 * Renders a shared `nostr:nevent / note / naddr` reference as an inline card.
 * Wired into `RichContent` so any note/message body embeds referenced notes.
 *
 * Depth-aware (see `EmbedDepthContext`): full interactive card at the top level,
 * a compact card one level deep, and a plain link beyond that — so a note that
 * quotes a note that quotes a note can't recurse without bound.
 */
export function EmbeddedNote({ idRef, addrRef }: EmbeddedNoteProps) {
  const depth = useContext(EmbedDepthContext);

  // Music coordinates resolve via the dedicated music backend (not a relay sub),
  // so short-circuit straight to the existing card — at any depth.
  if (addrRef && MUSIC_KINDS.has(addrRef.kind)) {
    return (
      <MusicEmbedCard kind={addrRef.kind} pubkey={addrRef.pubkey} identifier={addrRef.identifier} />
    );
  }

  // Hard recursion stop: render the reference as a plain link, no fetch.
  if (depth >= MAX_EMBED_DEPTH) {
    return <EmbedRefLink idRef={idRef} addrRef={addrRef} />;
  }

  return <EmbeddedNoteResolver idRef={idRef} addrRef={addrRef} depth={depth} />;
}

function EmbeddedNoteResolver({
  idRef,
  addrRef,
  depth,
}: EmbeddedNoteProps & { depth: number }) {
  const ref: EventRef = idRef
    ? { id: idRef.id, relays: idRef.relays, author: idRef.author, kind: idRef.kind }
    : {
        kind: addrRef!.kind,
        pubkey: addrRef!.pubkey,
        identifier: addrRef!.identifier,
        relays: addrRef!.relays,
      };
  const { event, loading, notFound } = useEmbeddedEvent(ref);

  if (loading) return <EmbedSkeleton />;
  if (notFound || !event) return <EmbedUnavailable />;

  if (event.kind === EVENT_KINDS.LONG_FORM) {
    return <ArticleEmbed event={event} />;
  }
  if (MUSIC_KINDS.has(event.kind)) {
    const d = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return <MusicEmbedCard kind={event.kind} pubkey={event.pubkey} identifier={d} />;
  }
  if (event.kind === EVENT_KINDS.POLL) {
    return <PollEmbed event={event} depth={depth} />;
  }
  return <NoteEmbed event={event} depth={depth} />;
}

// ── Poll card (kind 1068) ─────────────────────────────────────────────────────

function PollEmbed({ event, depth }: { event: NostrEvent; depth: number }) {
  const { profile } = useProfile(event.pubkey);
  const name = profile?.display_name || profile?.name || event.pubkey.slice(0, 8) + "…";
  return (
    <div className="mt-2">
      <EmbedAuthor profile={profile} name={name} pubkey={event.pubkey} createdAt={event.created_at} />
      <div className="mt-1.5">
        <PollCard event={event} variant="embed" compact={depth >= 1} />
      </div>
    </div>
  );
}

// ── Note card (kinds 1 / 9 / 1111 / picture / video / default) ────────────────

function NoteEmbed({ event, depth }: { event: NostrEvent; depth: number }) {
  const navigate = useNavigate();
  const { profile } = useProfile(event.pubkey);
  const compact = depth >= 1;
  // In a chat / DM message: a width-capped card with chat-sized media.
  const inMessage = useContext(EmbedSurfaceContext) === "message";

  // Tokenized from the EMBEDDED event's own tags: a space message quoted into
  // a public note, another space or a DM still carries its space's grant.
  const grant = useMediaGrant();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const media = useMemo(() => embedMediaForEvent(event), [event, grant]);
  // A quoted music post keeps its music: the trailing refs render as its hero
  // or (compact) rows, not inline in the clamped text.
  const { text, musicRefs } = useMemo(() => {
    const stripped = media.length > 0 ? stripMediaUrls(event.content, event) : event.content;
    const { body, refs } = splitTrailingMusicRefs(stripped);
    return {
      text: compact && body.length > 280 ? body.slice(0, 280) + "…" : body,
      musicRefs: refs,
    };
  }, [event, media.length, compact]);

  const name = profile?.display_name || profile?.name || event.pubkey.slice(0, 8) + "…";

  // Plain-text / empty-area clicks open the thread; interactive children
  // (mentions, links, action buttons, media) handle their own clicks.
  const onCardClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a,button,video,audio,img")) return;
    navigate(`/note/${event.id}`);
  };

  return (
    <div
      onClick={onCardClick}
      className={`mt-2 cursor-pointer rounded-xl border border-border card-glass p-3 transition-colors hover:border-border-light ${
        inMessage ? "w-full max-w-[28rem]" : ""
      }`}
    >
      <EmbedAuthor profile={profile} name={name} pubkey={event.pubkey} createdAt={event.created_at} />
      {text && (
        <div className={`mt-1 text-sm leading-relaxed text-body ${compact ? "line-clamp-3" : ""}`}>
          <EmbedDepthContext.Provider value={depth + 1}>
            <RichContent content={text} emojiTags={event.tags.filter((t) => t[0] === "emoji")} event={event} />
          </EmbedDepthContext.Provider>
        </div>
      )}
      {musicRefs.length > 0 ? (
        <EmbedDepthContext.Provider value={depth + 1}>
          <MusicPostMedia media={media} refs={musicRefs} heroHeight={compact || inMessage ? "h-[15rem]" : "h-[18rem]"} />
        </EmbedDepthContext.Provider>
      ) : (
        media.length > 0 && <MediaGallery media={media} density={inMessage ? "chat" : "feed"} />
      )}
      {!compact && <NoteEmbedActions event={event} />}
    </div>
  );
}

function NoteEmbedActions({ event }: { event: NostrEvent }) {
  const navigate = useNavigate();
  const engagement = useNoteEngagement(event.id);
  const actions = useProfileNoteActions(event);
  const { openZap } = useZap();
  const [shareAnchor, setShareAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <NoteActionBar
        engagement={engagement}
        canInteract={actions.canInteract}
        canWrite={actions.canWrite}
        onReply={() => navigate(`/note/${event.id}`)}
        onRepost={actions.repost}
        onLike={actions.like}
        onQuote={() => navigate(`/note/${event.id}`)}
        onZap={() => openZap({ recipientPubkey: event.pubkey, event })}
        onShare={setShareAnchor}
      />
      <NoteShareMenu
        event={event}
        anchorEl={shareAnchor}
        onClose={() => setShareAnchor(null)}
      />
    </>
  );
}

// ── Article card (kind 30023) ─────────────────────────────────────────────────

function ArticleEmbed({ event }: { event: NostrEvent }) {
  const navigate = useNavigate();
  const article = useMemo(() => parseLongFormEvent(event), [event]);
  const cover = isHttpUrl(article.image) ? article.image : null;
  const inMessage = useContext(EmbedSurfaceContext) === "message";

  return (
    <div
      onClick={() => navigate(`/article/${event.id}`)}
      className={`mt-2 cursor-pointer overflow-hidden rounded-xl border border-border card-glass transition-colors hover:border-border-light ${
        inMessage ? "w-full max-w-[28rem]" : ""
      }`}
    >
      {cover && <img src={cover} alt="" className="h-32 w-full object-cover" loading="lazy" />}
      <div className="p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <FileText size={12} />
          Article
        </div>
        <p className="mt-1 line-clamp-2 text-sm font-semibold text-heading">{article.title}</p>
        {article.summary && (
          <p className="mt-1 line-clamp-2 text-xs text-soft">{article.summary}</p>
        )}
        <span className="mt-2 inline-block text-xs font-medium text-primary">Read →</span>
      </div>
    </div>
  );
}

// ── Author row, skeleton, unavailable, deep-link fallback ─────────────────────

function EmbedAuthor({
  profile,
  name,
  pubkey,
  createdAt,
}: {
  profile: { picture?: string } | null;
  name: string;
  pubkey: string;
  createdAt: number;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => navigate(`/profile/${pubkey}`)}
        className="flex items-center gap-1.5"
      >
        <Avatar src={profile?.picture} alt={name} size="xs" />
        <span className="text-xs font-medium text-heading hover:underline">{name}</span>
      </button>
      <span className="text-xs text-muted">· {formatRelativeTime(createdAt)}</span>
    </div>
  );
}

function EmbedSkeleton() {
  const inMessage = useContext(EmbedSurfaceContext) === "message";
  return (
    <div className={`mt-2 rounded-xl border border-border card-glass p-3 ${inMessage ? "w-full max-w-[28rem]" : ""}`}>
      <div className="flex items-center gap-1.5">
        <div className="h-5 w-5 animate-pulse rounded-full bg-surface" />
        <div className="h-3 w-24 animate-pulse rounded bg-surface" />
      </div>
      <div className="mt-2 h-3 w-full animate-pulse rounded bg-surface" />
      <div className="mt-1 h-3 w-2/3 animate-pulse rounded bg-surface" />
    </div>
  );
}

function EmbedUnavailable() {
  const inMessage = useContext(EmbedSurfaceContext) === "message";
  return (
    <div className={`mt-2 rounded-xl border border-border card-glass p-3 text-xs text-muted ${inMessage ? "w-full max-w-[28rem]" : ""}`}>
      Note unavailable
    </div>
  );
}

function EmbedRefLink({ idRef }: EmbeddedNoteProps) {
  const navigate = useNavigate();
  const target = idRef ? `/note/${idRef.id}` : null;
  return (
    <button
      onClick={() => target && navigate(target)}
      disabled={!target}
      className="text-sm text-primary hover:underline disabled:cursor-default disabled:text-muted disabled:no-underline"
    >
      ↗ quoted note
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a media list for any embeddable kind (notes, picture, video posts). */
function embedMediaForEvent(event: NostrEvent): ExtractedMedia[] {
  const source = {
    author: event.pubkey,
    ...(hasSpaceTag(event.tags) ? { gated: true } : {}),
  };
  if (VIDEO_KINDS.has(event.kind)) {
    const video = parseVideoEvent(event);
    const url = selectVideoSource(video.variants);
    if (!url) return [];
    const variant = video.variants.find((v) => v.url === url) ?? video.variants.find((v) => v.dim);
    return [
      {
        url,
        type: "video",
        matchText: url,
        ...source,
        ...(variant?.dim ? { dim: variant.dim } : {}),
        ...(isHttpUrl(video.thumbnail) ? { poster: video.thumbnail } : {}),
      },
    ];
  }
  if (event.kind === EVENT_KINDS.PICTURE) {
    const tagged = event.tags.filter((t) => t[0] === "url").map((t) => t[1]).filter(Boolean);
    const urls = tagged.length ? tagged : [event.content.trim()];
    const imeta = imetaByUrl(event.tags);
    // kind 20 puts its images in imeta (NIP-68); `url` tags are the older form.
    const fromImeta = [...imeta.keys()];
    return (tagged.length || !fromImeta.length ? urls : fromImeta)
      .filter(isHttpUrl)
      .map((url) => {
        const dim = imetaFor(imeta, url)?.dim;
        return {
          url: tokenizeEventMediaUrl(url, event),
          type: "image" as const,
          matchText: url,
          ...source,
          ...(dim ? { dim } : {}),
        };
      });
  }
  return extractMediaUrls(event.content, event);
}

/** Scheme-check an event-derived URL before placing it in `src` (security). */
function isHttpUrl(u?: string | null): u is string {
  if (!u) return false;
  try {
    const p = new URL(u).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
}

function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}
