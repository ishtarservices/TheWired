// One-shot "share a note into a space channel" post. Reuses createChatSession
// (it already owns NIP-42 AUTH answering, OK waiters and backoff) rather than
// a lighter post-once path — the socket is ephemeral (created → post →
// destroyed), matching the ChannelScreen on-demand allowance; the resting
// 3-socket budget is untouched.

import { createChatSession } from "./chatSession";
import type { PlatformAdapters } from "@/core/adapters";

const AUTH_RETRY_DELAY_MS = 600;

export interface ShareToSpaceOptions {
  adapters: PlatformAdapters;
  relayUrl: string;
  spaceId: string;
  channelId: string;
  isDefaultChannel: boolean;
  /** The share payload — a `nostr:nevent1…` reference string. */
  content: string;
}

/** Post `content` as a kind-9 into the given channel; resolves on relay OK,
 *  rejects with the relay's reason verbatim (membership refusals, etc.). */
export async function postNoteRefToChannel(opts: ShareToSpaceOptions): Promise<void> {
  const session = createChatSession({
    adapters: opts.adapters,
    relayUrl: opts.relayUrl,
    spaceId: opts.spaceId,
    channelId: opts.channelId,
    isDefaultChannel: opts.isDefaultChannel,
    onMessage: () => {},
  });
  try {
    try {
      await session.post(opts.content);
    } catch (error) {
      // The EVENT can race the NIP-42 AUTH handshake on platform relays —
      // one retry after the challenge round-trip settles.
      if (!/auth/i.test(error instanceof Error ? error.message : "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, AUTH_RETRY_DELAY_MS));
      await session.post(opts.content);
    }
  } finally {
    session.destroy();
  }
}
