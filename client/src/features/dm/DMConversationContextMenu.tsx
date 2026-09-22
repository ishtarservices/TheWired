import { useRef, useState, useEffect } from "react";
import { Trash2, BrainCircuit, Pin, Archive, VolumeX } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { deleteDMConversation, setConversationFlag, isConversationFlagged } from "@/store/slices/dmSlice";
import { ensureDMAIConsent } from "@/features/ai/context/dmConsent";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
import { selectFeatureEnabled, FEATURE_AI } from "@/store/slices/featuresSlice";
import { useAskAI } from "@/features/ai/context/useAskAI";
import { buildDMConversationContext } from "@/features/ai/context/aiContext";

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
  const askAI = useAskAI();
  const aiEnabled = useAppSelector(selectFeatureEnabled(FEATURE_AI));
  const flags = useAppSelector((s) => s.dm.flags);
  const pinned = isConversationFlagged(flags, "pinned", partnerPubkey);
  const archived = isConversationFlagged(flags, "archived", partnerPubkey);
  const muted = isConversationFlagged(flags, "muted", partnerPubkey);
  const toggle = (field: "pinned" | "archived" | "muted", on: boolean) => {
    dispatch(setConversationFlag({ field, conversationId: partnerPubkey, on }));
    onClose();
  };

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
          <>
            <PopoverMenuItem
              icon={<Pin size={14} />}
              label={pinned ? "Unpin" : "Pin"}
              onClick={() => toggle("pinned", !pinned)}
            />
            <PopoverMenuItem
              icon={<Archive size={14} />}
              label={archived ? "Unarchive" : "Archive"}
              onClick={() => toggle("archived", !archived)}
            />
            <PopoverMenuItem
              icon={<VolumeX size={14} />}
              label={muted ? "Unmute" : "Mute"}
              onClick={() => toggle("muted", !muted)}
            />
            <PopoverMenuSeparator />
            {aiEnabled && (
              <>
                <PopoverMenuItem
                  icon={<BrainCircuit size={14} />}
                  label="Summarize with AI"
                  onClick={() => {
                    onClose();
                    // Decrypted DMs leave the device: confirm per session, per provider.
                    void ensureDMAIConsent().then((ok) => {
                      if (ok) askAI(buildDMConversationContext(partnerPubkey));
                    });
                  }}
                />
                <PopoverMenuSeparator />
              </>
            )}
            <PopoverMenuItem
              icon={<Trash2 size={14} />}
              label="Delete conversation"
              onClick={handleDelete}
              variant="danger"
            />
          </>
        )}
      </PopoverMenu>
    </>
  );
}
