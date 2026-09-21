import { useEffect, useState } from "react";
import { Download, FileText, Lock, AlertTriangle } from "lucide-react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { decryptDMFile } from "@ishtarservices/core";
import type { DMFileMeta } from "@ishtarservices/shared-types";

/** Anything above this is click-to-load rather than auto-fetched. */
const AUTO_LOAD_MAX_BYTES = 8 * 1024 * 1024;

interface DMFileAttachmentProps {
  meta: DMFileMeta;
  isMe: boolean;
  /** Auto-load without a click (friends / own messages). */
  autoLoad?: boolean;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; objectUrl: string }
  | { status: "error"; message: string };

const objectUrlCache = new Map<string, string>();

async function fetchAndDecrypt(meta: DMFileMeta): Promise<string> {
  const cached = objectUrlCache.get(meta.x);
  if (cached) return cached;
  const res = await tauriFetch(meta.url, { method: "GET" });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const ciphertext = new Uint8Array(await res.arrayBuffer());
  const plain = decryptDMFile(ciphertext, meta);
  const blob = new Blob([plain as BlobPart], { type: meta.fileType });
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(meta.x, url);
  return url;
}

/**
 * A kind-15 encrypted attachment (docs/DM_WIRE_CONTRACT.md §3.4): downloads the
 * opaque blob, verifies both hashes, decrypts with the key from the rumor and
 * renders it from an object URL. Nothing decrypted touches disk.
 */
export function DMFileAttachment({ meta, isMe, autoLoad }: DMFileAttachmentProps) {
  const small = (meta.size ?? 0) <= AUTO_LOAD_MAX_BYTES;
  const [state, setState] = useState<LoadState>(() =>
    objectUrlCache.has(meta.x) ? { status: "ready", objectUrl: objectUrlCache.get(meta.x)! } : { status: "idle" },
  );

  const load = () => {
    if (state.status === "loading" || state.status === "ready") return;
    setState({ status: "loading" });
    fetchAndDecrypt(meta)
      .then((objectUrl) => setState({ status: "ready", objectUrl }))
      .catch((err) => setState({ status: "error", message: err instanceof Error ? err.message : "failed" }));
  };

  useEffect(() => {
    if ((autoLoad || isMe) && small && state.status === "idle") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.x]);

  const isImage = meta.fileType.startsWith("image/");
  const isVideo = meta.fileType.startsWith("video/");
  const isAudio = meta.fileType.startsWith("audio/");
  const sizeLabel = meta.size ? `${(meta.size / 1024 / 1024).toFixed(meta.size > 1024 * 1024 ? 1 : 2)} MB` : "";

  if (state.status === "ready") {
    if (isImage) {
      return (
        <a href={state.objectUrl} target="_blank" rel="noreferrer" className="block">
          <img
            src={state.objectUrl}
            alt=""
            className="max-h-80 max-w-full rounded-lg object-contain"
            style={meta.dim ? { aspectRatio: meta.dim.replace("x", "/") } : undefined}
          />
        </a>
      );
    }
    if (isVideo) return <video src={state.objectUrl} controls className="max-h-80 max-w-full rounded-lg" />;
    if (isAudio) return <audio src={state.objectUrl} controls className="w-64 max-w-full" />;
    return (
      <a
        href={state.objectUrl}
        download
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-body hover:bg-surface-hover"
      >
        <FileText size={14} />
        <span className="truncate">{meta.fileType}</span>
        {sizeLabel && <span className="text-muted">{sizeLabel}</span>}
        <Download size={12} className="text-muted" />
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={load}
      disabled={state.status === "loading"}
      className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-soft hover:bg-surface-hover disabled:opacity-60"
      title={state.status === "error" ? state.message : "Encrypted attachment"}
      data-testid="dm-attachment"
    >
      {state.status === "error" ? (
        <AlertTriangle size={14} className="text-red-400" />
      ) : (
        <Lock size={14} className="text-primary" />
      )}
      <span>
        {state.status === "loading"
          ? "Decrypting…"
          : state.status === "error"
            ? "Couldn't open attachment"
            : isImage
              ? "Encrypted photo"
              : isVideo
                ? "Encrypted video"
                : isAudio
                  ? "Encrypted voice note"
                  : "Encrypted file"}
      </span>
      {sizeLabel && <span className="text-muted">{sizeLabel}</span>}
    </button>
  );
}
