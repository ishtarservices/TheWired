/**
 * Lightweight inline markdown tokenizer for chat/DM messages.
 *
 * Handles: bold, italic, bold-italic, strikethrough, inline code,
 * code blocks, and spoilers. No block-level elements (headings, lists, etc).
 *
 * Designed to run ONLY on `text` segments that come out of the NIP-27
 * `parseContent()` pipeline, so markdown inside nostr: URIs or URLs
 * is never processed.
 */

export type InlineToken =
  | { type: "plain"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "bold-italic"; text: string }
  | { type: "strikethrough"; text: string }
  | { type: "code"; text: string }
  | { type: "code-block"; text: string; lang?: string }
  | { type: "spoiler"; text: string };

/**
 * Marker definitions in priority order.
 * Code markers are extracted first since they suppress inner formatting.
 * Longer markers come before shorter ones (*** before ** before *).
 */
interface MarkerDef {
  pattern: RegExp;
  type: InlineToken["type"];
}

// Code block: ```lang?\n...\n``` or ```...```
const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```|```([\s\S]*?)```/g;
// Inline code: `...`
const INLINE_CODE_RE = /`([^`\n]+)`/g;

// Inline formatting markers (applied after code extraction)
const INLINE_MARKERS: MarkerDef[] = [
  // Bold-italic: ***text*** or ___text___
  { pattern: /\*\*\*(.+?)\*\*\*|___(.+?)___/g, type: "bold-italic" },
  // Bold: **text** or __text__
  { pattern: /\*\*(.+?)\*\*|__(.+?)__/g, type: "bold" },
  // Italic: *text* or _text_ (underscore requires word boundaries to avoid snake_case)
  { pattern: /\*(.+?)\*|(?<=^|\s|[^\w])_(.+?)_(?=$|\s|[^\w])/g, type: "italic" },
  // Strikethrough: ~~text~~
  { pattern: /~~(.+?)~~/g, type: "strikethrough" },
  // Spoiler: ||text||
  { pattern: /\|\|(.+?)\|\|/g, type: "spoiler" },
];

interface Span {
  start: number;
  end: number;
  type: InlineToken["type"];
  text: string;
  lang?: string;
}

/**
 * Parse a plain text string into inline markdown tokens.
 *
 * The approach: find all marker matches, resolve overlaps by priority,
 * then build the token array from the non-overlapping spans.
 */
export function parseInlineMarkdown(text: string): InlineToken[] {
  if (!text) return [];

  const spans: Span[] = [];

  // --- Phase 1: Extract code blocks (highest priority, suppresses all inner formatting) ---
  CODE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
    // Check for escape
    if (match.index > 0 && text[match.index - 1] === "\\") continue;
    const lang = match[1] || undefined;
    const content = match[2] ?? match[3] ?? "";
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      type: "code-block",
      text: content,
      lang: lang || undefined,
    });
  }

  // --- Phase 2: Extract inline code (second priority, suppresses inner formatting) ---
  INLINE_CODE_RE.lastIndex = 0;
  while ((match = INLINE_CODE_RE.exec(text)) !== null) {
    if (match.index > 0 && text[match.index - 1] === "\\") continue;
    if (overlapsAny(spans, match.index, match.index + match[0].length)) continue;
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      type: "code",
      text: match[1],
    });
  }

  // --- Phase 3: Extract inline formatting markers ---
  for (const marker of INLINE_MARKERS) {
    marker.pattern.lastIndex = 0;
    while ((match = marker.pattern.exec(text)) !== null) {
      // Check for escape character
      if (match.index > 0 && text[match.index - 1] === "\\") continue;
      // Skip if overlaps with an already-claimed span
      if (overlapsAny(spans, match.index, match.index + match[0].length)) continue;
      // Capture groups: first non-undefined group is the content
      const content = match[1] ?? match[2] ?? "";
      if (!content) continue;
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        type: marker.type,
        text: content,
      });
    }
  }

  // If no formatting found, return as-is (fast path)
  if (spans.length === 0) {
    return [{ type: "plain", text }];
  }

  // --- Phase 4: Sort spans by start position and build token array ---
  spans.sort((a, b) => a.start - b.start);

  const tokens: InlineToken[] = [];
  let cursor = 0;

  for (const span of spans) {
    // Plain text before this span
    if (span.start > cursor) {
      const plain = processEscapes(text.slice(cursor, span.start));
      if (plain) tokens.push({ type: "plain", text: plain });
    }

    if (span.type === "code-block") {
      tokens.push({ type: "code-block", text: span.text, lang: span.lang });
    } else {
      tokens.push({ type: span.type, text: span.text } as InlineToken);
    }

    cursor = span.end;
  }

  // Trailing plain text
  if (cursor < text.length) {
    const plain = processEscapes(text.slice(cursor));
    if (plain) tokens.push({ type: "plain", text: plain });
  }

  return tokens;
}

/** Check if a range [start, end) overlaps any existing span */
function overlapsAny(spans: Span[], start: number, end: number): boolean {
  return spans.some((s) => start < s.end && end > s.start);
}

/** Remove escape backslashes before markdown markers */
function processEscapes(text: string): string {
  return text.replace(/\\([*_~`|])/g, "$1");
}
