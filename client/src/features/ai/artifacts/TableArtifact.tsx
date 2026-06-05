/**
 * Render a table artifact. The content may be a GFM markdown table (rendered as
 * is via the sanitized AIMarkdown stack), or a JSON array of objects (converted
 * to a markdown table first). Untrusted text is escaped by react-markdown.
 */
import { AIMarkdown } from "../markdown/AIMarkdown";

function escapeCell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 200);
}

/** Build a GFM markdown table from a JSON array of objects, else return null. */
function jsonToMarkdownTable(content: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(content.trim());
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  const rows = data.slice(0, 200).filter((r) => r && typeof r === "object");
  if (rows.length === 0) return null;
  const cols = Array.from(
    rows.reduce<Set<string>>((set, r) => {
      Object.keys(r as object).slice(0, 12).forEach((k) => set.add(k));
      return set;
    }, new Set()),
  ).slice(0, 12);
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((r) => `| ${cols.map((c) => escapeCell((r as Record<string, unknown>)[c])).join(" | ")} |`)
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}

export function TableArtifact({ content }: { content: string }) {
  const markdown = content.includes("|") ? content : jsonToMarkdownTable(content);
  if (!markdown) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-surface p-3 text-xs text-body">
        {content}
      </pre>
    );
  }
  return <AIMarkdown content={markdown} />;
}
