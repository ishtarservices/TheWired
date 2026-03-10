import { useState, useCallback, useRef, useEffect } from "react";
import { blossomUpload, type BlossomUploadResult } from "@/lib/api/blossom";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface UploadedAttachment {
  id: string;
  file: File;
  result: BlossomUploadResult | null;
  status: "uploading" | "done" | "error";
  error?: string;
  /** Local object URL for preview */
  previewUrl: string;
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

export function useFileUpload() {
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      if (!isAcceptedType(file)) {
        console.warn(`[Upload] Rejected file type: ${file.type || file.name}`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        console.warn(`[Upload] File too large: ${file.name} (${file.size} bytes)`);
        continue;
      }

      const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = URL.createObjectURL(file);

      const attachment: UploadedAttachment = {
        id,
        file,
        result: null,
        status: "uploading",
        previewUrl,
      };

      setAttachments((prev) => [...prev, attachment]);

      blossomUpload(file)
        .then((result) => {
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, result, status: "done" } : a)),
          );
        })
        .catch((err) => {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === id
                ? { ...a, status: "error", error: err instanceof Error ? err.message : "Upload failed" }
                : a,
            ),
          );
        });
    }
  }, []);

  // ---- Tauri native file drop ----
  useEffect(() => {
    if (!isTauri) return;

    // Use a cancelled flag so the async listener can check if this effect
    // was cleaned up (fixes React StrictMode double-mount leak)
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        if (cancelled) return;

        const webview = getCurrentWebview();
        unlisten = await webview.onDragDropEvent(async (event) => {
          if (cancelled) return;

          if (event.payload.type === "over") {
            setDragOver(true);
          } else if (event.payload.type === "leave") {
            setDragOver(false);
          } else if (event.payload.type === "drop") {
            setDragOver(false);
            const paths: string[] = event.payload.paths;
            if (!paths.length) return;

            try {
              const { readFile } = await import("@tauri-apps/plugin-fs");
              const files: File[] = [];
              for (const path of paths) {
                const name = path.split("/").pop() ?? path.split("\\").pop() ?? "file";
                const ext = name.split(".").pop()?.toLowerCase() ?? "";
                const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";
                if (!(ext in EXT_TO_MIME)) continue;

                const data = await readFile(path);
                const file = new File([data], name, { type: mime });
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
    if (isTauri) return;

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
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
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

  return {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    openFilePicker,
    handleFileInputChange,
    fileInputRef,
    dropZoneRef,
    dragOver,
    isUploading,
    hasAttachments,
  };
}
