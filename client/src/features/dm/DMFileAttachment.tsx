import { useEffect, useState } from "react";
import { Download, FileText, Lock, AlertTriangle, Loader2 } from "lucide-react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { blobFallbackCandidates, decryptDMFile, parseBlobUrl } from "@ishtarservices/core";
import type { DMFileMeta } from "@ishtarservices/shared-types";
import { ownBlossomOrigin } from "@/lib/api/blossom";
import { fetchAuthorServers } from "@/lib/media/authorServers";
import { isUnsafeHost } from "@/lib/security/ssrfGuard";
import { parseDim } from "@/lib/media/mediaDims";
import {
  CHAT_IMAGE_PLACEHOLDER,
  CHAT_VIDEO_PLACEHOLDER,
  SmartImage,
  SmartVideo,
  boundedMediaSize,
} from "@/components/media";

/** Tauri's HTTP plugin bypasses CORS in the desktop app; the plain browser
 *  preview has no `invoke` bridge, so fall back to window.fetch there. */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const httpFetch: typeof fetch = isTauri ? (tauriFetch as unknown as typeof fetch) : (...a) => fetch(...a);

/** Anything above this is click-to-load rather than auto-fetched. */
const AUTO_LOAD_MAX_BYTES = 8 * 1024 * 1024;

interface DMFileAttachmentProps {
  meta: DMFileMeta;
  /** Sender: their kind-10063 servers are tried by hash if the URL fails. */
  author?: string;
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

/**
 * May an attachment be fetched from this URL? The URL (and its fallbacks, and
 * the sender's kind-10063 servers) is chosen by the sender, and on desktop the
 * download goes through the Tauri HTTP plugin — no CORS, no CSP — so a friend
 * must not be able to point the app at loopback / private / link-local hosts.
 * Only public http(s) qualifies; the app's own API origin (loopback in dev) is
 * the one exception.
 */
export function isAllowedAttachmentUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.origin === ownBlossomOrigin()) return true;
  return !isUnsafeHost(u.hostname);
}

/** Download one candidate and decrypt it. `decryptDMFile` checks
 *  sha256(ciphertext) against `x` first, so a fallback server can't swap the
 *  bytes (docs/MEDIA_STORAGE.md §5). */
async function downloadAndDecrypt(url: string, meta: DMFileMeta): Promise<Uint8Array> {
  if (!isAllowedAttachmentUrl(url)) throw new Error("attachment host not allowed");
  const res = await httpFetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return decryptDMFile(new Uint8Array(await res.arrayBuffer()), meta);
}

/** Where else the same ciphertext may live, by hash: the rumor's `fallback`
 *  mirrors, our server, then the sender's kind-10063 servers. */
async function candidateUrls(meta: DMFileMeta, author?: string): Promise<string[]> {
  const x = meta.x.toLowerCase();
  const own = ownBlossomOrigin();
  // A non-Blossom primary URL still has a hash: retry it on our server.
  const base = parseBlobUrl(meta.url)?.sha256 === x ? meta.url : `${own}/${x}`;
  const authorServers = author ? await fetchAuthorServers(author) : [];
  const rest = blobFallbackCandidates(base, { fallbacks: meta.fallback, ownOrigin: own, authorServers });
  return base === meta.url ? rest : [base, ...rest];
}

async function fetchAndDecrypt(meta: DMFileMeta, author?: string): Promise<string> {
  const cached = objectUrlCache.get(meta.x);
  if (cached) return cached;
  let plain: Uint8Array;
  try {
    plain = await downloadAndDecrypt(meta.url, meta);
  } catch (firstErr) {
    // By-hash retries are only safe with a hash to check them against.
    if (!/^[0-9a-f]{64}$/i.test(meta.x ?? "")) throw firstErr;
    let recovered: Uint8Array | null = null;
    for (const url of await candidateUrls(meta, author)) {
      try {
        recovered = await downloadAndDecrypt(url, meta);
        break;
      } catch {
        // next candidate
      }
    }
    if (!recovered) throw firstErr;
    plain = recovered;
  }
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
export function DMFileAttachment({ meta, author, isMe, autoLoad }: DMFileAttachmentProps) {
  const small = (meta.size ?? 0) <= AUTO_LOAD_MAX_BYTES;
  const [state, setState] = useState<LoadState>(() =>
    objectUrlCache.has(meta.x) ? { status: "ready", objectUrl: objectUrlCache.get(meta.x)! } : { status: "idle" },
  );

  const load = () => {
    if (state.status === "loading" || state.status === "ready") return;
    setState({ status: "loading" });
    fetchAndDecrypt(meta, author)
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
    // Same cards as chat media: sized from the rumor's `dim`, lightbox / play.
    if (isImage) return <SmartImage url={state.objectUrl} dim={meta.dim} density="chat" />;
    if (isVideo) return <SmartVideo url={state.objectUrl} dim={meta.dim} density="chat" />;
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

  // A photo / video not decrypted yet holds its final shape, so the
  // conversation doesn't jump when it opens.
  if ((isImage || isVideo) && state.status !== "error") {
    const size = boundedMediaSize(parseDim(meta.dim) ?? (isImage ? CHAT_IMAGE_PLACEHOLDER : CHAT_VIDEO_PLACEHOLDER));
    const loading = state.status === "loading";
    return (
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="relative grid max-w-full place-items-center overflow-hidden rounded-xl border border-border bg-surface text-xs text-soft transition-colors hover:bg-surface-hover disabled:cursor-default"
        style={{ width: size.width, aspectRatio: size.aspect }}
        title="Encrypted attachment"
        data-testid="dm-attachment"
      >
        {loading && <span className="absolute inset-0 animate-pulse bg-surface-hover/60" />}
        <span className="relative flex flex-col items-center gap-1.5 px-3 text-center">
          {loading ? <Loader2 size={18} className="animate-spin text-muted" /> : <Lock size={16} className="text-primary" />}
          <span>{loading ? "Decrypting…" : isImage ? "Encrypted photo" : "Encrypted video"}</span>
          {!loading && sizeLabel && <span className="text-[11px] text-muted">{sizeLabel} · click to open</span>}
        </span>
      </button>
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
