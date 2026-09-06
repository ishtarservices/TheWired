import { useCallback, useSyncExternalStore } from "react";
import {
  getMediaPrefs,
  setMediaPrefs,
  subscribeMediaPrefs,
  getParticipantAudio,
  setParticipantAudio,
  subscribeParticipantAudio,
  type MediaPrefs,
  type ParticipantAudioPrefs,
} from "@/lib/webrtc/mediaPrefs";

/** Reactive view of the persisted media preferences. */
export function useMediaPrefs(): [MediaPrefs, (patch: Partial<MediaPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribeMediaPrefs, getMediaPrefs, getMediaPrefs);
  const update = useCallback((patch: Partial<MediaPrefs>) => {
    setMediaPrefs(patch);
  }, []);
  return [prefs, update];
}

/** Reactive per-participant volume/mute. */
export function useParticipantAudio(
  pubkey: string,
): [ParticipantAudioPrefs, (patch: Partial<ParticipantAudioPrefs>) => void] {
  const subscribe = useCallback(
    (onChange: () => void) =>
      subscribeParticipantAudio((changed) => {
        if (changed === pubkey) onChange();
      }),
    [pubkey],
  );
  const get = useCallback(() => getParticipantAudio(pubkey), [pubkey]);
  const prefs = useSyncExternalStore(subscribe, get, get);
  const update = useCallback(
    (patch: Partial<ParticipantAudioPrefs>) => {
      setParticipantAudio(pubkey, patch);
    },
    [pubkey],
  );
  return [prefs, update];
}
