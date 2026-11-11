import type { ContentSegment } from "./parseContent";

/**
 * Chat and DM message layout: the body's text stays in the flow, while media
 * and cards (images, videos, shared posts, link embeds, invites, files) are
 * lifted out and drawn as attachments below it, the way chat apps show them.
 *
 * Lifting a URL out of the text leaves the whitespace around it behind; the
 * text is re-joined across each gap so a URL on its own line doesn't leave a
 * blank line, and a URL mid-sentence doesn't leave a double space.
 */
export interface MessageLayout {
  /** Inline segments, whitespace normalized. Empty when the body was only attachments. */
  flow: ContentSegment[];
  /** Lifted segments, in their original order. */
  attachments: ContentSegment[];
}

export type MediaSegment = Extract<ContentSegment, { type: "image" | "video" | "audio" }>;

export function isMediaSegment(seg: ContentSegment): seg is MediaSegment {
  return seg.type === "image" || seg.type === "video" || seg.type === "audio";
}

const ATTACHMENT_TYPES = new Set<ContentSegment["type"]>([
  "image",
  "video",
  "audio",
  "blob",
  "file",
  "event-ref",
  "addr-ref",
  "embed",
  "invite",
]);

/**
 * @param isCardUrl a plain `url` segment that renders as a card (a music
 *   provider link) is lifted too.
 */
export function splitMessageSegments(
  segments: ContentSegment[],
  isCardUrl?: (url: string) => boolean,
): MessageLayout {
  const flow: ContentSegment[] = [];
  const attachments: ContentSegment[] = [];
  let gap = false;

  for (const seg of segments) {
    const lifted = ATTACHMENT_TYPES.has(seg.type) || (seg.type === "url" && !!isCardUrl?.(seg.url));
    if (lifted) {
      attachments.push(seg);
      gap = true;
      continue;
    }
    const last = flow[flow.length - 1];
    if (seg.type === "text" && gap && last?.type === "text") {
      flow[flow.length - 1] = { type: "text", text: joinAcrossGap(last.text, seg.text) };
    } else if (seg.type === "text" && gap && last) {
      // After a mention / hashtag / emoji: keep one space before the words.
      flow.push({ type: "text", text: seg.text.replace(/^[ \t]+/, " ") });
    } else {
      flow.push(seg);
    }
    gap = false;
  }

  return { flow: tidyFlow(flow), attachments };
}

/** Join the text on both sides of a lifted attachment. */
function joinAcrossGap(left: string, right: string): string {
  const spaced = /[ \t]$/.test(left) || /^[ \t]/.test(right);
  const l = left.replace(/[ \t]+$/, "");
  const r = right.replace(/^[ \t]+/, "");
  // The URL had a line of its own: one line break, not a blank line.
  if (l.endsWith("\n") && r.startsWith("\n")) return l + r.slice(1);
  if (!l || l.endsWith("\n") || r.startsWith("\n")) return l + r;
  // Mid-sentence: one space between the words the URL sat between.
  return spaced ? `${l} ${r}` : l + r;
}

/** Trim the ends, collapse runs of blank lines, drop empty text. */
function tidyFlow(flow: ContentSegment[]): ContentSegment[] {
  const out = flow.map((seg) =>
    seg.type === "text" ? { type: "text" as const, text: seg.text.replace(/\n{3,}/g, "\n\n") } : seg,
  );
  const first = out[0];
  if (first?.type === "text") out[0] = { type: "text", text: first.text.replace(/^\s+/, "") };
  const lastIdx = out.length - 1;
  const last = out[lastIdx];
  if (last?.type === "text") out[lastIdx] = { type: "text", text: last.text.replace(/\s+$/, "") };
  return out.filter((seg) => seg.type !== "text" || seg.text.length > 0);
}

/** A body that is nothing but images / videos (no text, no cards): DMs draw
 *  it without the bubble around it. */
export function isMediaOnly(layout: MessageLayout): boolean {
  return (
    layout.flow.length === 0 &&
    layout.attachments.length > 0 &&
    layout.attachments.every((s) => s.type === "image" || s.type === "video" || s.type === "blob")
  );
}
