import { useState } from "react";
import { Feather, Plus, Loader2 } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeAnnotation } from "@/store/slices/musicSlice";
import { AnnotationCard } from "./AnnotationCard";
import { AnnotationComposer } from "./AnnotationComposer";
import { useAnnotations } from "./useAnnotations";
import { buildDeletionEvent } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import type { MusicAnnotation } from "@/types/music";

interface AnnotationsPanelProps {
  /** Addressable ID of the target track or album */
  targetRef: string;
  /** Display name of the target */
  targetName: string;
  /** Pubkey of the track/album owner */
  ownerPubkey: string;
  /** Compact mode hides the header and shows fewer items */
  compact?: boolean;
}

export function AnnotationsPanel({
  targetRef,
  targetName,
  ownerPubkey,
  compact,
}: AnnotationsPanelProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { annotations: visible, loading } = useAnnotations(targetRef);
  const [composerOpen, setComposerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (visible.length === 0 && !pubkey && !loading) return null;

  const isOwner = pubkey === ownerPubkey;
  const displayLimit = compact ? 2 : expanded ? visible.length : 3;
  const displayed = visible.slice(0, displayLimit);
  const hasMore = visible.length > displayLimit;

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

  return (
    <div className={compact ? "" : "mt-6"}>
      {/* Header */}
      {!compact && (
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Feather size={14} className="text-soft" />
            <h3 className="text-sm font-medium text-heading">
              Annotations
              {visible.length > 0 && (
                <span className="ml-1.5 text-muted">({visible.length})</span>
              )}
            </h3>
          </div>
          {pubkey && (
            <button
              onClick={() => setComposerOpen(true)}
              className="flex items-center gap-1 rounded-full bg-surface/60 px-2.5 py-1 text-[11px] font-medium text-soft transition-colors hover:bg-surface hover:text-heading"
            >
              <Plus size={12} />
              Add
            </button>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && visible.length === 0 && (
        <div className="flex items-center justify-center py-6">
          <Loader2 size={16} className="animate-spin text-muted" />
        </div>
      )}

      {/* Annotation list */}
      {displayed.length > 0 ? (
        <div className="space-y-2">
          {displayed.map((ann) => (
            <AnnotationCard
              key={ann.addressableId}
              annotation={ann}
              isArtistNote={ann.authorPubkey === ownerPubkey}
              onDelete={
                ann.authorPubkey === pubkey || isOwner
                  ? () => handleDelete(ann)
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        !compact && !loading && (
          <div className="rounded-xl border border-dashed border-edge/40 px-4 py-6 text-center">
            <Feather size={20} className="mx-auto mb-2 text-muted/40" />
            <p className="text-xs text-muted">No annotations yet</p>
            {pubkey && (
              <button
                onClick={() => setComposerOpen(true)}
                className="mt-2 text-xs text-pulse hover:text-pulse-soft transition-colors"
              >
                Be the first to write one
              </button>
            )}
          </div>
        )
      )}

      {/* Show more */}
      {hasMore && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-2 w-full rounded-lg py-1.5 text-center text-[11px] text-muted transition-colors hover:text-soft"
        >
          Show {visible.length - displayLimit} more
        </button>
      )}

      {/* Compact mode: inline add button */}
      {compact && pubkey && visible.length === 0 && !loading && (
        <button
          onClick={() => setComposerOpen(true)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:text-soft"
        >
          <Feather size={12} />
          Add annotation
        </button>
      )}

      {composerOpen && (
        <AnnotationComposer
          targetRef={targetRef}
          targetName={targetName}
          onClose={() => setComposerOpen(false)}
        />
      )}
    </div>
  );
}
