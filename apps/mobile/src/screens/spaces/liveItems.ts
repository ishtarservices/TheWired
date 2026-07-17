// "Live now" derivation for the SpacesHome grouped channel list. Mobile has
// no live sources yet — voice channels and listen-together sessions arrive
// in a later phase — so this returns the stable empty list and the section
// simply doesn't render. The shape is fixed now so those features plug in
// as selectors without touching the list UI.

import type { RootState } from "@/store";

export interface LiveItem {
  id: string;
  kind: "voice" | "listen-together";
  /** The channel this session lives in, when it maps to one. */
  channelId: string | null;
  label: string;
  participantPubkeys: string[];
}

const EMPTY: LiveItem[] = [];

/** Referentially stable — safe for useAppSelector without memoization. */
export function selectLiveItems(_state: RootState, _spaceId: string): LiveItem[] {
  return EMPTY;
}
