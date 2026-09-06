import { useMemo, useRef } from "react";
import { useAppSelector } from "@/store/hooks";
import { buildTiles, updateParticipantOrder } from "@/features/media/buildTiles";
import type { MediaTileModel } from "@/features/media/types";

/**
 * The stage tile list for the connected voice room, in STABLE order:
 * local camera first, then remotes in join order, then screen-share tiles.
 * Speaking state is merged in but never sorts — that reordering was the
 * "tiles jump while people talk" bug in the old VideoGrid.
 */
export function useVoiceTiles(): MediaTileModel[] {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const localState = useAppSelector((s) => s.voice.localState);
  const participants = useAppSelector((s) => s.voice.participants);
  const activeSpeakers = useAppSelector((s) => s.voice.activeSpeakers);

  // Insertion order guard: Redux keeps string-key order, but pin it down
  // explicitly so a future change to the participant store can't reorder.
  const orderRef = useRef<string[]>([]);

  return useMemo(() => {
    orderRef.current = updateParticipantOrder(orderRef.current, participants);
    return buildTiles({
      myPubkey,
      local: localState,
      participants,
      order: orderRef.current,
      activeSpeakers,
    });
  }, [myPubkey, localState, participants, activeSpeakers]);
}
