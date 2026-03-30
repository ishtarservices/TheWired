import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import type { MusicAlbum, ProposalChange } from "@/types/music";
import { useAppSelector } from "@/store/hooks";
import { buildProposalEvent } from "./musicEventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";

interface CreateProposalModalProps {
  album: MusicAlbum;
  onClose: () => void;
}

const CHANGE_TYPE_LABELS: Record<ProposalChange["type"], string> = {
  add_track: "Add Track",
  remove_track: "Remove Track",
  reorder: "Reorder Track",
  update_metadata: "Update Metadata",
};

function emptyChange(): ProposalChange {
  return { type: "add_track" };
}

export function CreateProposalModal({ album, onClose }: CreateProposalModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const tracks = useAppSelector((s) => s.music.tracks);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [changes, setChanges] = useState<ProposalChange[]>([emptyChange()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const albumTrackRefs = album.trackRefs;

  const updateChange = (idx: number, partial: Partial<ProposalChange>) => {
    setChanges((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, ...partial } : c)),
    );
  };

  const removeChange = (idx: number) => {
    setChanges((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!pubkey || !title.trim() || changes.length === 0) {
      setError("Title and at least one change are required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const unsigned = buildProposalEvent(pubkey, {
        proposalId,
        targetAlbum: album.addressableId,
        ownerPubkey: album.pubkey,
        title: title.trim(),
        description: description.trim() || undefined,
        changes,
      });

      const signed = await signAndPublish(unsigned);
      if (!signed) {
        setError("Failed to sign and publish proposal");
        return;
      }

      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border card-glass p-6 shadow-xl">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1 text-muted hover:text-heading"
        >
          <X size={18} />
        </button>

        <h2 className="mb-4 text-lg font-bold text-heading">
          Propose Changes to "{album.title}"
        </h2>

        {/* Title */}
        <div className="mb-3">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
            Proposal Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Add my remix to the album"
            className="w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading placeholder-muted focus:border-primary/40 focus:outline-none transition-colors"
          />
        </div>

        {/* Description */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Explain your proposed changes..."
            rows={2}
            className="w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading placeholder-muted focus:border-primary/40 focus:outline-none transition-colors resize-none"
          />
        </div>

        {/* Changes */}
        <div className="mb-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
            Changes
          </label>
          <div className="space-y-2">
            {changes.map((change, i) => (
              <div key={i} className="flex items-start gap-2 rounded-xl border border-border bg-surface/50 p-3">
                <div className="flex-1 space-y-2">
                  <select
                    value={change.type}
                    onChange={(e) =>
                      updateChange(i, { type: e.target.value as ProposalChange["type"] })
                    }
                    className="w-full rounded-lg border border-border bg-field px-2 py-1.5 text-xs text-heading focus:outline-none"
                  >
                    {Object.entries(CHANGE_TYPE_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    ))}
                  </select>

                  {change.type === "add_track" && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={change.trackRef ?? ""}
                        onChange={(e) => updateChange(i, { trackRef: e.target.value })}
                        placeholder="Track addressable ID"
                        className="flex-1 rounded-lg border border-border bg-field px-2 py-1 text-xs text-heading placeholder-muted focus:outline-none"
                      />
                      <input
                        type="number"
                        value={change.position ?? ""}
                        onChange={(e) =>
                          updateChange(i, {
                            position: e.target.value ? parseInt(e.target.value, 10) : undefined,
                          })
                        }
                        placeholder="Position"
                        className="w-20 rounded-lg border border-border bg-field px-2 py-1 text-xs text-heading placeholder-muted focus:outline-none"
                      />
                    </div>
                  )}

                  {change.type === "remove_track" && (
                    <select
                      value={change.trackRef ?? ""}
                      onChange={(e) => updateChange(i, { trackRef: e.target.value })}
                      className="w-full rounded-lg border border-border bg-field px-2 py-1.5 text-xs text-heading focus:outline-none"
                    >
                      <option value="">Select track to remove</option>
                      {albumTrackRefs.map((ref) => {
                        const track = tracks[ref];
                        return (
                          <option key={ref} value={ref}>
                            {track?.title ?? ref.split(":").pop()}
                          </option>
                        );
                      })}
                    </select>
                  )}

                  {change.type === "reorder" && (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={change.from ?? ""}
                        onChange={(e) =>
                          updateChange(i, {
                            from: e.target.value ? parseInt(e.target.value, 10) : undefined,
                          })
                        }
                        placeholder="From position"
                        className="flex-1 rounded-lg border border-border bg-field px-2 py-1 text-xs text-heading placeholder-muted focus:outline-none"
                      />
                      <input
                        type="number"
                        value={change.to ?? ""}
                        onChange={(e) =>
                          updateChange(i, {
                            to: e.target.value ? parseInt(e.target.value, 10) : undefined,
                          })
                        }
                        placeholder="To position"
                        className="flex-1 rounded-lg border border-border bg-field px-2 py-1 text-xs text-heading placeholder-muted focus:outline-none"
                      />
                    </div>
                  )}

                  {change.type === "update_metadata" && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={change.field ?? ""}
                        onChange={(e) => updateChange(i, { field: e.target.value })}
                        placeholder="Field name"
                        className="flex-1 rounded-lg border border-border bg-field px-2 py-1 text-xs text-heading placeholder-muted focus:outline-none"
                      />
                      <input
                        type="text"
                        value={change.value ?? ""}
                        onChange={(e) => updateChange(i, { value: e.target.value })}
                        placeholder="New value"
                        className="flex-1 rounded-lg border border-border bg-field px-2 py-1 text-xs text-heading placeholder-muted focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                {changes.length > 1 && (
                  <button
                    onClick={() => removeChange(i)}
                    className="mt-1 shrink-0 rounded p-1 text-muted hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => setChanges((prev) => [...prev, emptyChange()])}
            className="mt-2 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-primary hover:bg-surface transition-colors"
          >
            <Plus size={12} />
            Add Change
          </button>
        </div>

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-sm text-soft hover:border-border-light hover:text-heading transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || changes.length === 0}
            className="rounded-xl bg-gradient-to-r from-primary to-primary-soft px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-all duration-150 press-effect disabled:opacity-40"
          >
            {submitting ? "Submitting..." : "Submit Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
}
