import { useState } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { buildPlaylistEvent } from "./musicEventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";

interface CreatePlaylistModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreatePlaylistModal({ open, onClose }: CreatePlaylistModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!pubkey || !title.trim()) return;
    setError(null);
    setSubmitting(true);

    try {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const unsigned = buildPlaylistEvent(pubkey, {
        title,
        description: description || undefined,
        slug,
      });

      await signAndPublish(unsigned);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create playlist");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/[0.04] card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">Create Playlist</h2>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
              placeholder="Playlist name"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
              placeholder="Optional description"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className="w-full rounded-xl bg-gradient-to-r from-pulse to-pulse-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Playlist"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
