import { discoveryService } from "../services/discoveryService.js";

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function startDiscoveryScoreComputer(): { stop: () => void } {
  async function compute() {
    try {
      // Zap rollup FIRST — computeDiscoveryScores reads zap_count_24h /
      // zap_sats_24h, so running it after would score against a stale window.
      const rollup = await discoveryService.rollupSpaceZaps();
      if (rollup.receipts > 0) {
        console.log(
          `[discoveryScoreComputer] Zap rollup: ${rollup.receipts} receipts → ${rollup.spaces} spaces`,
        );
      }
      await discoveryService.computeDiscoveryScores();
      await discoveryService.autoDelistInactive();
    } catch (err) {
      console.error("[discoveryScoreComputer] Error:", err);
    }
  }

  // Run once at startup, then on interval
  compute();
  const interval = setInterval(compute, INTERVAL_MS);

  console.log("[discoveryScoreComputer] Started (every 15 min)");

  return {
    stop: () => {
      clearInterval(interval);
      console.log("[discoveryScoreComputer] Stopped");
    },
  };
}
