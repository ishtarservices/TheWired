import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { setZapTotal } from "../../store/slices/walletSlice";
import { fetchZapTotals } from "../../lib/lightning/zap";
import { relayManager } from "../../lib/nostr/relayManager";

/**
 * Subscribe to kind:9735 zap receipts for an event and expose the running total.
 * Use sparingly (each call opens a relay subscription) — bounded single-item views.
 */
export function useZapTotals(eventId: string | undefined): {
  msat: number;
  count: number;
} {
  const dispatch = useAppDispatch();
  const total = useAppSelector((s) =>
    eventId ? s.wallet.zapTotals[eventId] : undefined,
  );

  useEffect(() => {
    if (!eventId) return;
    const subId = fetchZapTotals(eventId, [], (t) => {
      dispatch(setZapTotal({ eventId, msat: t.msat, count: t.count }));
    });
    return () => {
      relayManager.closeSubscription(subId);
    };
  }, [eventId, dispatch]);

  return total ?? { msat: 0, count: 0 };
}
