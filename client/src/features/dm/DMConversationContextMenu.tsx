import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import { deleteDMConversation } from "@/store/slices/dmSlice";

interface DMConversationContextMenuProps {
  open: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  partnerPubkey: string;
  /** Called after the conversation is deleted so the parent can navigate away if needed */
  onDeleted?: () => void;
}

export function DMConversationContextMenu({
  open,
  onClose,
  position,
  partnerPubkey,
  onDeleted,
}: DMConversationContextMenuProps) {
  const dispatch = useAppDispatch();
  const ref = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) setConfirmDelete(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onClose]);

  if (!open) return null;

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    dispatch(deleteDMConversation(partnerPubkey));
    onClose();
    onDeleted?.();
  }

  const menuWidth = 200;
  const menuHeight = confirmDelete ? 100 : 50;
  const x = Math.min(position.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(position.y, window.innerHeight - menuHeight - 8);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 w-max min-w-[180px] rounded-xl card-glass py-1.5 shadow-xl animate-fade-in-up"
      style={{ left: x, top: y }}
    >
      {confirmDelete ? (
        <div className="py-1">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">
            Delete this conversation?
          </div>
          <button
            onClick={handleDelete}
            className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} />
            Yes, delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-body hover:bg-surface-hover hover:text-heading transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={handleDelete}
          className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={14} />
          Delete conversation
        </button>
      )}
    </div>,
    document.body,
  );
}
