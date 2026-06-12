import { useEffect, useRef } from "react";
import { useAppSelector } from "@/store/hooks";
import { EVENT_KINDS } from "@/types/nostr";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { relayManager } from "@/lib/nostr/relayManager";
import { getOwnDMRelays } from "@/lib/nostr/dmRelayList";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("call");

/**
 * Hook that subscribes to NIP-RTC signaling events for the active call.
 * The actual event handling is done in eventPipeline via gift wraps.
 * This hook handles kind:25050 signaling for SDP/ICE exchange.
 */
export function useCallSignaling() {
  const activeCall = useAppSelector((s) => s.call.activeCall);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const subIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeCall || !myPubkey) {
      if (subIdRef.current) {
        subscriptionManager.close(subIdRef.current);
        subIdRef.current = null;
      }
      return;
    }

    const roomId = activeCall.roomId;
    if (!roomId) return;

    // Subscribe to kind:25050 events for this room. The partner targets our
    // DM relays (getSignalRelays), so listen there too — not just the read
    // set — or signals can land on a relay we aren't watching.
    const dmRelays = getOwnDMRelays();
    const relayUrls =
      dmRelays.length > 0
        ? [...new Set([...dmRelays, ...relayManager.getReadRelays().map((c) => c.url)])]
        : undefined;
    const subId = subscriptionManager.subscribe({
      filters: [
        {
          kinds: [EVENT_KINDS.WEBRTC_SIGNAL],
          "#r": [roomId],
          "#p": [myPubkey],
          since: Math.round(Date.now() / 1000) - 60,
        },
      ],
      relayUrls,
    });

    subIdRef.current = subId;
    log.debug(`signal subscription OPEN room=${roomId.slice(0, 8)}`);

    return () => {
      if (subIdRef.current) {
        log.debug(`signal subscription CLOSE room=${roomId.slice(0, 8)}`);
        subscriptionManager.close(subIdRef.current);
        subIdRef.current = null;
      }
    };
  }, [activeCall?.roomId, myPubkey]);
}
