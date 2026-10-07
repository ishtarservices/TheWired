// "Mine" for music: a release authored by my account, or by a shared-project
// key this device holds (soot docs/collab-shared-key.md §4). Every ownership
// check in the music UI goes through here instead of `pubkey === item.pubkey`.

import { useCallback } from "react";
import type { EventSigner } from "@ishtarservices/core";
import { store, type RootState } from "@/store";
import { useAppSelector } from "@/store/hooks";
import { getProjectSigner } from "./projectKeys";

export function isMinePubkey(state: RootState, pubkey: string | undefined | null): boolean {
  if (!pubkey) return false;
  return pubkey === state.identity.pubkey || pubkey in (state.music.heldProjectKeys ?? {});
}

const NO_HELD_KEYS: Record<string, string> = {};

/** `isMine(pubkey)` for the current account; re-renders when held keys change. */
export function useIsMine(): (pubkey: string | undefined | null) => boolean {
  const me = useAppSelector((s) => s.identity.pubkey);
  const held = useAppSelector((s) => s.music.heldProjectKeys) ?? NO_HELD_KEYS;
  return useCallback(
    (pubkey: string | undefined | null) => !!pubkey && (pubkey === me || pubkey in held),
    [me, held],
  );
}

/** True when `pubkey` is a shared-project key this device holds. */
export function useHoldsProjectKey(pubkey: string | undefined | null): boolean {
  return useAppSelector((s) => !!pubkey && pubkey in (s.music.heldProjectKeys ?? {}));
}

/**
 * Who signs a change to a release authored by `pubkey`: `pubkey` is what the
 * rebuilt event's author must be, `signer` is the explicit signer to pass to
 * signAndPublish / NIP-98 (undefined = the account signer). Null when this
 * device can't edit the release directly (propose instead).
 */
export interface ReleaseSigner {
  pubkey: string;
  signer?: EventSigner;
}

export async function signerForRelease(pubkey: string): Promise<ReleaseSigner | null> {
  const state = store.getState();
  if (pubkey === state.identity.pubkey) return { pubkey };
  if (!(pubkey in (state.music.heldProjectKeys ?? {}))) return null;
  const signer = await getProjectSigner(pubkey);
  return signer ? { pubkey, signer } : null;
}
