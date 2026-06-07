import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

/**
 * Renders long-form article markdown (kind:30023 body) — the SINGLE place this
 * config lives, shared by the reader and the editor's live preview.
 *
 * SECURITY: article bodies are attacker-controlled. We rely on react-markdown's
 * safe defaults — raw HTML is NOT rendered and `javascript:`/`data:` URLs are
 * neutralized. Do NOT add `rehype-raw` or `allowDangerousHtml` here; that would
 * re-open HTML injection on every article anyone publishes. See the
 * `nostr-security` skill (§ "Longform markdown").
 */
export function ArticleMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-invert max-w-none prose-headings:text-heading prose-p:text-body prose-a:text-primary-soft prose-code:text-primary-soft prose-pre:bg-panel">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </Markdown>
    </div>
  );
}
