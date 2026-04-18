import { useEffect, useRef } from "react";
import { useAppSelector } from "@/store/hooks";
import { EVENT_KINDS } from "@/types/nostr";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";

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

    // Subscribe to kind:25050 events for this room
    const subId = subscriptionManager.subscribe({
      filters: [
        {
          kinds: [EVENT_KINDS.WEBRTC_SIGNAL],
          "#r": [roomId],
          "#p": [myPubkey],
          since: Math.round(Date.now() / 1000) - 60,
        },
      ],
    });

    subIdRef.current = subId;

    return () => {
      if (subIdRef.current) {
        subscriptionManager.close(subIdRef.current);
        subIdRef.current = null;
      }
    };
  }, [activeCall?.roomId, myPubkey]);
}
