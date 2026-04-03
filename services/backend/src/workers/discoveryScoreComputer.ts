import { discoveryService } from "../services/discoveryService.js";

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function startDiscoveryScoreComputer(): { stop: () => void } {
  async function compute() {
    try {
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
