import { useCallback, useRef, useState } from "react";
import { MicOff, MoreHorizontal, UserX, VideoOff } from "lucide-react";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
import { ToolbarButton } from "@/features/media/MediaTile";
import { voiceKick, voiceMute } from "@/lib/api/voice";

interface TileModerationMenuProps {
  spaceId: string;
  channelId: string;
  pubkey: string;
}

/**
 * Moderator actions on a participant tile (needs MUTE_MEMBERS — the
 * backend re-checks). Server mute/disable camera use LiveKit's admin API;
 * kick removes them from the room.
 */
export function TileModerationMenu({ spaceId, channelId, pubkey }: TileModerationMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const closedAt = useRef(0);

  const onClose = useCallback(() => {
    closedAt.current = Date.now();
    setOpen(false);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      console.warn("[voice] moderation action failed:", err);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <>
      <span ref={(el) => void (anchorRef.current = el)}>
        <ToolbarButton
          label="Moderate"
          active={open}
          onClick={() => {
            if (Date.now() - closedAt.current < 250) return;
            setOpen((v) => !v);
          }}
        >
          <MoreHorizontal size={13} />
        </ToolbarButton>
      </span>
      <PopoverMenu open={open} onClose={onClose} anchorRef={anchorRef} position="below">
        <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
          Moderation
        </div>
        <PopoverMenuItem
          icon={<MicOff size={14} />}
          label={busy ? "Working…" : "Server mute microphone"}
          onClick={() => void run(() => voiceMute(spaceId, channelId, pubkey, "microphone"))}
        />
        <PopoverMenuItem
          icon={<VideoOff size={14} />}
          label="Turn off their camera"
          onClick={() => void run(() => voiceMute(spaceId, channelId, pubkey, "camera"))}
        />
        <PopoverMenuSeparator />
        <PopoverMenuItem
          icon={<UserX size={14} />}
          label="Remove from voice"
          variant="danger"
          onClick={() => void run(() => voiceKick(spaceId, channelId, pubkey))}
        />
      </PopoverMenu>
    </>
  );
}
