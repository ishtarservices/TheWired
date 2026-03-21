import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setMuteList } from "@/store/slices/identitySlice";
import { buildMuteListEvent } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";

/** Returns a callback that removes the given pubkey from the mute/block list */
export function useUnblock(pubkey: string): () => void {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const muteList = useAppSelector((s) => s.identity.muteList);
  const dispatch = useAppDispatch();

  return useCallback(async () => {
    if (!myPubkey) return;
    const newMutes = muteList.filter(
      (m) => !(m.type === "pubkey" && m.value === pubkey),
    );
    const now = Math.floor(Date.now() / 1000);
    dispatch(setMuteList({ mutes: newMutes, createdAt: now }));
    const unsigned = buildMuteListEvent(myPubkey, newMutes);
    await signAndPublish(unsigned);
  }, [myPubkey, pubkey, muteList, dispatch]);
}
