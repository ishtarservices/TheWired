import { useState } from "react";
import { FileText } from "lucide-react";
import { parseContent, type ContentSegment } from "@/lib/content/parseContent";
import { MentionLink } from "./MentionLink";
import { EmbedRenderer } from "./EmbedRenderer";
import { MusicEmbedCard } from "./MusicEmbedCard";
import { MediaLightbox } from "../ui/MediaLightbox";

interface RichContentProps {
  content: string;
  onMentionClick?: (pubkey: string, anchor: HTMLElement) => void;
}

export function RichContent({ content, onMentionClick }: RichContentProps) {
  const segments = parseContent(content);

  return (
    <span className="whitespace-pre-wrap break-words">
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
      return <>{segment.text}</>;

    case "mention":
      return <MentionLink pubkey={segment.pubkey} onClick={onMentionClick} />;

    case "event-ref":
      return (
        <span className="font-mono text-xs text-neon/70 bg-surface px-1 py-0.5 rounded">
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
        <span className="font-mono text-xs text-neon/70 bg-surface px-1 py-0.5 rounded">
          {segment.identifier || "addr"}
        </span>
      );

    case "url":
      return (
        <a
          href={segment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-neon hover:underline break-all"
        >
          {segment.url}
        </a>
      );

    case "image":
      return <ClickableImage url={segment.url} />;

    case "video":
      return (
        <video
          src={segment.url}
          controls
          preload="metadata"
          className="max-w-xs max-h-60 rounded-lg mt-1"
        />
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
          className="mt-1 inline-flex items-center gap-2 rounded-lg border border-edge-light bg-surface px-3 py-2 text-sm text-neon hover:bg-surface-hover transition-colors"
        >
          <FileText size={16} className="flex-shrink-0 text-red-400/70" />
          <span className="truncate">{segment.filename}</span>
        </a>
      );

    case "embed":
      return <EmbedRenderer embed={segment.embed} />;

    case "hashtag":
      return <span className="text-pulse/80 font-medium">#{segment.value}</span>;

    default:
      return null;
  }
}

function ClickableImage({ url }: { url: string }) {
  const [lightbox, setLightbox] = useState(false);
  return (
    <>
      <img
        src={url}
        alt=""
        loading="lazy"
        onClick={() => setLightbox(true)}
        className="max-w-xs max-h-60 rounded-lg mt-1 inline-block cursor-zoom-in hover:opacity-90 transition-opacity"
      />
      {lightbox && (
        <MediaLightbox src={url} onClose={() => setLightbox(false)} />
      )}
    </>
  );
}
