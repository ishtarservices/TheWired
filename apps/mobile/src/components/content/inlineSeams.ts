// When an event/addr ref lifts out of the text flow (NoteText renders it as
// a block card below), the strings on either side both keep the whitespace
// that surrounded the ref — rendered adjacent they read as a double gap
// ("sharing this  by @loki"). Merge adjacent string runs at those seams:
// newlines win over spaces so intentional line structure survives, and a
// pure-whitespace run left between two seams dissolves entirely.

export function collapseInlineSeams<T>(nodes: Array<T | string>): Array<T | string> {
  const out: Array<T | string> = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (typeof node === "string" && typeof prev === "string") {
      const newline = /\n\s*$/.test(prev) || /^\s*\n/.test(node);
      const left = prev.replace(/\s+$/, "");
      const right = node.replace(/^\s+/, "");
      const hadGap = left.length !== prev.length || right.length !== node.length;
      out[out.length - 1] =
        left && right ? left + (newline ? "\n" : hadGap ? " " : "") + right : left + right;
    } else {
      out.push(node);
    }
  }
  return out;
}
