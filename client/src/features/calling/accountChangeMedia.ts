/**
 * Calls end when the account changes.
 *
 * A voice/video channel or 1:1 call belongs to the account that joined it:
 * its LiveKit identity was minted for that account, and its presence and E2EE
 * key envelopes are signed by that account. It cannot move to another account.
 * So every account change (switch, add/import, log out, removing the active
 * account) ends it in two steps:
 *
 *  1. Graceful, while the outgoing account's signer is still live: hang up
 *     (an outgoing call that is still ringing tells the callee "call missed"),
 *     or leave the channel (clears its room presence). Bounded, so a dead
 *     relay can't hold the switch hostage.
 *  2. Hard stop (`abandonMediaSessions`): disconnect whatever room is left,
 *     including one still connecting, and clear call timers. Nothing in this
 *     step signs. `performCleanup()` repeats it as the backstop for any path
 *     that skipped step 1.
 *
 * Joins already in flight are invalidated first, so one that completes during
 * the hand-over aborts instead of publishing presence or landing in the next
 * account's state.
 *
 * The UI asks before any of this happens (`useEndCallConfirm`); this module is
 * the guarantee underneath.
 */
import { createSelector } from "@reduxjs/toolkit";
import { store, type RootState } from "@/store";
import { abandonMediaSessions, invalidateMediaJoins } from "@/lib/webrtc/mediaSession";
import { createLogger } from "@/lib/debug/logger";
import type { CallType } from "@/types/calling";

const log = createLogger("call");

/** Upper bound for each teardown step. Hanging up is a LiveKit leave plus at
 *  most one signed event; anything slower is a dead relay, not worth waiting
 *  for. */
export const ACCOUNT_CHANGE_TEARDOWN_TIMEOUT_MS = 4000;

/** What an account change would end right now (null = nothing). */
export type ActiveMediaSession =
  | { kind: "call"; partnerPubkey: string; callType: CallType; ringing: boolean }
  | { kind: "voice"; spaceId: string; channelId: string }
  | { kind: "voice_connecting" };

export const selectActiveMediaSession = createSelector(
  [
    (s: RootState) => s.call.activeCall,
    (s: RootState) => s.voice.connectedRoom,
    (s: RootState) => s.voice.connecting,
  ],
  (call, room, connecting): ActiveMediaSession | null => {
    if (call) {
      return {
        kind: "call",
        partnerPubkey: call.partnerPubkey,
        callType: call.callType,
        ringing: call.state === "ringing",
      };
    }
    if (room) return { kind: "voice", spaceId: room.spaceId, channelId: room.channelId };
    if (connecting) return { kind: "voice_connecting" };
    return null;
  },
);

function within(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.then(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        log.warn(`account-change teardown step exceeded ${ms}ms — moving on`);
        resolve();
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * End every call/channel session of the CURRENT account. Call this before
 * anything that changes the active signer: `TauriSigner.importKey` /
 * `generateKey` / `switchAccount` make another key the one that signs.
 * Never rejects.
 */
export async function endMediaSessionsForAccountChange(
  timeoutMs = ACCOUNT_CHANGE_TEARDOWN_TIMEOUT_MS,
): Promise<void> {
  invalidateMediaJoins();
  const { call, voice } = store.getState();

  const graceful = (async () => {
    if (call.activeCall) {
      const { hangupCall } = await import("./callService");
      await hangupCall().catch((err) => log.warn("hang-up before account change failed", err));
    }
    if (voice.connectedRoom || voice.connecting) {
      const { leaveVoiceChannel } = await import("@/features/voice/voiceService");
      await leaveVoiceChannel().catch((err) => log.warn("leaving voice before account change failed", err));
    }
  })();

  await within(graceful, timeoutMs);
  await within(abandonMediaSessions(), timeoutMs);
}
