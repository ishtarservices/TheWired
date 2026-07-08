import { buildChatRows, dayLabel, GROUP_WINDOW_SEC } from "../chatRows";
import type { NostrEvent } from "@thewired/shared-types";

// Fixed clock: 2026-07-07 12:00 local.
const NOW = new Date(2026, 6, 7, 12, 0, 0).getTime();
const at = (offsetSec: number) => Math.floor(NOW / 1000) + offsetSec;

const msg = (id: string, pubkey: string, created_at: number): NostrEvent => ({
  id,
  pubkey,
  created_at,
  kind: 9,
  tags: [],
  content: id,
  sig: "",
});

describe("dayLabel", () => {
  it("labels today/yesterday/dates", () => {
    expect(dayLabel(at(-60), NOW)).toBe("Today");
    expect(dayLabel(at(-86_400), NOW)).toBe("Yesterday");
    expect(dayLabel(at(-3 * 86_400), NOW)).not.toMatch(/Today|Yesterday/);
  });
});

describe("buildChatRows", () => {
  it("inserts a day separator before each day's first message", () => {
    const rows = buildChatRows(
      [msg("a", "p1", at(-86_400)), msg("b", "p1", at(-60))],
      NOW,
    );
    expect(rows.map((r) => r.kind)).toEqual(["day", "message", "day", "message"]);
  });

  it("groups consecutive same-author messages inside the window", () => {
    const rows = buildChatRows(
      [
        msg("a", "p1", at(-300)),
        msg("b", "p1", at(-290)),
        msg("c", "p2", at(-280)),
        msg("d", "p2", at(-280 + GROUP_WINDOW_SEC)),
      ],
      NOW,
    );
    const messages = rows.filter((r) => r.kind === "message");
    expect(messages.map((m) => m.kind === "message" && m.grouped)).toEqual([
      false, // a — first
      true, // b — same author, 10s later
      false, // c — author change
      false, // d — same author but outside the window
    ]);
  });

  it("never groups across a day boundary", () => {
    // Two messages 2 minutes apart straddling midnight — inside the group
    // window, but a new day starts.
    const midnight = Math.floor(new Date(2026, 6, 7, 0, 0, 0).getTime() / 1000);
    const rows = buildChatRows(
      [msg("a", "p1", midnight - 60), msg("b", "p1", midnight + 60)],
      NOW,
    );
    expect(rows.map((r) => r.kind)).toEqual(["day", "message", "day", "message"]);
    const messages = rows.filter((r) => r.kind === "message");
    expect(messages.every((m) => m.kind === "message" && !m.grouped)).toBe(true);
  });
});
