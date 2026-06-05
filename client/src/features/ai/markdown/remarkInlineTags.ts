/**
 * remark plugin: render a STRICT allowlist of safe inline formatting HTML tags
 * that models emit but Markdown has no syntax for (notably `<u>` — there is no
 * Markdown underline). It does NOT enable raw HTML (the nostr-security skill
 * forbids `rehype-raw`/`allowDangerousHtml`).
 *
 * CommonMark already parses inline tags into separate `html` nodes (`<u>` and
 * `</u>` as siblings around the inner content). We pair a bare, attribute-free
 * allowlisted OPEN tag with its matching CLOSE tag and wrap the nodes between
 * them in an mdast node carrying `data.hName` — which remark-rehype renders as
 * that element. Everything else — other tags, ANY attributes, scripts, URLs —
 * never matches the bare-tag pattern and stays a literal, react-escaped `html`
 * node (i.e. plain text). Inner content keeps its normal Markdown parsing.
 */

// Allowlisted tag → the element we render. No attributes are ever carried.
const TAG_TO_HTML: Record<string, string> = {
  u: "u",
  ins: "u",
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  s: "del",
  strike: "del",
  del: "del",
  mark: "mark",
  sub: "sub",
  sup: "sup",
};

const OPEN_RE = /^<(u|ins|b|strong|i|em|s|strike|del|mark|sub|sup)>$/i;
const BR_RE = /^<br\s*\/?>$/i;

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string };
}

function htmlTag(node: MdNode): string | null {
  if (node.type !== "html" || typeof node.value !== "string") return null;
  return node.value.trim();
}

function transform(node: MdNode): void {
  if (!node.children || node.type === "code" || node.type === "inlineCode") return;

  const children = node.children;
  const out: MdNode[] = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    const tagText = htmlTag(child);

    if (tagText && BR_RE.test(tagText)) {
      out.push({ type: "break" });
      i++;
      continue;
    }

    const open = tagText?.match(OPEN_RE);
    if (open) {
      const tag = open[1].toLowerCase();
      const closeLower = `</${tag}>`;
      // Find the matching close among the following siblings (depth-aware).
      let depth = 1;
      let j = i + 1;
      for (; j < children.length; j++) {
        const t = htmlTag(children[j])?.toLowerCase();
        if (!t) continue;
        if (t === `<${tag}>`) depth++;
        else if (t === closeLower && --depth === 0) break;
      }
      if (j < children.length) {
        const inner = children.slice(i + 1, j);
        inner.forEach(transform); // allow Markdown / nested allowlisted tags inside
        out.push({
          type: "inlineTag",
          data: { hName: TAG_TO_HTML[tag] },
          children: inner,
        });
        i = j + 1;
        continue;
      }
      // No matching close → leave the open tag as-is (renders literal).
    }

    transform(child);
    out.push(child);
    i++;
  }
  node.children = out;
}

export function remarkInlineTags() {
  return (tree: MdNode): void => {
    transform(tree);
  };
}
