import { FileText } from "lucide-react";
import { parseContent, type ContentSegment } from "@/lib/content/parseContent";
import { MentionLink } from "./MentionLink";
import { InlineMarkdown } from "./InlineMarkdown";
import { EmbedRenderer } from "./EmbedRenderer";
import { MusicEmbedCard } from "./MusicEmbedCard";
import { InviteCard } from "./InviteCard";
import { SmartImage, SmartVideo } from "../media";

interface RichContentProps {
  content: string;
  /** NIP-30 emoji tags from the event: [["emoji", shortcode, url], ...] */
  emojiTags?: string[][];
  onMentionClick?: (pubkey: string, anchor: HTMLElement) => void;
}

export function RichContent({ content, emojiTags, onMentionClick }: RichContentProps) {
  const segments = parseContent(content, emojiTags);

  return (
    <span className="whitespace-pre-wrap wrap-break-word">
      {segments.map((seg, i) => (
        <RichSegment key={i} segment={seg} onMentionClick={onMentionClick} />
      ))}
    </span>
  );
}

function RichSegment({
  segment,
  onMentionClick,
}: {
  segment: ContentSegment;
  onMentionClick?: (pubkey: string, anchor: HTMLElement) => void;
}) {
  switch (segment.type) {
    case "text":
      return <InlineMarkdown text={segment.text} />;

    case "mention":
      return <MentionLink pubkey={segment.pubkey} onClick={onMentionClick} />;

    case "event-ref":
      return (
        <span className="font-mono text-xs text-primary/70 bg-surface px-1 py-0.5 rounded">
          {segment.id.slice(0, 8)}...
        </span>
      );

    case "addr-ref":
      if (segment.kind === 31683 || segment.kind === 33123) {
        return (
          <MusicEmbedCard
            kind={segment.kind}
            pubkey={segment.pubkey}
            identifier={segment.identifier}
          />
        );
      }
      return (
        <span className="font-mono text-xs text-primary/70 bg-surface px-1 py-0.5 rounded">
          {segment.identifier || "addr"}
        </span>
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
