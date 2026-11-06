/**
 * The foreign-report rule and its URL matcher, pure (no DB): which footprint
 * keeps a relay-sourced report in the queue, which doors are never foreign,
 * and how relay URLs in a kind 10002 / 10050 are compared to ours.
 */
import { describe, it, expect } from "vitest";
import {
  classifyReportOrigin,
  listNamesRelay,
  relayUrlKey,
  LOOKUP_FAILED_VERDICT,
  type ReportFootprint,
} from "../../src/lib/reports/foreignReport.js";
import type { ReportInput } from "../../src/lib/reports/reportInput.js";

const NONE: ReportFootprint = {
  reporterIsAppUser: false,
  targetIsAppUser: false,
  targetEventHere: false,
  targetHasContentHere: false,
};

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    source: "nostr",
    reporterPubkey: "a".repeat(64),
    reporterIpHash: null,
    targetType: "event",
    targetEventId: "e".repeat(64),
    targetCoordinate: null,
    targetPubkey: "b".repeat(64),
    targetKind: 1,
    targetContext: null,
    category: "spam",
    note: null,
    reportEventId: "f".repeat(64),
    ...over,
  };
}

describe("classifyReportOrigin", () => {
  it("is foreign only when nothing ties either side to this platform", () => {
    const v = classifyReportOrigin(input(), NONE);
    expect(v.origin).toBe("foreign");
    expect(v.signals).toEqual([
      "reporter_not_app_user",
      "target_not_app_user",
      "target_event_absent",
      "target_content_absent",
    ]);
  });

  it.each([
    ["reporterIsAppUser", "reporter_app_user"],
    ["targetIsAppUser", "target_app_user"],
    ["targetEventHere", "target_event_here"],
    ["targetHasContentHere", "target_content_here"],
  ] as const)("stays local on %s alone", (flag, signal) => {
    const v = classifyReportOrigin(input(), { ...NONE, [flag]: true });
    expect(v).toEqual({ origin: "local", signals: [signal] });
  });

  it("lists every signal that kept it when several hold", () => {
    const v = classifyReportOrigin(input(), { ...NONE, reporterIsAppUser: true, targetHasContentHere: true });
    expect(v.signals).toEqual(["reporter_app_user", "target_content_here"]);
  });

  it("never marks an HTTP report foreign, whatever the footprint", () => {
    expect(classifyReportOrigin(input({ source: "http", reporterPubkey: null }), NONE)).toEqual({
      origin: "local",
      signals: ["http_source"],
    });
  });

  it.each(["dm", "voice"] as const)("never marks a %s report foreign (only the apps file them)", (targetType) => {
    const v = classifyReportOrigin(
      input({ targetType, targetEventId: targetType === "dm" ? "9".repeat(64) : null, targetPubkey: null }),
      NONE,
    );
    expect(v).toEqual({ origin: "local", signals: ["platform_target_type"] });
  });

  it.each(["user", "track", "album"] as const)("judges a %s report by footprint like an event report", (targetType) => {
    expect(classifyReportOrigin(input({ targetType, targetEventId: null }), NONE).origin).toBe("foreign");
    expect(classifyReportOrigin(input({ targetType, targetEventId: null }), { ...NONE, targetIsAppUser: true }).origin).toBe(
      "local",
    );
  });

  it("fails open: a failed lookup is a local verdict with its own signal", () => {
    expect(LOOKUP_FAILED_VERDICT).toEqual({ origin: "local", signals: ["lookup_failed"] });
  });
});

describe("relayUrlKey", () => {
  it.each([
    ["wss://relay.thewired.app", "relay.thewired.app"],
    ["ws://relay.thewired.app", "relay.thewired.app"],
    ["WSS://Relay.TheWired.app/", "relay.thewired.app"],
    ["wss://relay.thewired.app:443", "relay.thewired.app"],
    ["ws://relay.thewired.app:80/", "relay.thewired.app"],
    ["  wss://relay.thewired.app///  ", "relay.thewired.app"],
    ["https://relay.thewired.app", "relay.thewired.app"],
    ["ws://localhost:7777", "localhost:7777"],
    ["ws://127.0.0.1:7777/", "127.0.0.1:7777"],
    ["wss://relay.thewired.app:8443", "relay.thewired.app:8443"],
    ["wss://relay.thewired.app/nostr/", "relay.thewired.app/nostr"],
  ])("normalizes %s", (raw, key) => {
    expect(relayUrlKey(raw)).toBe(key);
  });

  it.each([
    "",
    "relay.thewired.app",
    "ftp://relay.thewired.app",
    "wss://user:pw@relay.thewired.app",
    "wss://relay.thewired.app/?x=1",
    "wss://relay.thewired.app/#frag",
    "wss://",
    "not a url",
    "wss://relay.thewired.app:notaport",
    "x".repeat(600),
  ])("refuses %j", (raw) => {
    expect(relayUrlKey(raw)).toBeNull();
  });

  it("keeps lookalike hosts apart", () => {
    const ours = relayUrlKey("wss://relay.thewired.app")!;
    for (const other of [
      "wss://relay.thewired.app.evil.example",
      "wss://evil.example/relay.thewired.app",
      "wss://relaythewired.app",
      "wss://xn--relay.thewired.app",
      "wss://thewired.app",
    ]) {
      expect(relayUrlKey(other)).not.toBe(ours);
    }
  });

  it("does not throw on non-string input", () => {
    expect(relayUrlKey(undefined as unknown as string)).toBeNull();
    expect(relayUrlKey(42 as unknown as string)).toBeNull();
  });
});

describe("listNamesRelay", () => {
  const own = new Set([relayUrlKey("wss://relay.thewired.app")!, relayUrlKey("ws://127.0.0.1:7777")!]);

  it("matches a kind 10050 `relay` tag and a kind 10002 `r` tag, in any spelling", () => {
    expect(listNamesRelay([["relay", "wss://relay.damus.io"], ["relay", "WS://RELAY.THEWIRED.APP/"]], own)).toBe(true);
    expect(listNamesRelay([["r", "wss://nos.lol", "read"], ["r", "wss://relay.thewired.app:443", "write"]], own)).toBe(true);
    expect(listNamesRelay([["r", "ws://127.0.0.1:7777"]], own)).toBe(true);
  });

  it("ignores other tags, bad entries and lists that name other relays", () => {
    expect(listNamesRelay([["p", "wss://relay.thewired.app"]], own)).toBe(false);
    expect(listNamesRelay([["relay"], ["r"], ["relay", ""], ["relay", "wss://"]], own)).toBe(false);
    expect(listNamesRelay([["relay", "wss://relay.damus.io"], ["relay", "wss://nos.lol"]], own)).toBe(false);
    expect(listNamesRelay([["relay", "wss://relay.thewired.app.evil.example"]], own)).toBe(false);
  });

  it("survives malformed tag arrays and an empty own set", () => {
    expect(listNamesRelay(null as unknown as string[][], own)).toBe(false);
    expect(listNamesRelay([null as unknown as string[], 7 as unknown as string[]], own)).toBe(false);
    expect(listNamesRelay([["relay", "wss://relay.thewired.app"]], new Set())).toBe(false);
  });

  it("is bounded by the tag count, not by tag size (thousands of relays, one match)", () => {
    const tags = Array.from({ length: 5000 }, (_, i) => ["relay", `wss://r${i}.example`]);
    tags.push(["relay", "wss://relay.thewired.app"]);
    expect(listNamesRelay(tags, own)).toBe(true);
  });
});
