import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { buildTrackNotesEvent } from "./musicEventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import type { MusicTrack } from "@/types/music";
import type { TrackCredit } from "@/types/music";

interface TrackNotesModalProps {
  track: MusicTrack;
  onClose: () => void;
}

export function TrackNotesModal({ track, onClose }: TrackNotesModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const existingNotes = useAppSelector(
    (s) => s.music.trackNotes[track.addressableId],
  );

  const [linerNotes, setLinerNotes] = useState(
    existingNotes?.linerNotes ?? "",
  );
  const [productionNotes, setProductionNotes] = useState(
    existingNotes?.productionNotes ?? "",
  );
  const [credits, setCredits] = useState<TrackCredit[]>(
    existingNotes?.credits ?? [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addCredit = () => {
    setCredits([...credits, { role: "", name: "" }]);
  };

  const removeCredit = (index: number) => {
    setCredits(credits.filter((_, i) => i !== index));
  };

  const updateCredit = (
    index: number,
    field: keyof TrackCredit,
    value: string,
  ) => {
    setCredits(
      credits.map((c, i) =>
        i === index ? { ...c, [field]: value || undefined } : c,
      ),
    );
  };

  const handleSave = async () => {
    if (!pubkey) return;
    setError(null);
    setSubmitting(true);

    try {
      // Extract the d-tag from the track's addressable ID (31683:pubkey:slug -> slug)
      const trackDTag = track.addressableId.split(":").slice(2).join(":");

      // Filter out empty credits
      const validCredits = credits.filter(
        (c) => c.role.trim() && c.name.trim(),
      );

      const unsigned = buildTrackNotesEvent(pubkey, {
        trackDTag,
        trackAddressableId: track.addressableId,
        linerNotes: linerNotes || undefined,
        productionNotes: productionNotes || undefined,
        credits: validCredits.length > 0 ? validCredits : undefined,
      });

      await signAndPublish(unsigned);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save track notes",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-edge card-glass p-6 shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">Track Notes</h2>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        <p className="mb-4 text-xs text-soft">
          Add liner notes, production details, and credits for{" "}
          <span className="font-medium text-heading">{track.title}</span>.
        </p>

        <div className="space-y-4">
          {/* Liner Notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Liner Notes
            </label>
            <textarea
              value={linerNotes}
              onChange={(e) => setLinerNotes(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-edge bg-field px-3 py-2 text-sm text-heading outline-none focus:border-pulse/30 resize-y"
              placeholder="Share the story behind this track, inspiration, meaning..."
            />
          </div>

          {/* Production Notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Production Notes
            </label>
            <textarea
              value={productionNotes}
              onChange={(e) => setProductionNotes(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-edge bg-field px-3 py-2 text-sm text-heading outline-none focus:border-pulse/30 resize-y"
              placeholder="Recording details, equipment used, studio, mix/master info..."
            />
          </div>

          {/* Credits */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-soft">Credits</label>
              <button
                onClick={addCredit}
                className="flex items-center gap-1 text-xs text-pulse hover:text-pulse-soft"
              >
                <Plus size={14} />
                Add Credit
              </button>
            </div>

            {credits.length === 0 && (
              <p className="text-xs text-soft/60 italic">
                No credits added yet. Click &quot;Add Credit&quot; to add
                contributors.
              </p>
            )}

            <div className="space-y-2">
              {credits.map((credit, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 rounded-xl border border-edge bg-field/50 p-2"
                >
                  <div className="flex-1 space-y-1.5">
                    <input
                      type="text"
                      value={credit.role}
                      onChange={(e) =>
                        updateCredit(index, "role", e.target.value)
                      }
                      className="w-full rounded-lg border border-edge bg-field px-2 py-1 text-xs text-heading outline-none focus:border-pulse/30"
                      placeholder="Role (e.g. Producer, Vocalist, Guitar)"
                    />
                    <input
                      type="text"
                      value={credit.name}
                      onChange={(e) =>
                        updateCredit(index, "name", e.target.value)
                      }
                      className="w-full rounded-lg border border-edge bg-field px-2 py-1 text-xs text-heading outline-none focus:border-pulse/30"
                      placeholder="Name"
                    />
                    <input
                      type="text"
                      value={credit.pubkey ?? ""}
                      onChange={(e) =>
                        updateCredit(index, "pubkey", e.target.value)
                      }
                      className="w-full rounded-lg border border-edge bg-field px-2 py-1 text-xs text-soft outline-none focus:border-pulse/30"
                      placeholder="Nostr pubkey (optional)"
                    />
                  </div>
                  <button
                    onClick={() => removeCredit(index)}
                    className="mt-1 text-soft hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSave}
            disabled={submitting}
            className="w-full rounded-xl bg-gradient-to-r from-pulse to-pulse-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save Notes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
