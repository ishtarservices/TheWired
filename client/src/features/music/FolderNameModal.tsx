import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { FOLDER_NAME_MAX, isDuplicateFolderName, isValidFolderName } from "@ishtarservices/core";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";

interface FolderNameModalProps {
  open: boolean;
  onClose: () => void;
  /** Resolves the name the user confirmed. */
  onSubmit: (name: string) => void;
  title?: string;
  submitLabel?: string;
  initialName?: string;
  /** The folder being renamed (its own name isn't a duplicate). */
  exceptId?: string;
}

/** Name a new folder, or rename one. Folders are private and sync to your
 *  other devices; publishing is a separate, explicit step. */
export function FolderNameModal({
  open,
  onClose,
  onSubmit,
  title = "New folder",
  submitLabel = "Create",
  initialName = "",
  exceptId,
}: FolderNameModalProps) {
  const folders = useAppSelector((s) => s.music.folders);
  const [name, setName] = useState(initialName);
  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  const valid = isValidFolderName(name);
  const duplicate = valid && isDuplicateFolderName(folders, name, exceptId);

  const submit = () => {
    if (!valid || duplicate) return;
    onSubmit(name);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">{title}</h2>
          <button onClick={onClose} className="text-soft hover:text-heading" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <input
          autoFocus
          type="text"
          value={name}
          maxLength={FOLDER_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
          placeholder="the beat tapes"
          aria-label="Folder name"
        />
        <p className="mt-2 text-xs text-soft">
          {duplicate ? "You already have a folder with that name." : "Private · on your devices"}
        </p>
        <button
          onClick={submit}
          disabled={!valid || duplicate}
          className="mt-4 w-full rounded-xl bg-primary py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </Modal>
  );
}
