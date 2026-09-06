import { useCallback, useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  focusTile,
  pinTile,
  setLayoutMode,
  toggleAutoFocusSpeaker,
  setTileFit,
  clearTileRefs,
} from "@/store/slices/voiceSlice";
import { MediaStage } from "@/features/media/MediaStage";
import type { MediaTileModel } from "@/features/media/types";
import { useVoiceTiles } from "./useVoiceTiles";
import { useVoiceChannel } from "./useVoiceChannel";
import { TileVolumeControl } from "./TileVolumeControl";
import { TileModerationMenu } from "./TileModerationMenu";
import { usePermissions } from "@/features/spaces/usePermissions";
import type { TileFit } from "@/types/calling";

/**
 * The voice/video channel stage: tiles from Redux + layout state, on the
 * shared MediaStage. A new screen share auto-enters focus (unless the user
 * pinned something); tiles that vanish are dropped from layout refs.
 */
export function VoiceStage({ className }: { className?: string }) {
  const dispatch = useAppDispatch();
  const tiles = useVoiceTiles();
  const layout = useAppSelector((s) => s.voice.layout);
  const activeSpeakers = useAppSelector((s) => s.voice.activeSpeakers);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const { toggleScreenShare, localState, connectedRoom } = useVoiceChannel();
  const spaceId = connectedRoom?.spaceId ?? null;
  const channelId = connectedRoom?.channelId ?? null;
  const { can } = usePermissions(spaceId);
  const canModerate = can("MUTE_MEMBERS", channelId ?? undefined);

  // Auto-focus a screen share when it starts.
  const prevShares = useRef<string[]>([]);
  useEffect(() => {
    // Remote shares only — spotlighting your own placeholder card is useless;
    // the sharer should keep seeing the people they are presenting to.
    const shares = tiles
      .filter((t) => t.source === "screenshare" && !t.isLocal)
      .map((t) => t.id);
    const appeared = shares.some((id) => !prevShares.current.includes(id));
    prevShares.current = shares;
    if (appeared && layout.mode === "grid" && !layout.pinnedTileId) {
      dispatch(setLayoutMode("focus"));
    }
  }, [tiles, layout.mode, layout.pinnedTileId, dispatch]);

  // Forget focus/pin/fit for tiles that no longer exist.
  useEffect(() => {
    const ids = new Set(tiles.map((t) => t.id));
    const stale = [layout.focusedTileId, layout.pinnedTileId, ...Object.keys(layout.fitOverrides)]
      .filter((id): id is string => !!id && !ids.has(id));
    if (stale.length > 0) dispatch(clearTileRefs(stale));
  }, [tiles, layout.focusedTileId, layout.pinnedTileId, layout.fitOverrides, dispatch]);

  const onFocusTile = useCallback((id: string | null) => dispatch(focusTile(id)), [dispatch]);
  const onPinTile = useCallback((id: string | null) => dispatch(pinTile(id)), [dispatch]);
  const onSetLayoutMode = useCallback(
    (mode: "grid" | "focus") => dispatch(setLayoutMode(mode)),
    [dispatch],
  );
  const onToggleAuto = useCallback(() => dispatch(toggleAutoFocusSpeaker()), [dispatch]);
  const onSetFit = useCallback(
    (id: string, fit: TileFit) => dispatch(setTileFit({ id, fit })),
    [dispatch],
  );
  const onStopLocalShare = useCallback(() => {
    if (localState.screenSharing) void toggleScreenShare();
  }, [localState.screenSharing, toggleScreenShare]);
  // (toggleScreenShare from useVoiceChannel already branches on the live flag)

  const renderTileExtras = useCallback(
    (tile: MediaTileModel) => {
      if (tile.isLocal || tile.source !== "camera") return null;
      return (
        <>
          <TileVolumeControl pubkey={tile.pubkey} />
          {canModerate && spaceId && channelId && (
            <TileModerationMenu spaceId={spaceId} channelId={channelId} pubkey={tile.pubkey} />
          )}
        </>
      );
    },
    [canModerate, spaceId, channelId],
  );

  return (
    <MediaStage
      className={className}
      tiles={tiles}
      layout={layout}
      activeSpeakers={activeSpeakers}
      localPubkey={myPubkey}
      onFocusTile={onFocusTile}
      onPinTile={onPinTile}
      onSetLayoutMode={onSetLayoutMode}
      onToggleAutoFocusSpeaker={onToggleAuto}
      onSetFit={onSetFit}
      onStopLocalShare={onStopLocalShare}
      renderTileExtras={renderTileExtras}
    />
  );
}
