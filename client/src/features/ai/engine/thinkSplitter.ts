/**
 * Splits a streamed `content` field into reasoning vs. answer by tracking
 * `<think>…</think>` spans (the convention used by DeepSeek-R1, Qwen3, and most
 * local reasoning GGUFs). Tolerant of tags split across streaming deltas. Models
 * that expose reasoning via a separate `reasoning_content`/`reasoning` field
 * bypass this entirely (handled in the adapter).
 */
export type ThinkPiece = { kind: "text" | "reasoning"; text: string };

const OPEN = "<think>";
const CLOSE = "</think>";

/** Length of the trailing run of `buf` that is a prefix of `tag` — i.e. a
 *  possibly-incomplete tag we must hold back until the next delta arrives. */
function heldSuffixLen(buf: string, tag: string): number {
  const max = Math.min(buf.length, tag.length - 1);
  for (let k = max; k > 0; k--) {
    if (tag.startsWith(buf.slice(buf.length - k))) return k;
  }
  return 0;
}

export function createThinkSplitter() {
  let mode: "text" | "reasoning" = "text";
  let buf = "";

  function push(delta: string): ThinkPiece[] {
    buf += delta;
    const out: ThinkPiece[] = [];
    for (;;) {
      const tag = mode === "text" ? OPEN : CLOSE;
      const idx = buf.indexOf(tag);
      if (idx !== -1) {
        const before = buf.slice(0, idx);
        if (before) out.push({ kind: mode, text: before });
        buf = buf.slice(idx + tag.length);
        mode = mode === "text" ? "reasoning" : "text";
        continue;
      }
      const held = heldSuffixLen(buf, tag);
      const emit = buf.slice(0, buf.length - held);
      if (emit) out.push({ kind: mode, text: emit });
      buf = held ? buf.slice(buf.length - held) : "";
      break;
    }
    return out;
  }

  function flush(): ThinkPiece[] {
    if (!buf) return [];
    const out: ThinkPiece[] = [{ kind: mode, text: buf }];
    buf = "";
    return out;
  }

  return { push, flush };
}
