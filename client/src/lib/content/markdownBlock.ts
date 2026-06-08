/**
 * Pure, line-aware markdown block helpers for the article editor toolbar.
 *
 * These power the "friendly" formatting buttons (headings, lists, quotes, links,
 * images) so a user never has to type markdown syntax themselves. Each function
 * is pure — it takes the current textarea value + selection and returns the new
 * value plus where the cursor/selection should land — which makes them trivial
 * to unit-test and keeps DOM concerns in the component.
 *
 * Inline wrapping (bold/italic/code) lives in {@link wrapSelection}; this module
 * is for block-level / multi-line transforms and link/image insertion.
 */

export interface BlockResult {
  newValue: string;
  newCursorStart: number;
  newCursorEnd: number;
}

/** Find the [start, end) range of the full lines spanned by a selection. */
function blockBounds(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } {
  const start = value.lastIndexOf("\n", selectionStart - 1) + 1;
  // A non-empty selection that ends exactly at a line start should not pull in
  // the following (empty) line — step back one char before searching forward.
  let searchFrom = selectionEnd;
  if (selectionEnd > selectionStart && value[selectionEnd - 1] === "\n") {
    searchFrom = selectionEnd - 1;
  }
  const nl = value.indexOf("\n", searchFrom);
  const end = nl === -1 ? value.length : nl;
  return { start, end };
}

/**
 * Apply a per-line transform to the lines spanned by the selection, then return
 * a result whose new selection covers the rewritten block. `transform` receives
 * every line (including blank ones) and its index among the spanned lines.
 */
function mapLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  transform: (line: string, index: number) => string,
): BlockResult {
  const { start, end } = blockBounds(value, selectionStart, selectionEnd);
  const before = value.slice(0, start);
  const block = value.slice(start, end);
  const after = value.slice(end);
  const newBlock = block.split("\n").map(transform).join("\n");
  return {
    newValue: before + newBlock + after,
    newCursorStart: start,
    newCursorEnd: start + newBlock.length,
  };
}

const HEADING_RE = /^(#{1,6})\s+/;
const BULLET_RE = /^[-*]\s+/;
const NUMBER_RE = /^\d+\.\s+/;
const QUOTE_RE = /^>\s?/;

/**
 * Toggle a heading of `level` (1-3) on the spanned line(s).
 * Off when every non-blank line is already exactly that level; otherwise it
 * normalizes every non-blank line to that level (replacing any other level).
 */
export function toggleHeading(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  level: 1 | 2 | 3,
): BlockResult {
  const { start, end } = blockBounds(value, selectionStart, selectionEnd);
  const lines = value.slice(start, end).split("\n");
  const prefix = "#".repeat(level) + " ";
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  const allAtLevel =
    nonBlank.length > 0 &&
    nonBlank.every((l) => {
      const m = l.match(HEADING_RE);
      return m && m[1].length === level;
    });

  return mapLines(value, selectionStart, selectionEnd, (line) => {
    if (line.trim().length === 0) return line;
    const stripped = line.replace(HEADING_RE, "");
    return allAtLevel ? stripped : prefix + stripped;
  });
}

/** Toggle a `- ` bullet list on the spanned line(s). */
export function toggleBulletList(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): BlockResult {
  const { start, end } = blockBounds(value, selectionStart, selectionEnd);
  const lines = value.slice(start, end).split("\n");
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  const allBullets =
    nonBlank.length > 0 && nonBlank.every((l) => BULLET_RE.test(l));

  return mapLines(value, selectionStart, selectionEnd, (line) => {
    if (line.trim().length === 0) return line;
    if (allBullets) return line.replace(BULLET_RE, "");
    // Replace an existing number/quote prefix, then bullet it.
    const stripped = line.replace(NUMBER_RE, "").replace(QUOTE_RE, "");
    return "- " + stripped;
  });
}

/** Toggle a `1. 2. 3.` ordered list on the spanned line(s), renumbering. */
export function toggleNumberList(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): BlockResult {
  const { start, end } = blockBounds(value, selectionStart, selectionEnd);
  const lines = value.slice(start, end).split("\n");
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  const allNumbered =
    nonBlank.length > 0 && nonBlank.every((l) => NUMBER_RE.test(l));

  let n = 0;
  return mapLines(value, selectionStart, selectionEnd, (line) => {
    if (line.trim().length === 0) return line;
    if (allNumbered) return line.replace(NUMBER_RE, "");
    n += 1;
    const stripped = line.replace(BULLET_RE, "").replace(QUOTE_RE, "");
    return `${n}. ${stripped}`;
  });
}

/** Toggle a `> ` blockquote on the spanned line(s). */
export function toggleQuote(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): BlockResult {
  const { start, end } = blockBounds(value, selectionStart, selectionEnd);
  const lines = value.slice(start, end).split("\n");
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  const allQuoted =
    nonBlank.length > 0 && nonBlank.every((l) => QUOTE_RE.test(l));

  return mapLines(value, selectionStart, selectionEnd, (line) => {
    if (line.trim().length === 0) return line;
    return allQuoted ? line.replace(QUOTE_RE, "") : "> " + line;
  });
}

/**
 * Insert a markdown link. Uses the current selection as the link text when one
 * exists (otherwise `text`, falling back to the URL). The returned selection
 * highlights the link *text* so the user can immediately retype the label.
 */
export function insertLink(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  opts: { url: string; text?: string },
): BlockResult {
  const selected = value.slice(selectionStart, selectionEnd);
  const label = (selected || opts.text || opts.url || "link").trim() || "link";
  const url = opts.url.trim();
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const snippet = `[${label}](${url})`;
  return {
    newValue: before + snippet + after,
    // Highlight just the label text inside the brackets.
    newCursorStart: before.length + 1,
    newCursorEnd: before.length + 1 + label.length,
  };
}

/**
 * Insert a markdown image on its own line(s) (a selection, if any, is replaced).
 * `alt` is supplied by the caller (e.g. the file name). The cursor lands just
 * after the inserted image.
 */
export function insertImage(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  opts: { url: string; alt?: string },
): BlockResult {
  const alt = (opts.alt ?? "").trim();
  const url = opts.url.trim();
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const lead = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const trail = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
  const snippet = `${lead}![${alt}](${url})${trail}`;
  const caret = before.length + snippet.length - trail.length;
  return {
    newValue: before + snippet + after,
    newCursorStart: caret,
    newCursorEnd: caret,
  };
}
