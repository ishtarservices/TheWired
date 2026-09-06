import { useEffect, useState } from "react";
import { nextSpeakerHold, type SpeakerHold } from "./layout/resolveFocusTarget";

/**
 * The pubkey currently "on stage" for auto-focus: follows the loudest
 * speaker but holds each one for at least `holdMs` and keeps the last
 * speaker through silence, so the stage doesn't flap mid-sentence.
 */
export function useHeldSpeaker(activeSpeakers: string[], holdMs = 2000): string | null {
  const [state, setState] = useState<SpeakerHold>({ current: null, since: 0 });

  useEffect(() => {
    const now = Date.now();
    const next = nextSpeakerHold(state, activeSpeakers, now, holdMs);
    if (next !== state) {
      setState(next);
      return;
    }
    // A switch is being held back — re-evaluate when the hold expires.
    const candidate = activeSpeakers[0];
    if (candidate && candidate !== state.current) {
      const wait = Math.max(0, state.since + holdMs - now) + 1;
      const t = setTimeout(
        () => setState((s) => nextSpeakerHold(s, activeSpeakers, Date.now(), holdMs)),
        wait,
      );
      return () => clearTimeout(t);
    }
  }, [activeSpeakers, state, holdMs]);

  return state.current;
}
