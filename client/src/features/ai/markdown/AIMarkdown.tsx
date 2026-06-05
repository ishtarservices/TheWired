import { memo, useMemo, useRef } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { Lexer } from "marked";
import "highlight.js/styles/github-dark.css";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { repairMarkdown } from "./repairMarkdown";
import { remarkInlineTags } from "./remarkInlineTags";
import { safeHref } from "./safeUrl";
import { SafeImage } from "./SafeImage";

/**
 * Markdown renderer tuned for streaming AI chat. Per best practice (Vercel AI SDK
 * cookbook, Streamdown): split into top-level blocks and memoize each so only the
 * last, growing block re-parses per token; repair incomplete tokens while
 * streaming; `remark-breaks` turns the model's single newlines into line breaks.
 * Element styling is hand-tuned for chat (line-height ~1.7, real paragraph/list
 * spacing) rather than article-oriented `prose`.
 */
const components: Components = {
  p: ({ children }) => (
    <p className="my-2 leading-[1.7] first:mt-0 last:mb-0">{children}</p>
  ),
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-base font-semibold text-heading first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-3.5 text-[15px] font-semibold text-heading first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold text-heading first:mt-0">
      {children}
    </h3>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-[1.7] [&>p]:my-0">{children}</li>
  ),
  a: ({ href, children, ...props }) => {
    const safe = safeHref(href);
    return safe ? (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary-soft underline-offset-2 hover:underline"
        {...props}
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  // Click-to-load (untrusted model output — never auto-fetch a remote image).
  img: ({ src, alt }) => (
    <SafeImage src={typeof src === "string" ? src : undefined} alt={alt} />
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children, ...props }) => {
    const isBlock = /\bhljs\b|\blanguage-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[0.85em] text-primary-soft">
        {children}
      </code>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-soft">
      {children}
    </blockquote>
  ),
  // Safe inline-formatting tags surfaced by remarkInlineTags (no raw HTML).
  u: ({ children }) => <u className="underline underline-offset-2">{children}</u>,
  mark: ({ children }) => (
    <mark className="rounded bg-primary/25 px-0.5 text-heading">{children}</mark>
  ),
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold text-heading">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 text-body">{children}</td>
  ),
};

const remarkPlugins = [remarkGfm, remarkBreaks, remarkInlineTags];
const rehypePlugins = [rehypeHighlight];

const MarkdownBlock = memo(function MarkdownBlock({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </Markdown>
  );
});

/** Split into top-level blocks via marked's lexer (`token.raw`), so a stable
 *  prefix of blocks can be memoized while only the last block re-parses. */
function splitBlocks(markdown: string): string[] {
  try {
    const blocks = Lexer.lex(markdown)
      .map((t) => t.raw)
      .filter((r) => r.length > 0);
    return blocks.length ? blocks : [markdown];
  } catch {
    return [markdown];
  }
}

/**
 * Block list with an incremental fast path during streaming: all blocks except
 * the last are final (`token.raw` concatenates exactly to the source), so we
 * re-lex only the growing tail instead of the whole string each flush — turning
 * the per-stream cost from O(n²) to ~O(n) (streaming-md research). Falls back to
 * a full lex whenever the cached prefix no longer matches (e.g. regenerate).
 */
function useIncrementalBlocks(content: string, streaming: boolean): string[] {
  const cache = useRef<{ text: string; blocks: string[] }>({ text: "", blocks: [] });
  return useMemo(() => {
    if (!streaming) {
      const blocks = splitBlocks(content);
      cache.current = { text: content, blocks };
      return blocks;
    }
    const prev = cache.current;
    if (prev.blocks.length > 1) {
      const committed = prev.blocks.slice(0, -1);
      const committedText = committed.join("");
      if (committedText && content.startsWith(committedText)) {
        const blocks = committed.concat(splitBlocks(content.slice(committedText.length)));
        cache.current = { text: content, blocks };
        return blocks;
      }
    }
    const blocks = splitBlocks(content);
    cache.current = { text: content, blocks };
    return blocks;
  }, [content, streaming]);
}

export const AIMarkdown = memo(function AIMarkdown({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const rawBlocks = useIncrementalBlocks(content, streaming);
  // Repair only the LAST (in-flight) block — avoids a whole-document scan each
  // flush and cross-block false positives in already-finished blocks.
  const blocks = useMemo(() => {
    if (!streaming || rawBlocks.length === 0) return rawBlocks;
    const out = rawBlocks.slice();
    out[out.length - 1] = repairMarkdown(out[out.length - 1]);
    return out;
  }, [rawBlocks, streaming]);

  return (
    <div className={cn("text-[14px] text-body", streaming && "ai-streaming")}>
      {blocks.map((block, i) => (
        <MarkdownBlock key={`b${i}`} content={block} />
      ))}
    </div>
  );
});
