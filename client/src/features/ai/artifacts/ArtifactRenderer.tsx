/**
 * Per-type artifact viewer. The chart path is lazy-loaded so recharts stays out
 * of the main bundle until a chart is actually shown. All content is untrusted
 * model output: markdown goes through the sanitized AIMarkdown stack, charts
 * through the validated ChartSpec parser, images through scheme-allowlisted URLs.
 */
import { Suspense, lazy, useState } from "react";
import { AlertTriangle, Image as ImageIcon } from "lucide-react";
import { AIMarkdown } from "../markdown/AIMarkdown";
import { safeImageSrc } from "../markdown/safeUrl";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import type { AIArtifact } from "@/types/ai";
import { parseChartSpec } from "./chartSpec";
import { TableArtifact } from "./TableArtifact";

const ChartArtifact = lazy(() => import("./ChartArtifact"));

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function ChartView({ content }: { content: string }) {
  const result = parseChartSpec(content);
  if (!result.ok) return <ErrorCard message={`Couldn't render chart: ${result.error}`} />;
  return (
    <Suspense
      fallback={<div className="h-[300px] animate-pulse rounded-lg bg-surface" />}
    >
      <ChartArtifact spec={result.spec} />
    </Suspense>
  );
}

function ImageView({ artifact }: { artifact: AIArtifact }) {
  const [loaded, setLoaded] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const safe = safeImageSrc(artifact.content.trim());
  if (!safe) return <ErrorCard message="Image URL is not allowed." />;

  // Click-to-load: model output is untrusted; never auto-fetch a remote image
  // (EchoLeak exfil channel — see SafeImage).
  if (!loaded) {
    let host = "remote source";
    try {
      host = new URL(safe).host || host;
    } catch {
      /* keep default */
    }
    return (
      <button
        type="button"
        onClick={() => setLoaded(true)}
        title={safe}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-8 text-xs text-soft transition-colors hover:border-primary/30 hover:text-heading"
      >
        <ImageIcon size={16} className="text-muted" />
        Load image from {host}
      </button>
    );
  }

  return (
    <>
      <button onClick={() => setLightbox(true)} className="block w-full">
        <img
          src={safe}
          alt={artifact.title}
          loading="lazy"
          className="mx-auto max-h-[70vh] rounded-lg"
        />
      </button>
      {lightbox && (
        <MediaLightbox src={safe} alt={artifact.title} onClose={() => setLightbox(false)} />
      )}
    </>
  );
}

export function ArtifactRenderer({ artifact }: { artifact: AIArtifact }) {
  switch (artifact.type) {
    case "chart":
      return <ChartView content={artifact.content} />;
    case "table":
      return <TableArtifact content={artifact.content} />;
    case "image":
      return <ImageView artifact={artifact} />;
    case "code": {
      const lang = artifact.language ?? "";
      return <AIMarkdown content={`\`\`\`${lang}\n${artifact.content}\n\`\`\``} />;
    }
    case "document":
    default:
      return <AIMarkdown content={artifact.content} />;
  }
}
