import { Copy, Trash2, EyeOff, Pencil, Reply, BrainCircuit } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import { deleteDMMessage } from "@/store/slices/dmSlice";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
import { useRef } from "react";
import { useAskAI } from "@/features/ai/context/useAskAI";
import { buildDMMessageContext } from "@/features/ai/context/aiContext";
import { useAppSelector } from "@/store/hooks";
import { selectFeatureEnabled, FEATURE_AI } from "@/store/slices/featuresSlice";

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
  const askAI = useAskAI();
  const aiEnabled = useAppSelector(selectFeatureEnabled(FEATURE_AI));

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
        {aiEnabled && (
          <PopoverMenuItem
            icon={<BrainCircuit size={14} />}
            label="Ask AI"
            onClick={() => {
              askAI(buildDMMessageContext(partnerPubkey, wrapId));
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
