// Compact relative timestamps for feed rows ("now", "5m", "3h", "2d", then a
// short date). Nostr created_at is unix seconds.

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 604800;

export function formatRelativeTime(unixSeconds: number, nowMs = Date.now()): string {
  const delta = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  if (delta < 45) return "now";
  if (delta < HOUR) return `${Math.max(1, Math.round(delta / MINUTE))}m`;
  if (delta < DAY) return `${Math.round(delta / HOUR)}h`;
  if (delta < WEEK) return `${Math.round(delta / DAY)}d`;

  const date = new Date(unixSeconds * 1000);
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? null : { year: "numeric" }),
  });
}
