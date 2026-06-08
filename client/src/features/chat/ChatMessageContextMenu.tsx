import { useRef } from "react";
import { Copy, Trash2, EyeOff, Pencil, Shield, BrainCircuit } from "lucide-react";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "../../components/ui/PopoverMenu";
import { useAppSelector } from "../../store/hooks";
import { selectFeatureEnabled, FEATURE_AI } from "../../store/slices/featuresSlice";
import { useAskAI } from "../ai/context/useAskAI";
import { buildSelectionContext } from "../ai/context/aiContext";

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
  const askAI = useAskAI();
  const aiEnabled = useAppSelector(selectFeatureEnabled(FEATURE_AI));

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
        {aiEnabled && (
          <PopoverMenuItem
            icon={<BrainCircuit size={14} />}
            label="Ask AI"
            onClick={() => {
              askAI(buildSelectionContext(content, "Space message"));
              onClose();
            }}
          />
        )}
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
