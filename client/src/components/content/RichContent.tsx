import { FileText } from "lucide-react";
import { parseContent, type ContentSegment } from "@/lib/content/parseContent";
import { MentionLink } from "./MentionLink";
import { InlineMarkdown } from "./InlineMarkdown";
import { EmbedRenderer } from "./EmbedRenderer";
import { EmbeddedNote } from "./EmbeddedNote";
import { InviteCard } from "./InviteCard";
import { SmartImage, SmartVideo } from "../media";

interface RichContentProps {
  content: string;
  /** NIP-30 emoji tags from the event: [["emoji", shortcode, url], ...] */
  emojiTags?: string[][];
  onMentionClick?: (pubkey: string, anchor: HTMLElement) => void;
  /**
   * Event ids already rendered elsewhere (e.g. a dedicated quote card) — skip
   * the inline embed for them so the same note isn't shown twice.
   */
  suppressEventIds?: string[];
}

export function RichContent({ content, emojiTags, onMentionClick, suppressEventIds }: RichContentProps) {
  const segments = parseContent(content, emojiTags);

  return (
    <div className="whitespace-pre-wrap wrap-break-word">
      {segments.map((seg, i) => (
        <RichSegment
          key={i}
          segment={seg}
          onMentionClick={onMentionClick}
          suppressEventIds={suppressEventIds}
        />
      ))}
    </div>
  );
}

function RichSegment({
  segment,
  onMentionClick,
  suppressEventIds,
}: {
  segment: ContentSegment;
  onMentionClick?: (pubkey: string, anchor: HTMLElement) => void;
  suppressEventIds?: string[];
}) {
  switch (segment.type) {
    case "text":
      return <InlineMarkdown text={segment.text} />;

    case "mention":
      return <MentionLink pubkey={segment.pubkey} onClick={onMentionClick} />;

    case "event-ref":
      // Already rendered as a dedicated quote card elsewhere — don't duplicate.
      if (suppressEventIds?.includes(segment.id)) return null;
      return (
        <EmbeddedNote
          idRef={{
            id: segment.id,
            relays: segment.relays,
            author: segment.author,
            kind: segment.kind,
          }}
        />
      );

    case "addr-ref":
      return (
        <EmbeddedNote
          addrRef={{
            kind: segment.kind,
            pubkey: segment.pubkey,
            identifier: segment.identifier,
            relays: segment.relays,
          }}
        />
      );

    case "url":
      return (
        <a
          href={segment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-all"
        >
          {segment.url}
        </a>
      );

    case "image":
      return (
        <span className="mt-1 inline-block">
          <SmartImage url={segment.url} density="inline" />
        </span>
      );

    case "video":
      return (
        <span className="mt-1 inline-block">
          <SmartVideo url={segment.url} density="inline" />
        </span>
      );

    case "audio":
      return (
        <audio
          src={segment.url}
          controls
          preload="metadata"
          className="mt-1 max-w-xs"
        />
      );

    case "file":
      return (
        <a
          href={segment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-2 rounded-lg border border-border-light bg-surface px-3 py-2 text-sm text-primary hover:bg-surface-hover transition-colors"
        >
          <FileText size={16} className="shrink-0 text-red-400/70" />
          <span className="truncate">{segment.filename}</span>
        </a>
      );

    case "invite":
      return <InviteCard code={segment.code} />;

    case "embed":
      return <EmbedRenderer embed={segment.embed} />;

    case "custom-emoji":
      return (
        <img
          src={segment.url}
          alt={`:${segment.shortcode}:`}
          title={`:${segment.shortcode}:`}
          className="inline-block h-5 w-5 align-text-bottom object-contain"
          loading="lazy"
        />
      );

    case "hashtag":
      return <span className="text-primary/80 font-medium">#{segment.value}</span>;

    default:
      return null;
  }
}
