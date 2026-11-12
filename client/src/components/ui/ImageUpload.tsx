import { useState, useRef, useCallback } from "react";
import { Upload, X, Link } from "lucide-react";
import type { UploadContext } from "@ishtarservices/core";
import { uploadWithContext } from "@/lib/media/uploadPlan";
import { Spinner } from "./Spinner";

/** Formats every webview we ship on renders (WebKit, WebView2, WebKitGTK). */
const WEB_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Re-encode an image other platforms can't render (HEIC dragged in from
 * Photos, TIFF, BMP …) as JPEG. macOS WebKit decodes HEIC, so without this an
 * icon set on a Mac shows everywhere else as a broken image. Throws when this
 * webview can't decode it either.
 */
async function toWebImage(file: File): Promise<File> {
  if (WEB_IMAGE_TYPES.includes(file.type)) return file;
  const unsupported = new Error("Unsupported image format. Use JPEG, PNG, WebP or GIF.");
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode().catch(() => {
      throw unsupported;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw unsupported;
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw unsupported;
    return new File([blob], `${file.name.replace(/\.[^.]*$/, "") || "image"}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(src);
  }
}

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  /** Where the image may be stored (docs/MEDIA_STORAGE.md §1): `public` for
   *  profile pictures, `spaceAsset` for space icons and onboarding images. */
  context: UploadContext;
  /** Reports an upload in flight. Parents disable Save/Create while it's true:
   *  `value` only becomes the URL when the upload finishes. */
  onUploadingChange?: (uploading: boolean) => void;
  label?: string;
  placeholder?: string;
  /** Shape of the preview */
  shape?: "square" | "circle" | "banner";
}

export function ImageUpload({
  value,
  onChange,
  context,
  onUploadingChange,
  label,
  placeholder = "Upload image or paste URL",
  shape = "square",
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<"upload" | "url">("upload");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Only image files are supported");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError("File must be under 10MB");
        return;
      }

      setUploading(true);
      onUploadingChange?.(true);
      setError(null);

      try {
        const result = await uploadWithContext(await toWebImage(file), context);
        onChange(result.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
        onUploadingChange?.(false);
      }
    },
    [onChange, onUploadingChange, context],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handlePick = () => fileRef.current?.click();

  const previewClass =
    shape === "circle"
      ? "h-20 w-20 rounded-full"
      : shape === "banner"
        ? "h-24 w-full rounded-xl"
        : "h-20 w-20 rounded-xl";

  return (
    <div>
      {label && (
        <div className="mb-1.5 flex items-center justify-between">
          <label className="block text-xs font-medium text-soft">{label}</label>
          <button
            type="button"
            onClick={() => setMode(mode === "upload" ? "url" : "upload")}
            className="flex items-center gap-1 text-[10px] text-muted hover:text-soft transition-colors"
          >
            {mode === "upload" ? (
              <>
                <Link size={10} /> Paste URL
              </>
            ) : (
              <>
                <Upload size={10} /> Upload
              </>
            )}
          </button>
        </div>
      )}

      {mode === "url" ? (
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setError(null);
          }}
          placeholder="https://..."
          className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
        />
      ) : (
        <div className="flex items-start gap-3">
          {/* Preview */}
          {value && !uploading ? (
            <div className="relative flex-shrink-0">
              <img
                src={value}
                alt="Preview"
                className={`${previewClass} object-cover border border-border`}
              />
              <button
                type="button"
                onClick={() => onChange("")}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-surface p-0.5 text-soft hover:text-heading border border-border transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          ) : null}

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={handlePick}
            className={`flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed px-3 py-4 cursor-pointer transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border-light hover:border-faint hover:bg-surface"
            }`}
          >
            {uploading ? (
              <Spinner size="sm" />
            ) : (
              <>
                <Upload size={16} className="text-muted mb-1" />
                <span className="text-xs text-muted text-center">
                  {placeholder}
                </span>
              </>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept={WEB_IMAGE_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
