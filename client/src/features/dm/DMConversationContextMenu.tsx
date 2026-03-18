import { useRef, useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import { deleteDMConversation } from "@/store/slices/dmSlice";
import { PopoverMenu, PopoverMenuItem } from "@/components/ui/PopoverMenu";

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
  const anchorRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) setConfirmDelete(false);
  }, [open]);

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    dispatch(deleteDMConversation(partnerPubkey));
    onClose();
    onDeleted?.();
  }

  return (
    <>
      {/* Invisible anchor element positioned at the right-click point */}
      <div
        ref={anchorRef}
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
          width: 1,
          height: 1,
          pointerEvents: "none",
        }}
      />
      <PopoverMenu open={open} onClose={onClose} anchorRef={anchorRef} position="below">
        {confirmDelete ? (
          <>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">
              Delete this conversation?
            </div>
            <PopoverMenuItem
              icon={<Trash2 size={14} />}
              label="Yes, delete"
              onClick={handleDelete}
              variant="danger"
            />
            <PopoverMenuItem
              icon={null}
              label="Cancel"
              onClick={() => setConfirmDelete(false)}
            />
          </>
        ) : (
          <PopoverMenuItem
            icon={<Trash2 size={14} />}
            label="Delete conversation"
            onClick={handleDelete}
            variant="danger"
          />
        )}
      </PopoverMenu>
    </>
  );
}
