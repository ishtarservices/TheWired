import { useState } from "react";
import { Copy, Check, Download } from "lucide-react";
import type { AIArtifact } from "@/types/ai";
import { safeImageSrc } from "../markdown/safeUrl";

const EXT: Record<string, string> = {
  document: "md",
  table: "md",
  chart: "json",
  code: "txt",
};

function filenameFor(artifact: AIArtifact): string {
  const base = artifact.title.replace(/[^\w.-]+/g, "_").slice(0, 40) || "artifact";
  const ext = artifact.type === "code" ? artifact.language || "txt" : EXT[artifact.type] || "txt";
  return `${base}.${ext}`;
}

/** Copy / download (and, via AIPublishMenu, publish) for an artifact. */
export function ArtifactActions({
  artifact,
  children,
}: {
  artifact: AIArtifact;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    if (artifact.type === "image") {
      // The URL is model-controlled — open only http(s); never a javascript:/data: scheme.
      const safe = safeImageSrc(artifact.content.trim());
      if (safe) window.open(safe, "_blank", "noopener,noreferrer");
      return;
    }
    const blob = new Blob([artifact.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameFor(artifact);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="flex items-center gap-1">
      {children}
      <button
        onClick={copy}
        className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-heading"
        title="Copy"
        aria-label="Copy artifact"
      >
        {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
      </button>
      <button
        onClick={download}
        className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-heading"
        title="Download"
        aria-label="Download artifact"
      >
        <Download size={14} />
      </button>
    </div>
  );
}
