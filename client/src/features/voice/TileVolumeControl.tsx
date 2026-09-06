import { useCallback, useRef, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { PopoverMenu } from "@/components/ui/PopoverMenu";
import { ToolbarButton } from "@/features/media/MediaTile";
import { useParticipantAudio } from "./devices/useMediaPrefs";

/**
 * Per-user playback volume + local mute, from the tile toolbar. Only this
 * client is affected (it's a playback setting, not a server mute).
 */
export function TileVolumeControl({ pubkey }: { pubkey: string }) {
  const [open, setOpen] = useState(false);
  const [audio, update] = useParticipantAudio(pubkey);
  const anchorRef = useRef<HTMLElement | null>(null);
  const closedAt = useRef(0);

  const onClose = useCallback(() => {
    closedAt.current = Date.now();
    setOpen(false);
  }, []);

  const Icon = audio.muted || audio.volume === 0 ? VolumeX : audio.volume < 0.6 ? Volume1 : Volume2;
  const pct = Math.round(audio.volume * 100);

  return (
    <>
      <span ref={(el) => {
        // ToolbarButton owns the <button>; anchor to its wrapper instead.
        anchorRef.current = el;
      }}>
        <ToolbarButton
          label={audio.muted ? `Muted locally · ${pct}%` : `Volume ${pct}%`}
          active={audio.muted || audio.volume !== 1}
          onClick={() => {
            if (Date.now() - closedAt.current < 250) return;
            setOpen((v) => !v);
          }}
        >
          <Icon size={13} />
        </ToolbarButton>
      </span>
      <PopoverMenu open={open} onClose={onClose} anchorRef={anchorRef} position="below">
        <div className="flex w-56 flex-col gap-2 px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-heading">User volume</span>
            <span className="text-muted">{pct}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pct}
            onChange={(e) => update({ volume: Number(e.target.value) / 100, muted: false })}
            className="w-full accent-primary"
            aria-label="User volume"
          />
          <div className="flex items-center justify-between">
            <button
              onClick={() => update({ muted: !audio.muted })}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                audio.muted
                  ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                  : "bg-surface-hover text-heading hover:bg-border-light"
              }`}
            >
              {audio.muted ? "Unmute for me" : "Mute for me"}
            </button>
            <button
              onClick={() => update({ volume: 1, muted: false })}
              className="text-xs text-muted hover:text-heading"
            >
              Reset
            </button>
          </div>
        </div>
      </PopoverMenu>
    </>
  );
}
