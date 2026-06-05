/**
 * Model-agnostic artifact extraction from assistant text. Works with BOTH dumb
 * local models (which only emit fenced code blocks) and steerable/tool-capable
 * models (which can emit a `:::artifact{...}` directive). Returns the message as
 * an ordered list of prose/artifact segments so the bubble can render prose as
 * markdown and substantial/structured output as an inline chip → side panel.
 *
 * Signals (research: artifacts-canvas brief):
 *  - ```chart  / ```table / ```artifact:document / ```document  → typed artifact
 *  - a large code fence (≥ CODE_MIN_LINES) → code artifact; small ones stay inline
 *  - ```mermaid / ```svg / ```html → code artifact (rendered as code for now)
 *  - `:::artifact{type="…" title="…"}\n…\n:::` directive → typed artifact
 */
import type { AIArtifactType } from "@/types/ai";

export interface ParsedArtifact {
  type: AIArtifactType;
  title: string;
  language?: string;
  content: string;
}

export type ArtifactSegment =
  | { kind: "text"; text: string }
  | { kind: "artifact"; artifact: ParsedArtifact };

/** A fenced code block becomes a code artifact only past this size. */
const CODE_MIN_LINES = 15;

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;
const DIRECTIVE_RE = /:::artifact\{([^}]*)\}\n([\s\S]*?)\n:::/g;

interface RawMatch {
  start: number;
  end: number;
  artifact: ParsedArtifact;
}

function firstHeading(markdown: string, fallback: string): string {
  const m = markdown.match(/^#{1,6}\s+(.+)$/m) ?? markdown.match(/^(.{3,60})/);
  return (m?.[1] ?? fallback).trim().slice(0, 80) || fallback;
}

/** Classify a fenced block by its info string + size. Returns null to keep inline. */
function classifyFence(info: string, body: string): ParsedArtifact | null {
  const lang = info.trim().toLowerCase();
  const lines = body.split("\n").length;

  if (lang === "chart") return { type: "chart", title: "Chart", content: body };
  if (lang === "table") return { type: "table", title: "Table", content: body };
  if (lang === "artifact:document" || lang === "document")
    return { type: "document", title: firstHeading(body, "Document"), content: body };

  const isCodey =
    lang.length > 0 &&
    lang !== "text" &&
    lang !== "json" /* json stays inline unless big */;
  if ((isCodey || lang === "json") && lines >= CODE_MIN_LINES) {
    return {
      type: "code",
      title: `${lang || "code"} snippet`,
      language: lang || undefined,
      content: body,
    };
  }
  return null;
}

function mimeToType(mime: string): { type: AIArtifactType; language?: string } {
  const m = mime.trim().toLowerCase();
  if (m.includes("chart")) return { type: "chart" };
  if (m.includes("table")) return { type: "table" };
  // Markup/code first — incl. SVG, which is source to render as code, not an
  // image URL (the image renderer expects a URL, not inline markup).
  if (
    m.includes("svg") ||
    m === "text/html" ||
    m.includes("code") ||
    m.includes("mermaid")
  )
    return { type: "code" };
  if (m.startsWith("image/")) return { type: "image" };
  if (m === "text/markdown" || m === "text/plain") return { type: "document" };
  return { type: "document" };
}

function parseDirectiveAttrs(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of attrs.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** Collect raw artifact matches (fences + directives) with positions. */
function collectMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = [];

  for (const m of text.matchAll(DIRECTIVE_RE)) {
    const attrs = parseDirectiveAttrs(m[1]);
    const { type, language } = mimeToType(attrs.type ?? "text/markdown");
    matches.push({
      start: m.index!,
      end: m.index! + m[0].length,
      artifact: {
        type,
        title: (attrs.title ?? type).slice(0, 80),
        language: attrs.lang ?? language,
        content: m[2],
      },
    });
  }

  for (const m of text.matchAll(FENCE_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    // Skip fences nested inside an already-claimed directive range.
    if (matches.some((x) => start >= x.start && end <= x.end)) continue;
    const artifact = classifyFence(m[1], m[2]);
    if (artifact) matches.push({ start, end, artifact });
  }

  return matches.sort((a, b) => a.start - b.start);
}

/** Split assistant text into ordered prose/artifact segments. */
export function parseArtifactSegments(text: string): ArtifactSegment[] {
  const matches = collectMatches(text);
  if (matches.length === 0) return [{ kind: "text", text }];

  const segments: ArtifactSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) {
      const prose = text.slice(cursor, m.start);
      if (prose.trim()) segments.push({ kind: "text", text: prose });
    }
    segments.push({ kind: "artifact", artifact: m.artifact });
    cursor = m.end;
  }
  if (cursor < text.length) {
    const tail = text.slice(cursor);
    if (tail.trim()) segments.push({ kind: "text", text: tail });
  }
  return segments;
}

/** Just the artifacts, in document order (used at stream completion). */
export function extractArtifacts(text: string): ParsedArtifact[] {
  return collectMatches(text).map((m) => m.artifact);
}
