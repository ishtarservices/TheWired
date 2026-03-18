import { Copy, Trash2 } from "lucide-react";
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
  const anchorRef = useRef<HTMLDivElement>(null);

  function handleCopy() {
    navigator.clipboard.writeText(content).catch(() => {});
    onClose();
  }

  function handleDelete() {
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
        <PopoverMenuItem
          icon={<Copy size={14} />}
          label="Copy text"
          onClick={handleCopy}
        />
        <PopoverMenuSeparator />
        <PopoverMenuItem
          icon={<Trash2 size={14} />}
          label="Delete message"
          onClick={handleDelete}
          variant="danger"
        />
      </PopoverMenu>
    </>
  );
}
