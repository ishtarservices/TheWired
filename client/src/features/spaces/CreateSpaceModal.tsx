import { useState, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { ImageUpload } from "../../components/ui/ImageUpload";
import { useAppSelector } from "../../store/hooks";
import { BOOTSTRAP_RELAYS } from "../../lib/nostr/constants";
import { registerSpace } from "../../lib/api/spaces";
import { useAutoResize } from "../../hooks/useAutoResize";
import type { Space } from "../../types/space";

interface CreateSpaceModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (space: Space) => void;
}

function generateId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function CreateSpaceModal({
  open,
  onClose,
  onCreate,
}: CreateSpaceModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [picture, setPicture] = useState("");
  const [mode, setMode] = useState<"read" | "read-write">("read-write");
  const aboutRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(aboutRef, about, 200);

  function handleCreate() {
    if (!name.trim() || !pubkey) return;

    const space: Space = {
      id: generateId(),
      name: name.trim(),
      about: about.trim() || undefined,
      picture: picture.trim() || undefined,
      mode,
      creatorPubkey: pubkey,
      adminPubkeys: [pubkey],
      memberPubkeys: [pubkey],
      hostRelay: BOOTSTRAP_RELAYS[0],
      isPrivate: false,
      createdAt: Math.floor(Date.now() / 1000),
    };

    onCreate(space);

    // Bootstrap space on backend (creates space record, seeds roles+channels,
    // registers creator as member+admin — all in one call)
    registerSpace({
      id: space.id,
      name: space.name,
      hostRelay: space.hostRelay,
      picture: space.picture,
      about: space.about,
      mode: space.mode,
    }).catch((err) => {
      console.error("[CreateSpace] Backend bootstrap failed:", err);
    });

    setName("");
    setAbout("");
    setPicture("");
    setMode("read-write");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl card-glass p-8 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">Create Space</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Space"
              className="w-full rounded-xl bg-white/[0.04] border border-white/[0.04] px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Description
            </label>
            <textarea
              ref={aboutRef}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="What's this space about?"
              rows={2}
              className="w-full resize-none overflow-hidden rounded-xl bg-white/[0.04] border border-white/[0.04] px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
            />
          </div>

          <ImageUpload
            value={picture}
            onChange={setPicture}
            label="Picture"
            placeholder="Drop space image or click to upload"
            shape="square"
          />

          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Mode
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("read-write")}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                  mode === "read-write"
                    ? "bg-pulse/15 text-pulse-soft ring-1 ring-pulse/30"
                    : "bg-white/[0.04] text-soft hover:text-heading"
                }`}
              >
                Community (Read-write)
              </button>
              <button
                onClick={() => setMode("read")}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                  mode === "read"
                    ? "bg-pulse/15 text-pulse-soft ring-1 ring-pulse/30"
                    : "bg-white/[0.04] text-soft hover:text-heading"
                }`}
              >
                Feed (Read-only)
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              {mode === "read"
                ? "Curated feed of member content -- notes, media, articles"
                : "Full community with chat, notes, media, and articles"}
            </p>
          </div>

        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleCreate}
            disabled={!name.trim()}
          >
            Create Space
          </Button>
        </div>
      </div>
    </Modal>
  );
}
