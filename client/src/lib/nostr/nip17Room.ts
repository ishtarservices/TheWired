// NIP-17 group rooms moved to @thewired/core (Phase 0). The pure helpers
// re-export directly; createGroupMessageWraps keeps its original desktop
// signature (explicit myPubkey, implicit signer) on top of the core context
// API. See the core module for the full design notes.

import {
  createGroupMessageWraps as coreCreateGroupMessageWraps,
  type GroupMessageResult,
  type GroupWrap,
} from "@thewired/core";
import { nip44Encrypt, nip44Decrypt } from "./nip44";
import { getSigner } from "./loginFlow";
import { signingQueue } from "./signingQueue";
import type { UnsignedEvent } from "@/types/nostr";

export {
  roomKeyFromParticipants,
  buildGroupRumor,
  participantsOf,
  isGroupDM,
  roomIdOf,
  subjectOf,
} from "@thewired/core";
export type { GroupMessageResult, GroupWrap };

/**
 * Create the full set of gift wraps for one group message: one wrap per
 * recipient plus a self-wrap, all sealing the SAME rumor. The caller publishes
 * each wrap to that participant's DM inbox relays.
 */
export async function createGroupMessageWraps(
  content: string,
  participants: string[],
  myPubkey: string,
  opts?: { subject?: string; roomId?: string },
): Promise<GroupMessageResult> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  return coreCreateGroupMessageWraps(
    {
      myPubkey,
      signer: {
        getPublicKey: () => Promise.resolve(myPubkey),
        signEvent: (unsigned: UnsignedEvent) =>
          signingQueue.enqueue(() => signer.signEvent(unsigned)),
        nip44Encrypt,
        nip44Decrypt,
      },
    },
    content,
    participants,
    opts,
  );
}
