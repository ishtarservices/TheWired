import { useState, useMemo } from "react";
import { Feather, Plus, Loader2, Music2 } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeAnnotation } from "@/store/slices/musicSlice";
import { AnnotationCard } from "./AnnotationCard";
import { AnnotationComposer } from "./AnnotationComposer";
import { useAnnotations } from "./useAnnotations";
import { buildDeletionEvent } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import type { MusicAnnotation } from "@/types/music";

/** Track info for displaying per-track annotation groups */
interface TrackInfo {
  addressableId: string;
  title: string;
  pubkey: string;
}

interface AnnotationsPanelProps {
  /** Addressable ID of the target track or album */
  targetRef: string;
  /** Display name of the target */
  targetName: string;
  /** Pubkey of the track/album owner */
  ownerPubkey: string;
  /** Compact mode hides the header and shows fewer items */
  compact?: boolean;
  /** Optional: tracks in this album — enables per-track notes display */
  albumTracks?: TrackInfo[];
}

export function AnnotationsPanel({
  targetRef,
  targetName,
  ownerPubkey,
  compact,
  albumTracks,
}: AnnotationsPanelProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { annotations: visible, loading } = useAnnotations(targetRef);
  const [composerOpen, setComposerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [trackNotesExpanded, setTrackNotesExpanded] = useState(false);

  // Collect track-level annotations from Redux (no extra subscriptions — these arrive
  // via the same relay pipeline when tracks are loaded)
  const allAnnotations = useAppSelector((s) => s.music.annotations);
  const trackAnnotationGroups = useMemo(() => {
    if (!albumTracks?.length) return [];
    return albumTracks
      .map((track) => {
        const anns = (allAnnotations[track.addressableId] ?? []).filter(
          (a) => !a.isPrivate || a.authorPubkey === pubkey,
        );
        return { track, annotations: anns };
      })
      .filter((g) => g.annotations.length > 0);
  }, [albumTracks, allAnnotations, pubkey]);

  const totalTrackNotes = trackAnnotationGroups.reduce((sum, g) => sum + g.annotations.length, 0);
  const totalNotes = visible.length + totalTrackNotes;

  if (visible.length === 0 && totalTrackNotes === 0 && !pubkey && !loading) return null;

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
              Notes
              {totalNotes > 0 && (
                <span className="ml-1.5 text-muted">({totalNotes})</span>
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
          <div className="rounded-xl border border-dashed border-border/40 px-4 py-6 text-center">
            <Feather size={20} className="mx-auto mb-2 text-muted/40" />
            <p className="text-xs text-muted">No notes yet</p>
            {pubkey && (
              <button
                onClick={() => setComposerOpen(true)}
                className="mt-2 text-xs text-primary hover:text-primary-soft transition-colors"
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
          Add note
        </button>
      )}

      {/* ── Per-track notes (album view only) ── */}
      {trackAnnotationGroups.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setTrackNotesExpanded((v) => !v)}
            className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-soft transition-colors hover:text-heading"
          >
            <Music2 size={12} />
            Track Notes ({totalTrackNotes})
            <span className="text-muted">{trackNotesExpanded ? "▾" : "▸"}</span>
          </button>
          {trackNotesExpanded && (
            <div className="space-y-3">
              {trackAnnotationGroups.map(({ track, annotations: trackAnns }) => (
                <div key={track.addressableId}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/60 px-1">
                    {track.title} ({trackAnns.length})
                  </p>
                  <div className="space-y-2">
                    {trackAnns.map((ann) => (
                      <AnnotationCard
                        key={ann.addressableId}
                        annotation={ann}
                        isArtistNote={ann.authorPubkey === track.pubkey}
                        onDelete={
                          ann.authorPubkey === pubkey || pubkey === ownerPubkey
                            ? () => handleDelete(ann)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
