/**
 * Which tile owns the stage in focus mode.
 *
 * Priority: pinned › explicitly focused › a screen share › the held active
 * speaker (only when auto-focus is on). A screen share beats the speaker on
 * purpose — bouncing between the shared screen and whoever is talking was
 * the "tries to switch to who is talking but does it broken" complaint.
 * Ids that no longer exist are skipped, so a leaver never leaves the stage
 * pointing at nothing while another candidate exists.
 */
export interface FocusTargetInput {
  tileIds: string[];
  screenShareTileIds: string[];
  pinnedTileId: string | null;
  focusedTileId: string | null;
  autoFocusSpeaker: boolean;
  /** Tile id of the held active speaker's camera, if any. */
  speakerTileId: string | null;
}

export function resolveFocusTarget(input: FocusTargetInput): string | null {
  const present = new Set(input.tileIds);
  const has = (id: string | null): id is string => !!id && present.has(id);

  if (has(input.pinnedTileId)) return input.pinnedTileId;
  if (has(input.focusedTileId)) return input.focusedTileId;
  const share = input.screenShareTileIds.find((id) => present.has(id));
  if (share) return share;
  if (input.autoFocusSpeaker && has(input.speakerTileId)) return input.speakerTileId;
  return null;
}

/**
 * Debounced "who is on stage" for auto-focus. The stage switches to the
 * loudest current speaker, but never more often than `holdMs`, and it does
 * not go blank during silence — it keeps the last speaker.
 */
export interface SpeakerHold {
  current: string | null;
  since: number;
}

export function nextSpeakerHold(
  state: SpeakerHold,
  activeSpeakers: string[],
  now: number,
  holdMs = 2000,
): SpeakerHold {
  if (state.current && activeSpeakers.includes(state.current)) return state;
  const candidate = activeSpeakers[0] ?? null;
  if (!candidate) return state;
  if (state.current && now - state.since < holdMs) return state;
  return { current: candidate, since: now };
}
