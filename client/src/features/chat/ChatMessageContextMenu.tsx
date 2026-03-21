import { useRef } from "react";
import { Copy, Trash2, EyeOff, Pencil, Shield } from "lucide-react";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "../../components/ui/PopoverMenu";

interface ChatMessageContextMenuProps {
  open: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  content: string;
  isOwnMessage: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onModDelete: () => void;
  onEdit: () => void;
}

export function ChatMessageContextMenu({
  open,
  onClose,
  position,
  content,
  isOwnMessage,
  isAdmin,
  canEdit,
  onDeleteForMe,
  onDeleteForEveryone,
  onModDelete,
  onEdit,
}: ChatMessageContextMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null);

  function handleCopy() {
    navigator.clipboard.writeText(content).catch(() => {});
    onClose();
  }

  return (
    <>
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
          onClick={() => { onDeleteForMe(); onClose(); }}
        />
        {isOwnMessage && (
          <PopoverMenuItem
            icon={<Trash2 size={14} />}
            label="Delete for everyone"
            onClick={() => { onDeleteForEveryone(); onClose(); }}
            variant="danger"
          />
        )}
        {!isOwnMessage && isAdmin && (
          <PopoverMenuItem
            icon={<Shield size={14} />}
            label="Delete message"
            onClick={() => { onModDelete(); onClose(); }}
            variant="danger"
          />
        )}
      </PopoverMenu>
    </>
  );
}
