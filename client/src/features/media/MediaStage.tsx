import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { LayoutGrid, Maximize2, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useElementSize } from "@/hooks/useElementSize";
import { TileGrid } from "./TileGrid";
import { FocusLayout } from "./FocusLayout";
import { MediaTile } from "./MediaTile";
import { resolveFocusTarget } from "./layout/resolveFocusTarget";
import { useHeldSpeaker } from "./useHeldSpeaker";
import { tileId, type MediaTileModel, type VoiceLayoutState } from "./types";
import type { TileFit } from "@/types/calling";

export interface MediaStageProps {
  tiles: MediaTileModel[];
  layout: VoiceLayoutState;
  activeSpeakers: string[];
  localPubkey: string | null;
  onFocusTile: (id: string | null) => void;
  onPinTile: (id: string | null) => void;
  onSetLayoutMode: (mode: "grid" | "focus") => void;
  onToggleAutoFocusSpeaker: () => void;
  onSetFit: (id: string, fit: TileFit) => void;
  onStopLocalShare?: () => void;
  /** Per-tile toolbar extras (volume, moderation). */
  renderTileExtras?: (tile: MediaTileModel) => ReactNode;
  /** Hide the grid/focus/auto toolbar (1:1 calls). */
  hideToolbar?: boolean;
  className?: string;
}

/**
 * The shared stage for voice channels and calls: measures itself, picks
 * grid vs focus, and wires tile interactions. Tiles keep their insertion
 * order — speaking only changes the ring (and, in focus mode with
 * auto-focus on, who is on stage).
 */
export function MediaStage({
  tiles,
  layout,
  activeSpeakers,
  localPubkey,
  onFocusTile,
  onPinTile,
  onSetLayoutMode,
  onToggleAutoFocusSpeaker,
  onSetFit,
  onStopLocalShare,
  renderTileExtras,
  hideToolbar,
  className,
}: MediaStageProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();

  // Auto-focus follows remote speakers only — putting yourself on stage
  // whenever you talk is disorienting.
  const remoteSpeakers = useMemo(
    () => activeSpeakers.filter((pk) => pk !== localPubkey),
    [activeSpeakers, localPubkey],
  );
  const heldSpeaker = useHeldSpeaker(remoteSpeakers);

  const tileIds = useMemo(() => tiles.map((t) => t.id), [tiles]);
  // Only REMOTE shares are auto-stage candidates; the local share tile is a
  // placeholder card (the sharer can still pin/focus it deliberately).
  const screenShareTileIds = useMemo(
    () => tiles.filter((t) => t.source === "screenshare" && !t.isLocal).map((t) => t.id),
    [tiles],
  );

  const stageTileId =
    layout.mode === "focus"
      ? resolveFocusTarget({
          tileIds,
          screenShareTileIds,
          pinnedTileId: layout.pinnedTileId,
          focusedTileId: layout.focusedTileId,
          autoFocusSpeaker: layout.autoFocusSpeaker,
          speakerTileId: heldSpeaker ? tileId(heldSpeaker, "camera") : null,
        })
      : null;

  // Escape leaves focus mode (unless typing somewhere).
  useEffect(() => {
    if (layout.mode !== "focus") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      onSetLayoutMode("grid");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout.mode, onSetLayoutMode]);

  const enterFocus = useCallback(() => {
    // Prefer a screen share, then the first remote, then whatever is first.
    const pick =
      screenShareTileIds[0] ?? tiles.find((t) => !t.isLocal)?.id ?? tiles[0]?.id ?? null;
    if (pick) onFocusTile(pick);
  }, [screenShareTileIds, tiles, onFocusTile]);

  const renderTile = (tile: MediaTileModel, opts: { compact: boolean; onStage: boolean }) => {
    const fit: TileFit = layout.fitOverrides[tile.id] ?? "cover";
    return (
      <MediaTile
        tile={tile}
        fit={fit}
        compact={opts.compact}
        isOnStage={opts.onStage}
        isPinned={layout.pinnedTileId === tile.id}
        onFocus={() => onFocusTile(tile.id)}
        onExitFocus={() => onSetLayoutMode("grid")}
        onPin={() => onPinTile(layout.pinnedTileId === tile.id ? null : tile.id)}
        onToggleFit={() => onSetFit(tile.id, fit === "cover" ? "contain" : "cover")}
        onStopLocalShare={onStopLocalShare}
        extras={renderTileExtras?.(tile)}
      />
    );
  };

  return (
    <div ref={ref} className={cn("relative h-full w-full overflow-hidden", className)}>
      {tiles.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted">
          Waiting for others to join…
        </div>
      ) : stageTileId ? (
        <FocusLayout
          tiles={tiles}
          stageTileId={stageTileId}
          width={width}
          height={height}
          renderTile={renderTile}
        />
      ) : (
        <TileGrid
          tiles={tiles}
          width={width}
          height={height}
          renderTile={(tile) => renderTile(tile, { compact: false, onStage: false })}
        />
      )}

      {!hideToolbar && tiles.length > 1 && (
        <div className="absolute left-2 top-2 flex items-center gap-0.5 rounded-lg bg-black/50 p-0.5 backdrop-blur-sm">
          <StageButton
            label="Grid"
            active={!stageTileId}
            onClick={() => onSetLayoutMode("grid")}
          >
            <LayoutGrid size={14} />
          </StageButton>
          <StageButton label="Focus one tile" active={!!stageTileId} onClick={enterFocus}>
            <Maximize2 size={14} />
          </StageButton>
          <StageButton
            label={
              layout.autoFocusSpeaker
                ? "Following the active speaker (click to stop)"
                : "Follow the active speaker"
            }
            active={layout.autoFocusSpeaker}
            onClick={onToggleAutoFocusSpeaker}
          >
            <Radio size={14} />
          </StageButton>
        </div>
      )}
    </div>
  );
}

function StageButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "rounded-md p-1.5 text-white/75 transition-colors hover:bg-white/15 hover:text-white",
        active && "bg-white/20 text-white",
      )}
    >
      {children}
    </button>
  );
}
