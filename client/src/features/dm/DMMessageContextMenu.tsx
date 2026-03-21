import { Copy, Trash2, EyeOff, Pencil, Reply } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import { deleteDMMessage } from "@/store/slices/dmSlice";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
import { useRef } from "react";

interface DMMessageContextMenuProps {
  open: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  partnerPubkey: string;
  wrapId: string;
  content: string;
  isOwnMessage: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDeleteForEveryone: () => void;
  onReply?: () => void;
}

export function DMMessageContextMenu({
  open,
  onClose,
  position,
  partnerPubkey,
  wrapId,
  content,
  isOwnMessage,
  canEdit,
  onEdit,
  onDeleteForEveryone,
  onReply,
}: DMMessageContextMenuProps) {
  const dispatch = useAppDispatch();
  const anchorRef = useRef<HTMLDivElement>(null);

  function handleCopy() {
    navigator.clipboard.writeText(content).catch(() => {});
    onClose();
  }

  function handleDeleteForMe() {
    dispatch(deleteDMMessage({ partnerPubkey, wrapId }));
    onClose();
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
        {onReply && (
          <PopoverMenuItem
            icon={<Reply size={14} />}
            label="Reply"
            onClick={() => { onReply(); onClose(); }}
          />
        )}
        <PopoverMenuItem
          icon={<Copy size={14} />}
          label="Copy text"
          onClick={handleCopy}
        />
        {isOwnMessage && canEdit && (
          <PopoverMenuItem
            icon={<Pencil size={14} />}
            label="Edit message"
            onClick={() => { onEdit(); onClose(); }}
          />
        )}
        <PopoverMenuSeparator />
        <PopoverMenuItem
          icon={<EyeOff size={14} />}
          label="Delete for me"
          onClick={handleDeleteForMe}
        />
        {isOwnMessage && (
          <PopoverMenuItem
            icon={<Trash2 size={14} />}
            label="Delete for everyone"
            onClick={() => { onDeleteForEveryone(); onClose(); }}
            variant="danger"
          />
        )}
      </PopoverMenu>
    </>
  );
}
