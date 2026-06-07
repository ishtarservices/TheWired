import { useRef, useState, useCallback } from "react";
import { ImagePlus, Loader2, X, Link2 } from "lucide-react";
import { blossomUpload } from "@/lib/api/blossom";

/**
 * Elegant cover-image control for the article editor. Empty state is a slim,
 * unobtrusive bar (not a big dashed box); once set, the cover renders full-width
 * with a hover overlay to change or remove it. Supports upload, drag-drop, and
 * paste-URL.
 */
export function CoverImageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlMode, setUrlMode] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Only image files are supported");
        return;
      }
      setUploading(true);
      setError(null);
      try {
        const res = await blossomUpload(file);
        onChange(res.url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onChange],
  );

  const hiddenInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
        e.target.value = "";
      }}
    />
  );

  if (value && !uploading) {
    return (
      <div className="group relative overflow-hidden rounded-2xl border border-border">
        <img src={value} alt="cover" className="h-52 w-full object-cover" />
        <div className="absolute inset-0 flex items-start justify-end gap-1.5 bg-linear-to-b from-black/50 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-black/60 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-black/80"
          >
            Change
          </button>
          <button
            onClick={() => onChange("")}
            className="rounded-lg bg-black/60 p-1.5 text-white transition-colors hover:bg-black/80"
            title="Remove cover"
          >
            <X size={14} />
          </button>
        </div>
        {hiddenInput}
      </div>
    );
  }

  if (urlMode) {
    return (
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          autoFocus
          className="flex-1 rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading placeholder-muted outline-none focus:border-primary/40"
        />
        <button
          onClick={() => setUrlMode(false)}
          className="rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:text-soft"
        >
          Done
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
          dragOver
            ? "border-primary bg-primary/5 text-heading"
            : "border-border text-muted hover:border-border-light hover:text-soft"
        }`}
      >
        {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
        <span>{uploading ? "Uploading…" : "Add cover image"}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setUrlMode(true);
          }}
          className="ml-auto flex items-center gap-1 text-xs text-muted transition-colors hover:text-soft"
        >
          <Link2 size={11} /> Paste URL
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {hiddenInput}
    </div>
  );
}
