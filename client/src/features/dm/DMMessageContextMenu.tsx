import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Copy, Trash2 } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import { deleteDMMessage } from "@/store/slices/dmSlice";

interface DMMessageContextMenuProps {
  open: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  partnerPubkey: string;
  wrapId: string;
  content: string;
}

export function DMMessageContextMenu({
  open,
  onClose,
  position,
  partnerPubkey,
  wrapId,
  content,
}: DMMessageContextMenuProps) {
  const dispatch = useAppDispatch();
  const ref = useRef<HTMLDivElement>(null);

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

  function handleCopy() {
    navigator.clipboard.writeText(content).catch(() => {});
    onClose();
  }

  function handleDelete() {
    dispatch(deleteDMMessage({ partnerPubkey, wrapId }));
    onClose();
  }

  // Clamp position so the menu doesn't overflow the viewport
  const menuWidth = 160;
  const menuHeight = 90;
  const x = Math.min(position.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(position.y, window.innerHeight - menuHeight - 8);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 w-max min-w-[160px] rounded-xl card-glass py-1.5 shadow-xl animate-fade-in-up"
      style={{ left: x, top: y }}
    >
      <button
        onClick={handleCopy}
        className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-body hover:bg-surface-hover hover:text-heading transition-colors"
      >
        <Copy size={14} />
        Copy text
      </button>
      <div className="my-1 border-t border-edge" />
      <button
        onClick={handleDelete}
        className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <Trash2 size={14} />
        Delete message
      </button>
    </div>,
    document.body,
  );
}
