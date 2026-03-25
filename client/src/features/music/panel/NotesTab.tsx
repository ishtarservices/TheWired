import { useState } from "react";
import { Lock, Globe, Users, Feather, Loader2 } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeAnnotation } from "@/store/slices/musicSlice";
import { AnnotationCard } from "../AnnotationCard";
import { buildAnnotationEvent } from "../musicEventBuilder";
import { signAndPublish, signAndSaveLocally } from "@/lib/nostr/publish";
import { buildDeletionEvent } from "@/lib/nostr/eventBuilder";
import { useAnnotations } from "../useAnnotations";
import type { AnnotationLabel, MusicAnnotation } from "@/types/music";

const LABELS: { value: AnnotationLabel; display: string }[] = [
  { value: "story", display: "Story" },
  { value: "credits", display: "Credits" },
  { value: "thanks", display: "Thanks" },
  { value: "process", display: "Process" },
  { value: "lyrics", display: "Lyrics" },
];

type VisibilityTier = "public" | "space" | "private";

interface NotesTabProps {
  targetRef: string;
  targetName: string;
  ownerPubkey: string;
}

export function NotesTab({ targetRef, targetName, ownerPubkey }: NotesTabProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const spaces = useAppSelector((s) => s.spaces.list);
  const { annotations: visible, loading } = useAnnotations(targetRef);

  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState("");
  const [label, setLabel] = useState<AnnotationLabel | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [visibility, setVisibility] = useState<VisibilityTier>("public");
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const artistNotes = visible.filter((a) => a.authorPubkey === ownerPubkey);
  const communityNotes = visible.filter((a) => a.authorPubkey !== ownerPubkey);

  const communityLimit = expanded ? communityNotes.length : 3;
  const displayedCommunity = communityNotes.slice(0, communityLimit);
  const hasMoreCommunity = communityNotes.length > communityLimit;

  const handleDelete = async (ann: MusicAnnotation) => {
    if (!pubkey) return;
    // Optimistic UI removal
    dispatch(removeAnnotation({
      targetRef: ann.targetRef,
      addressableId: ann.addressableId,
    }));
    // Publish NIP-09 deletion event
    const unsigned = buildDeletionEvent(pubkey, {
      addressableIds: [ann.addressableId],
    });
    try {
      await signAndPublish(unsigned);
    } catch {
      // Best-effort — annotation is already removed from UI
    }
  };

  const handleTogglePin = async (ann: MusicAnnotation) => {
    if (!pubkey) return;
    // Extract the annotation ID from the d-tag (format: "ann:xxx")
    const annId = ann.addressableId.split(":").slice(2).join(":");
    const rawId = annId.startsWith("ann:") ? annId.slice(4) : annId;
    const unsigned = buildAnnotationEvent(pubkey, {
      annotationId: rawId,
      targetRef: ann.targetRef,
      content: ann.content,
      label: ann.label,
      customLabel: ann.customLabel,
      isPrivate: ann.isPrivate,
      isPinned: !ann.isPinned,
      spaceId: ann.spaceId,
    });
    try {
      await signAndPublish(unsigned);
    } catch {
      // Best-effort
    }
  };

  const handlePost = async () => {
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

      setContent("");
      setLabel(null);
      setCustomLabel("");
      setVisibility("public");
      setSelectedSpaceId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
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

  const isOwner = pubkey === ownerPubkey;

  const VisibilityIcon = visibility === "private" ? Lock : visibility === "space" ? Users : Globe;
  const visibilityLabel = visibility === "private" ? "Private" : visibility === "space" ? "Space" : "Public";
  const visibilityStyles = visibility === "private"
    ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20"
    : visibility === "space"
      ? "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20"
      : "bg-surface/60 text-muted hover:text-soft";

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* Loading state */}
      {loading && visible.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={16} className="animate-spin text-muted" />
        </div>
      )}

      {/* ── Artist Notes ── */}
      {artistNotes.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted/60 px-1">
            Artist Notes
          </p>
          <div className="space-y-2">
            {artistNotes.map((ann) => (
              <AnnotationCard
                key={ann.addressableId}
                annotation={ann}
                isArtistNote
                onDelete={
                  ann.authorPubkey === pubkey || isOwner
                    ? () => handleDelete(ann)
                    : undefined
                }
                onTogglePin={
                  isOwner && ann.authorPubkey === pubkey
                    ? () => handleTogglePin(ann)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Community Notes ── */}
      {communityNotes.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted/60 px-1">
            Community Notes
          </p>
          <div className="space-y-2">
            {displayedCommunity.map((ann) => (
              <AnnotationCard
                key={ann.addressableId}
                annotation={ann}
                isArtistNote={false}
                onDelete={
                  ann.authorPubkey === pubkey || isOwner
                    ? () => handleDelete(ann)
                    : undefined
                }
              />
            ))}
          </div>
          {hasMoreCommunity && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-2 w-full rounded-lg py-1.5 text-center text-[11px] text-muted transition-colors hover:text-soft"
            >
              Show {communityNotes.length - communityLimit} more
            </button>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/40 px-4 py-6 text-center">
          <Feather size={20} className="mx-auto mb-2 text-muted/40" />
          <p className="text-xs text-muted">No notes yet</p>
        </div>
      )}

      {/* ── Inline Composer ── */}
      {pubkey && (
        <div className="sticky bottom-0 border-t border-border/40 bg-card/80 backdrop-blur-sm pt-3 -mx-3 px-3 pb-1">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-border/50 bg-transparent px-3 py-2 text-sm text-heading placeholder-muted/50 outline-none transition-colors focus:border-primary/30 resize-none leading-relaxed"
            placeholder={`Add a note about "${targetName}"...`}
          />

          {/* Labels */}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {LABELS.map((l) => (
              <button
                key={l.value}
                onClick={() => toggleLabel(l.value)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${
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
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${
                label === "custom"
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "bg-surface/60 text-muted hover:text-soft hover:bg-surface"
              }`}
            >
              +
            </button>
          </div>

          {label === "custom" && (
            <input
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Label name..."
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-transparent px-2.5 py-1 text-xs text-heading placeholder-muted/50 outline-none focus:border-primary/30"
            />
          )}

          {/* Space picker when space visibility is selected */}
          {visibility === "space" && spaces.length > 0 && (
            <select
              value={selectedSpaceId ?? ""}
              onChange={(e) => setSelectedSpaceId(e.target.value || null)}
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-transparent px-2.5 py-1 text-xs text-heading outline-none focus:border-primary/30"
            >
              <option value="">Select space...</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>{s.name || s.id}</option>
              ))}
            </select>
          )}

          {/* Footer */}
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={cycleVisibility}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${visibilityStyles}`}
            >
              <VisibilityIcon size={10} />
              {visibilityLabel}
            </button>
            <button
              onClick={handlePost}
              disabled={submitting || !content.trim() || (visibility === "space" && !selectedSpaceId)}
              className="rounded-full bg-gradient-to-r from-primary to-primary-soft px-4 py-1 text-[11px] font-medium text-white transition-all hover:opacity-90 press-effect disabled:opacity-40"
            >
              {submitting ? "Posting..." : "Post"}
            </button>
          </div>
          {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
