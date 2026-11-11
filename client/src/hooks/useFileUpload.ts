import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { blossomUpload, blossomUploadBytes, type BlossomUploadResult } from "@/lib/api/blossom";
import { planForContext } from "@/lib/media/uploadPlan";
import { useAppSelector } from "@/store/hooks";
import { encryptDMFile, uploadContextKey, type UploadContext, type UploadPlan } from "@ishtarservices/core";
import type { DMFileMeta } from "@ishtarservices/shared-types";
import { fileMediaDim } from "@/lib/media/mediaDims";

/** Evaluated per call (not at module load) so tests can stand in a Tauri window. */
function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** One shared import for every mounted composer's drop listener. */
let webviewModule: Promise<typeof import("@tauri-apps/api/webview")> | null = null;
function loadWebview() {
  webviewModule ??= import("@tauri-apps/api/webview");
  return webviewModule;
}

export interface UploadedAttachment {
  id: string;
  file: File;
  result: BlossomUploadResult | null;
  status: "uploading" | "done" | "error";
  error?: string;
  /** Local object URL for preview */
  previewUrl: string;
  /** Set when uploaded encrypted (DMs): the kind-15 metadata to send.
   *  `result.url` then points at the opaque ciphertext blob. */
  dmFile?: DMFileMeta;
  /** "WxH" of an image / video, read from the local file: sent as imeta `dim`. */
  dim?: string;
  /** `uploadContextKey` of the context this was uploaded under. An attachment
   *  is only ever sent under that same context (docs/MEDIA_STORAGE.md §1). */
  contextKey: string;
}

/** Encrypt (AES-256-GCM, docs/DM_WIRE_CONTRACT.md §3.4) and upload as an opaque blob. */
async function uploadEncrypted(
  file: File,
  dim: string | undefined,
  plan: UploadPlan,
): Promise<{ result: BlossomUploadResult; dmFile: DMFileMeta }> {
  const mime = file.type || "application/octet-stream";
  const plain = new Uint8Array(await file.arrayBuffer());
  const enc = encryptDMFile(plain);
  const result = await blossomUploadBytes(enc.ciphertext, "application/octet-stream", { plan, ext: "bin" });
  const dmFile: DMFileMeta = {
    url: result.url,
    fileType: mime,
    key: enc.key,
    nonce: enc.nonce,
    x: enc.x,
    ox: enc.ox,
    size: enc.size,
    ...(dim ? { dim } : {}),
  };
  return { result, dmFile };
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const ACCEPTED_TYPES = [
  // Images
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/svg+xml", "image/bmp",
  // Videos
  "video/mp4", "video/webm", "video/quicktime",
  // Audio
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/flac", "audio/aac", "audio/mp4", "audio/webm",
  // Documents
  "application/pdf",
];

/** MIME lookup by extension for files with missing MIME type */
const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
  aac: "audio/aac", m4a: "audio/mp4",
  pdf: "application/pdf",
};

function isAcceptedType(file: File): boolean {
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext ? ext in EXT_TO_MIME : false;
}

/**
 * Does a native (Tauri) drag position land on this drop zone? Tauri reports
 * physical pixels; the DOM works in CSS pixels. A zone that isn't laid out
 * (a mounted-but-hidden composer: zero-size rect) never matches, and when
 * something else is painted on top at that point (a modal), it owns the drop.
 */
export function dropZoneContains(zone: HTMLElement | null, position: { x: number; y: number }): boolean {
  if (!zone) return false;
  const scale = window.devicePixelRatio || 1;
  const x = position.x / scale;
  const y = position.y / scale;
  const r = zone.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
  const top = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  return !top || zone.contains(top);
}

export interface UseFileUploadOptions {
  /** Where these uploads may go (docs/MEDIA_STORAGE.md §1). Required: there is
   *  no default context. */
  context: UploadContext;
  /** Encrypt before upload (DM attachments, kind 15). */
  encrypt?: boolean;
  /**
   * What happens to attachments uploaded under a previous context when
   * `context` changes (space switched, visibility changed): `drop` removes
   * them (default), `reupload` uploads them again under the new context,
   * `manual` leaves it to the caller (`dropStaleAttachments` /
   * `reuploadStaleAttachments`). A stale attachment is never sent as-is.
   */
  onContextChange?: "drop" | "reupload" | "manual";
  /**
   * Offered every accepted file (picked, pasted or dropped) before it uploads;
   * return true to take it instead. The note composer takes audio this way:
   * audio on a note becomes a track, never a blob.
   */
  divert?: (file: File) => boolean;
}

