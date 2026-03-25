import { useState } from "react";
import { X, Lock, Globe, Users, Feather } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { buildAnnotationEvent } from "./musicEventBuilder";
import { signAndPublish, signAndSaveLocally } from "@/lib/nostr/publish";
import type { AnnotationLabel } from "@/types/music";

const LABELS: { value: AnnotationLabel; display: string }[] = [
  { value: "story", display: "Story" },
  { value: "credits", display: "Credits" },
  { value: "thanks", display: "Thanks" },
  { value: "process", display: "Process" },
  { value: "lyrics", display: "Lyrics" },
];

type VisibilityTier = "public" | "space" | "private";

interface AnnotationComposerProps {
  /** Addressable ID of the target track or album */
  targetRef: string;
  /** Display name of the target (track title or album title) */
  targetName: string;
  onClose: () => void;
}

export function AnnotationComposer({
  targetRef,
  targetName,
  onClose,
}: AnnotationComposerProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const spaces = useAppSelector((s) => s.spaces.list);

  const [content, setContent] = useState("");
  const [label, setLabel] = useState<AnnotationLabel | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [visibility, setVisibility] = useState<VisibilityTier>("public");
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!pubkey || !content.trim()) return;
    setError(null);
    setSubmitting(true);

    try {
      const annotationId = crypto.randomUUID().slice(0, 12);
      const unsigned = buildAnnotationEvent(pubkey, {
        annotationId,
        targetRef,
        content: content.trim(),
        label: label ?? undefined,
        customLabel: label === "custom" ? customLabel.trim() || undefined : undefined,
        isPrivate: visibility === "private",
        spaceId: visibility === "space" && selectedSpaceId ? selectedSpaceId : undefined,
      });

      if (visibility === "private") {
        await signAndSaveLocally(unsigned);
      } else {
        await signAndPublish(unsigned);
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save annotation",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLabel = (l: AnnotationLabel) => {
    setLabel((prev) => (prev === l ? null : l));
  };

  const cycleVisibility = () => {
    setVisibility((v) => {
      if (v === "public") return spaces.length > 0 ? "space" : "private";
      if (v === "space") return "private";
      return "public";
    });
  };

  const VisibilityIcon = visibility === "private" ? Lock : visibility === "space" ? Users : Globe;
  const visibilityLabel = visibility === "private" ? "Private" : visibility === "space" ? "Space" : "Public";
  const visibilityStyles = visibility === "private"
    ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20"
    : visibility === "space"
      ? "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20"
      : "bg-surface/60 text-muted hover:text-soft";

  return (
    <Modal open={true} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border/60 card-glass p-5 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Feather size={14} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-heading">Add Annotation</p>
            <p className="truncate text-xs text-muted">{targetName}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:text-heading hover:bg-surface transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          autoFocus
          className="w-full rounded-xl border border-border/50 bg-transparent px-4 py-3 text-sm text-heading placeholder-muted/50 outline-none transition-colors focus:border-primary/30 resize-y leading-relaxed"
          placeholder="Write something..."
        />

        {/* Labels */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {LABELS.map((l) => (
            <button
              key={l.value}
              onClick={() => toggleLabel(l.value)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                label === l.value
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "bg-surface/60 text-muted hover:text-soft hover:bg-surface"
              }`}
            >
              {l.display}
            </button>
          ))}
          <button
            onClick={() => toggleLabel("custom")}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
              label === "custom"
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : "bg-surface/60 text-muted hover:text-soft hover:bg-surface"
            }`}
          >
            +
          </button>
        </div>

        {/* Custom label input */}
        {label === "custom" && (
          <input
            type="text"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            placeholder="Label name..."
            autoFocus
            className="mt-2 w-full rounded-lg border border-border/50 bg-transparent px-3 py-1.5 text-xs text-heading placeholder-muted/50 outline-none focus:border-primary/30"
          />
        )}

        {/* Space picker when space visibility is selected */}
        {visibility === "space" && spaces.length > 0 && (
          <select
            value={selectedSpaceId ?? ""}
            onChange={(e) => setSelectedSpaceId(e.target.value || null)}
            className="mt-2 w-full rounded-lg border border-border/50 bg-transparent px-3 py-1.5 text-xs text-heading outline-none focus:border-primary/30"
          >
            <option value="">Select space...</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>{s.name || s.id}</option>
            ))}
          </select>
        )}

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between">
          {/* Visibility toggle */}
          <button
            onClick={cycleVisibility}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${visibilityStyles}`}
          >
            <VisibilityIcon size={11} />
            {visibilityLabel}
          </button>

          {/* Submit */}
          <button
            onClick={handleSave}
            disabled={submitting || !content.trim() || (visibility === "space" && !selectedSpaceId)}
            className="rounded-full bg-gradient-to-r from-primary to-primary-soft px-5 py-1.5 text-xs font-medium text-white transition-all hover:opacity-90 press-effect disabled:opacity-40"
          >
            {submitting ? "Saving..." : "Post"}
          </button>
        </div>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
