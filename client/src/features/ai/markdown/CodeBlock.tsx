import { useRef, useState, isValidElement, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Fenced code block (react-markdown's `pre` renderer): a header bar with the
 * detected language + a copy button, over the highlighted `<code>` children
 * (from rehype-highlight). Matches the code-card pattern used by ChatGPT/Claude.
 */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const lang = extractLanguage(children);

  const copy = () => {
    const text = ref.current?.textContent ?? "";
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-2.5 overflow-hidden rounded-lg ring-1 ring-border">
      <div className="flex items-center justify-between bg-surface px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
          {lang || "code"}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[10px] text-muted transition-colors hover:text-heading"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={11} className="text-green-400" />
              Copied
            </>
          ) : (
            <>
              <Copy size={11} />
              Copy
            </>
          )}
        </button>
      </div>
      <pre
        ref={ref}
        className="overflow-x-auto bg-panel p-3 text-xs leading-relaxed"
      >
        {children}
      </pre>
    </div>
  );
}

/** Pull the language from the child `<code class="language-xxx">`. */
function extractLanguage(children?: ReactNode): string {
  const el = Array.isArray(children) ? children[0] : children;
  if (!isValidElement(el)) return "";
  const className = (el.props as { className?: string }).className ?? "";
  const match = className.match(/language-(\w+)/);
  return match ? match[1] : "";
}
