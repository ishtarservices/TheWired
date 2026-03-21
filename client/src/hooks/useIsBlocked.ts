import { useAppSelector } from "@/store/hooks";

/** Returns true if the given pubkey is on the current user's mute/block list */
export function useIsBlocked(pubkey: string): boolean {
  return useAppSelector((s) =>
    s.identity.muteList.some((m) => m.type === "pubkey" && m.value === pubkey),
  );
}
