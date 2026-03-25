import { useState } from "react";
import { parseInlineMarkdown, type InlineToken } from "@/lib/content/parseInlineMarkdown";

interface InlineMarkdownProps {
  text: string;
}

/**
 * Renders a plain text string with inline markdown formatting.
 * Used by RichContent for `text` segments.
 */
export function InlineMarkdown({ text }: InlineMarkdownProps) {
  const tokens = parseInlineMarkdown(text);

  // Fast path: single plain token = no formatting
  if (tokens.length === 1 && tokens[0].type === "plain") {
    return <>{tokens[0].text}</>;
  }

  return (
    <>
      {tokens.map((token, i) => (
        <InlineToken key={i} token={token} />
      ))}
    </>
  );
}

function InlineToken({ token }: { token: InlineToken }) {
  switch (token.type) {
    case "plain":
      return <>{token.text}</>;

    case "bold":
      return <strong className="font-semibold">{token.text}</strong>;

    case "italic":
      return <em className="italic">{token.text}</em>;

    case "bold-italic":
      return (
        <strong className="font-semibold">
          <em className="italic">{token.text}</em>
        </strong>
      );

    case "strikethrough":
      return <s className="line-through text-muted">{token.text}</s>;

    case "code":
      return (
        <code className="rounded bg-surface px-1.5 py-0.5 text-xs font-mono text-primary/80">
          {token.text}
        </code>
      );

    case "code-block":
      return (
        <pre className="my-1 block rounded-lg bg-panel border border-border p-3 text-xs font-mono text-primary/80 overflow-x-auto whitespace-pre-wrap">
          {token.lang && (
            <span className="block text-[10px] text-faint mb-1">{token.lang}</span>
          )}
          <code>{token.text}</code>
        </pre>
      );

    case "spoiler":
      return <SpoilerSpan text={token.text} />;

    default:
      return null;
  }
}

function SpoilerSpan({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setRevealed((r) => !r)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setRevealed((r) => !r);
        }
      }}
      className={`rounded px-0.5 cursor-pointer transition-all duration-200 ${
        revealed
          ? "bg-surface/50"
          : "bg-surface select-none blur-[4px] hover:blur-[3px]"
      }`}
      title={revealed ? "Click to hide" : "Click to reveal spoiler"}
    >
      {text}
    </span>
  );
}