export function useFileUpload(opts: UseFileUploadOptions) {
  const encrypt = !!opts.encrypt;
  const policy = opts.onContextChange ?? "drop";
  const contextKey = uploadContextKey(opts.context);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const context = useMemo(() => opts.context, [contextKey]);
  const contextRef = useRef(context);
  contextRef.current = context;

  const prefs = useAppSelector((s) => s.mediaPrefs.prefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const divertRef = useRef(opts.divert);
  divertRef.current = opts.divert;

  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);
  /** Upload attempt per attachment id: a superseded attempt's result is ignored. */
  const attemptRef = useRef(new Map<string, number>());

  /** (Re)upload one attachment under the current context. */
  const startUpload = useCallback(
    (id: string, file: File, previewUrl: string) => {
      const ctx = contextRef.current;
      const key = uploadContextKey(ctx);
      const attempt = (attemptRef.current.get(id) ?? 0) + 1;
      attemptRef.current.set(id, attempt);
      const plan = planForContext(ctx, prefsRef.current);

      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, status: "uploading", error: undefined, result: null, dmFile: undefined, contextKey: key }
            : a,
        ),
      );

      const current = () => attemptRef.current.get(id) === attempt;
      // Size of an image / video, read locally — never holds up a plain upload.
      const dimRead = fileMediaDim(file, previewUrl);
      void dimRead.then((dim) => {
        if (dim && current()) setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, dim } : a)));
      });
      const upload = encrypt
        ? dimRead.then((dim) => uploadEncrypted(file, dim, plan))
        : blossomUpload(file, plan).then((result) => ({ result, dmFile: undefined as DMFileMeta | undefined }));
      upload
        .then(({ result, dmFile }) => {
          if (!current()) return;
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, result, dmFile, status: "done" } : a)),
          );
        })
        .catch((err) => {
          if (!current()) return;
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === id
                ? { ...a, status: "error", error: err instanceof Error ? err.message : "Upload failed" }
                : a,
            ),
          );
        });
    },
    [encrypt],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (!isAcceptedType(file)) {
          console.warn(`[Upload] Rejected file type: ${file.type || file.name}`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          console.warn(`[Upload] File too large: ${file.name} (${file.size} bytes)`);
          continue;
        }
        if (divertRef.current?.(file)) continue;

        const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const previewUrl = URL.createObjectURL(file);
        const attachment: UploadedAttachment = {
          id,
          file,
          result: null,
          status: "uploading",
          previewUrl,
          contextKey: uploadContextKey(contextRef.current),
        };
        setAttachments((prev) => [...prev, attachment]);
        startUpload(id, file, previewUrl);
      }
    },
    [startUpload],
  );

  /** Remove attachments uploaded under a context other than the current one. */
  const dropStaleAttachments = useCallback(() => {
    const key = uploadContextKey(contextRef.current);
    setAttachments((prev) => {
      const keep: UploadedAttachment[] = [];
      for (const a of prev) {
        if (a.contextKey === key) keep.push(a);
        else {
          attemptRef.current.delete(a.id);
          URL.revokeObjectURL(a.previewUrl);
        }
      }
      return keep.length === prev.length ? prev : keep;
    });
  }, []);

  /** Upload stale attachments again under the current context. */
  const reuploadStaleAttachments = useCallback(() => {
    const key = uploadContextKey(contextRef.current);
    for (const a of attachmentsRef.current) {
      if (a.contextKey !== key) startUpload(a.id, a.file, a.previewUrl);
    }
  }, [startUpload]);

  /** Retry a failed upload (under the current context). */
  const retryAttachment = useCallback(
    (id: string) => {
      const a = attachmentsRef.current.find((x) => x.id === id);
      if (a && a.status !== "uploading") startUpload(a.id, a.file, a.previewUrl);
    },
    [startUpload],
  );

  // Context changed: never let an attachment ride along under the new target.
  const prevKeyRef = useRef(contextKey);
  useEffect(() => {
    if (prevKeyRef.current === contextKey) return;
    prevKeyRef.current = contextKey;
    if (policy === "drop") dropStaleAttachments();
    else if (policy === "reupload") reuploadStaleAttachments();
  }, [contextKey, policy, dropStaleAttachments, reuploadStaleAttachments]);

  // ---- Tauri native file drop ----
  useEffect(() => {
    if (!isTauriEnv()) return;

    // Use a cancelled flag so the async listener can check if this effect
    // was cleaned up (fixes React StrictMode double-mount leak)
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { getCurrentWebview } = await loadWebview();
        if (cancelled) return;

        const webview = getCurrentWebview();
        // Every mounted composer hears every native drop; only the one under
        // the cursor takes it.
        unlisten = await webview.onDragDropEvent(async (event) => {
          if (cancelled) return;
          const payload = event.payload;

          if (payload.type === "enter" || payload.type === "over") {
            setDragOver(dropZoneContains(dropZoneRef.current, payload.position));
          } else if (payload.type === "leave") {
            setDragOver(false);
          } else if (payload.type === "drop") {
            setDragOver(false);
            if (!dropZoneContains(dropZoneRef.current, payload.position)) return;
            const paths: string[] = payload.paths;
            if (!paths.length) return;

            try {
              const { readFile } = await import("@tauri-apps/plugin-fs");
              const files: File[] = [];
              for (const path of paths) {
                const name = path.split(/[\\/]/).pop() || "file";
                const ext = name.split(".").pop()?.toLowerCase() ?? "";
                if (!(ext in EXT_TO_MIME)) continue;

                const data = await readFile(path);
                const file = new File([data], name, { type: EXT_TO_MIME[ext] });
                if (file.size <= MAX_FILE_SIZE) {
                  files.push(file);
                }
              }
              if (files.length && !cancelled) addFiles(files);
            } catch (err) {
              console.error("[Upload] Tauri file read failed:", err);
            }
          }
        });

        // If cleanup ran while we were awaiting, unlisten immediately
        if (cancelled && unlisten) {
          unlisten();
        }
      } catch {
        // Tauri API not available
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [addFiles]);

  // ---- HTML5 drag-and-drop ----
  useEffect(() => {
    // In Tauri, native onDragDropEvent handles file drops. Skip HTML5 listeners
    // to avoid double-processing.
    if (isTauriEnv()) return;

    const zone = dropZoneRef.current;
    if (!zone) return;

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current++;
      if (e.dataTransfer?.types.includes("Files")) {
        setDragOver(true);
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setDragOver(false);
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setDragOver(false);

      if (e.dataTransfer?.files.length) {
        addFiles(e.dataTransfer.files);
      }
    };

    zone.addEventListener("dragenter", onDragEnter);
    zone.addEventListener("dragover", onDragOver);
    zone.addEventListener("dragleave", onDragLeave);
    zone.addEventListener("drop", onDrop);

    return () => {
      zone.removeEventListener("dragenter", onDragEnter);
      zone.removeEventListener("dragover", onDragOver);
      zone.removeEventListener("dragleave", onDragLeave);
      zone.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  const removeAttachment = useCallback((id: string) => {
    attemptRef.current.delete(id);
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    attemptRef.current.clear();
    setAttachments((prev) => {
      for (const a of prev) URL.revokeObjectURL(a.previewUrl);
      return [];
    });
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        addFiles(e.target.files);
      }
      e.target.value = "";
    },
    [addFiles],
  );

  const isUploading = attachments.some((a) => a.status === "uploading");
  const hasAttachments = attachments.length > 0;
  const staleCount = attachments.filter((a) => a.contextKey !== contextKey).length;

  return {
    attachments,
    /** The current context's key; an attachment with another key is stale. */
    contextKey,
    staleCount,
    addFiles,
    removeAttachment,
    clearAttachments,
    retryAttachment,
    dropStaleAttachments,
    reuploadStaleAttachments,
    openFilePicker,
    handleFileInputChange,
    fileInputRef,
    dropZoneRef,
    dragOver,
    isUploading,
    hasAttachments,
  };
}
