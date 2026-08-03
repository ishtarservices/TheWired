import { describe, it, expect } from "vitest";
import { EVENT_KINDS } from "@ishtarservices/shared-types";
import {
  ALL_TABS,
  DEFAULT_PROFILE_SETTINGS,
  D_TAG,
  parseProfileSettings,
  buildProfileSettingsEvent,
  type ProfileSettings,
} from "../profileSettings";

const PK = "a".repeat(64);

describe("parseProfileSettings", () => {
  it("round-trips a built event's content", () => {
    const settings: ProfileSettings = { visibleTabs: ["notes", "music", "showcase"] };
    const ev = buildProfileSettingsEvent(PK, settings);
    expect(parseProfileSettings(ev.content)).toEqual(settings);
  });

  it("filters visibleTabs to the known tab set (drops unknowns)", () => {
    const parsed = parseProfileSettings(
      JSON.stringify({ visibleTabs: ["notes", "bogus", "media", 7] }),
    );
    expect(parsed.visibleTabs).toEqual(["notes", "media"]);
  });

  it("falls back to defaults when visibleTabs is missing or malformed", () => {
    expect(parseProfileSettings("{}").visibleTabs).toEqual(
      DEFAULT_PROFILE_SETTINGS.visibleTabs,
    );
    expect(parseProfileSettings("not json").visibleTabs).toEqual(
      DEFAULT_PROFILE_SETTINGS.visibleTabs,
    );
    expect(
      parseProfileSettings(JSON.stringify({ visibleTabs: "notes" })).visibleTabs,
    ).toEqual(DEFAULT_PROFILE_SETTINGS.visibleTabs);
  });

  it("ignores legacy follower/following hide-flags on old events", () => {
    const legacy = JSON.stringify({
      hideFollowerCount: true,
      hideFollowingCount: true,
      hideFollowerList: true,
      hideFollowingList: true,
      visibleTabs: ["notes", "replies"],
    });
    const parsed = parseProfileSettings(legacy);
    expect(parsed).toEqual({ visibleTabs: ["notes", "replies"] });
    expect("hideFollowerCount" in (parsed as unknown as Record<string, unknown>)).toBe(false);
  });

  it("accepts an empty visibleTabs array verbatim (the ≥1 rule is UI-level)", () => {
    expect(parseProfileSettings(JSON.stringify({ visibleTabs: [] })).visibleTabs).toEqual([]);
  });
});

describe("buildProfileSettingsEvent", () => {
  it("builds a kind:30078 addressable event with the profile-settings d-tag", () => {
    const ev = buildProfileSettingsEvent(PK, { visibleTabs: ["notes"] });
    expect(ev.kind).toBe(EVENT_KINDS.APP_SPECIFIC_DATA);
    expect(ev.pubkey).toBe(PK);
    expect(ev.tags).toEqual([["d", D_TAG]]);
    expect(JSON.parse(ev.content)).toEqual({ visibleTabs: ["notes"] });
  });
});

describe("ALL_TABS / defaults", () => {
  it("defaults hide music + showcase", () => {
    expect(DEFAULT_PROFILE_SETTINGS.visibleTabs).not.toContain("music");
    expect(DEFAULT_PROFILE_SETTINGS.visibleTabs).not.toContain("showcase");
  });

  it("covers all seven sections", () => {
    expect(ALL_TABS).toEqual([
      "notes",
      "reposts",
      "replies",
      "media",
      "reads",
      "music",
      "showcase",
    ]);
  });
});
