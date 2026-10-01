/**
 * Report intake normalisation (pure). The fixtures below are built in the
 * kind-1984 layout the soot mobile client publishes (documented in
 * `src/lib/reports/reportInput.ts`), so a drift on either side fails here.
 */
import { describe, it, expect } from "vitest";
import {
  capNote,
  normalizeCategory,
  normalizeTarget,
  parseReportEvent,
  REPORT_NOTE_MAX,
} from "../../src/lib/reports/reportInput.js";

const REPORTER = "a".repeat(64);
const TARGET = "b".repeat(64);
const EVENT_ID = "c".repeat(64);
const WRAP_ID = "d".repeat(64);

function report(tags: string[][], content = "", pubkey = REPORTER) {
  return { id: "e".repeat(64), pubkey, kind: 1984, tags, content };
}

/** soot's labels for a category + target kind. */
function labels(category: string, target: string): string[][] {
  return [
    ["L", "app.soot.report"],
    ["l", category, "app.soot.report"],
    ["L", "app.soot.report.target"],
    ["l", target, "app.soot.report.target"],
    ["alt", `report: ${category}`],
  ];
}

describe("parseReportEvent — soot's layout", () => {
  it("files an event report, triaging on the l category not the NIP-56 type", () => {
    // harassment travels as NIP-56 "other"
    const r = parseReportEvent(
      report(
        [["p", TARGET, "other"], ["e", EVENT_ID, "other"], ["k", "1"], ...labels("harassment", "event")],
        "  keeps doing it  ",
      ),
    );
    expect(r).toMatchObject({
      source: "nostr",
      reporterPubkey: REPORTER,
      reporterIpHash: null,
      targetType: "event",
      targetEventId: EVENT_ID,
      targetPubkey: TARGET,
      targetKind: 1,
      category: "harassment",
      note: "keeps doing it",
      reportEventId: "e".repeat(64),
    });
  });

  it("files a track by its coordinate and calls it a track", () => {
    const coord = `31683:${TARGET}:my-song`;
    const r = parseReportEvent(
      report([
        ["p", TARGET, "other"],
        ["e", EVENT_ID, "other"],
        ["a", coord, "other"],
        ["k", "31683"],
        ...labels("copyright", "event"),
      ]),
    );
    expect(r).toMatchObject({ targetType: "track", targetCoordinate: coord, category: "copyright", targetKind: 31683 });
    const album = parseReportEvent(
      report([["e", EVENT_ID, "spam"], ["a", `33123:${TARGET}:lp`, "spam"], ["k", "33123"], ...labels("spam", "event")]),
    );
    expect(album?.targetType).toBe("album");
    // The coordinate names the author even without a p tag.
    expect(album?.targetPubkey).toBe(TARGET);
  });

  it("files a DM report by wrap id only (no e tag, no content of the message)", () => {
    const r = parseReportEvent(report([["p", TARGET, "other"], ["wrap", WRAP_ID], ...labels("harassment", "dm")]));
    expect(r).toMatchObject({ targetType: "dm", targetEventId: WRAP_ID, targetPubkey: TARGET, targetKind: 1059 });
  });

  it("files user and voice reports", () => {
    expect(parseReportEvent(report([["p", TARGET, "impersonation"], ...labels("impersonation", "user")]))).toMatchObject({
      targetType: "user",
      targetPubkey: TARGET,
      category: "impersonation",
    });
    const voice = parseReportEvent(
      report([["p", TARGET, "other"], ["room", "dm:room-1"], ["space", "space-9"], ...labels("harassment", "voice")]),
    );
    expect(voice).toMatchObject({ targetType: "voice", targetContext: { roomId: "dm:room-1", spaceId: "space-9" } });
  });

  it("accepts a plain NIP-56 report from another client, category from the type", () => {
    expect(parseReportEvent(report([["e", EVENT_ID, "nudity"], ["p", TARGET]]))).toMatchObject({
      targetType: "event",
      category: "nudity",
    });
    expect(parseReportEvent(report([["p", TARGET, "profanity"]]))).toMatchObject({
      targetType: "user",
      category: "harassment",
    });
  });

  it("drops reports that identify nothing, self-reports, and other kinds", () => {
    expect(parseReportEvent(report([...labels("spam", "event")]))).toBeNull();
    expect(parseReportEvent(report([["e", "not-hex", "spam"]]))).toBeNull();
    expect(parseReportEvent(report([["p", REPORTER, "spam"], ...labels("spam", "user")]))).toBeNull();
    expect(parseReportEvent({ ...report([["p", TARGET, "spam"]]), kind: 1 })).toBeNull();
  });

  it("caps the note and treats unknown categories as other", () => {
    const long = "x".repeat(REPORT_NOTE_MAX + 50);
    expect(parseReportEvent(report([["p", TARGET, "spam"], ...labels("spam", "user")], long))?.note).toHaveLength(
      REPORT_NOTE_MAX,
    );
    expect(normalizeCategory("Spam")).toBe("spam");
    expect(normalizeCategory("weird")).toBe("other");
    expect(capNote("   ")).toBeNull();
  });
});

describe("normalizeTarget — the HTTP door", () => {
  it("requires the ids each target type needs", () => {
    expect(normalizeTarget({ target: "event", category: "spam" })).toBeNull();
    expect(normalizeTarget({ target: "user", category: "spam", pubkey: "short" })).toBeNull();
    expect(normalizeTarget({ target: "dm", category: "spam", pubkey: TARGET })).toBeNull();
    expect(normalizeTarget({ target: "voice", category: "spam" })).toBeNull();
    expect(normalizeTarget({ target: "track", category: "spam", coordinate: `1:${TARGET}:x` })).toBeNull();
    expect(normalizeTarget({ target: "nonsense", category: "spam", pubkey: TARGET })).toBeNull();
  });

  it("classifies a music event and keeps only ids", () => {
    expect(normalizeTarget({ target: "event", category: "copyright", eventId: EVENT_ID, eventKind: 31683 })).toMatchObject({
      targetType: "track",
      targetEventId: EVENT_ID,
    });
    expect(
      normalizeTarget({ target: "album", category: "spam", coordinate: `33123:${TARGET}:lp` }),
    ).toMatchObject({ targetType: "album", targetPubkey: TARGET, targetKind: 33123 });
  });
});
