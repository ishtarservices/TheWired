import { useEffect, useState } from "react";

function formatRemaining(seconds: number): string {
  if (seconds >= 86400) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${seconds}s`;
}

/** Live countdown for a poll's endsAt. Ticks every second inside the final
 *  minute, every 30s otherwise; stops once ended. */
export function usePollCountdown(endsAt?: number): {
  ended: boolean;
  /** "Ends in 2h 10m" / "Ended" — null when the poll has no end time */
  label: string | null;
} {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const remaining = endsAt !== undefined ? endsAt - now : undefined;
  const ended = remaining !== undefined && remaining <= 0;
  const finalMinute = remaining !== undefined && remaining > 0 && remaining <= 60;

  useEffect(() => {
    if (endsAt === undefined || ended) return;
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      finalMinute ? 1000 : 30_000,
    );
    return () => clearInterval(timer);
  }, [endsAt, ended, finalMinute]);

  if (remaining === undefined) return { ended: false, label: null };
  if (ended) return { ended: true, label: "Ended" };
  return { ended: false, label: `Ends in ${formatRemaining(remaining)}` };
}
