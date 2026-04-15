import { describe, it, expect } from "vitest";
import type { SpaceChannel, ChannelFeedMode } from "@/types/space";

// ─── Normalization function (mirrors useSpaceChannels.ts) ──

function normalizeChannels(channels: any[]): SpaceChannel[] {
  return channels.map((ch) => ch.feedMode ? ch : { ...ch, feedMode: "all" as ChannelFeedMode });
}

// ─── Tests ──────────────────────────────────────────

describe("channel normalization (backward compatibility)", () => {
  it("adds feedMode='all' to channels missing it", () => {
    const raw = [
      { id: "ch-1", spaceId: "s", type: "music", label: "#music", position: 0, isDefault: false, adminOnly: false, slowModeSeconds: 0 },
    ];
    const normalized = normalizeChannels(raw);
    expect(normalized[0].feedMode).toBe("all");
  });

  it("preserves existing feedMode values", () => {
    const raw = [
      { id: "ch-1", spaceId: "s", type: "music", label: "#music", position: 0, isDefault: false, adminOnly: false, slowModeSeconds: 0, feedMode: "curated" },
    ];
    const normalized = normalizeChannels(raw);
    expect(normalized[0].feedMode).toBe("curated");
  });

  it("handles mixed channels (some with feedMode, some without)", () => {
    const raw = [
      { id: "ch-1", spaceId: "s", type: "chat", label: "#chat", position: 0, isDefault: true, adminOnly: false, slowModeSeconds: 0 },
      { id: "ch-2", spaceId: "s", type: "music", label: "#music", position: 1, isDefault: false, adminOnly: false, slowModeSeconds: 0, feedMode: "curated" },
      { id: "ch-3", spaceId: "s", type: "notes", label: "#notes", position: 2, isDefault: false, adminOnly: false, slowModeSeconds: 0 },
    ];
    const normalized = normalizeChannels(raw);
    expect(normalized[0].feedMode).toBe("all");    // chat: was missing → defaults
    expect(normalized[1].feedMode).toBe("curated"); // music: preserved
    expect(normalized[2].feedMode).toBe("all");    // notes: was missing → defaults
  });

  it("handles empty channel array", () => {
    expect(normalizeChannels([])).toEqual([]);
  });

  it("does not mutate the original objects", () => {
    const original = { id: "ch-1", spaceId: "s", type: "music", label: "#m", position: 0, isDefault: false, adminOnly: false, slowModeSeconds: 0 };
    const normalized = normalizeChannels([original]);
    expect(original).not.toHaveProperty("feedMode");
    expect(normalized[0].feedMode).toBe("all");
  });
});
