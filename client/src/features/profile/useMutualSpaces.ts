import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import type { Space } from "@/types/space";

/** Returns spaces where both the current user and the target pubkey are members */
export function useMutualSpaces(pubkey: string): Space[] {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const spaces = useAppSelector((s) => s.spaces.list);

  return useMemo(() => {
    if (!myPubkey || myPubkey === pubkey) return [];

    return spaces.filter(
      (s) =>
        s.memberPubkeys.includes(myPubkey) &&
        s.memberPubkeys.includes(pubkey),
    );
  }, [myPubkey, pubkey, spaces]);
}
