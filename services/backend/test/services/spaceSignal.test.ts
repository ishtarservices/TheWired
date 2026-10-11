import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyEvent } from "nostr-tools";
import { config } from "../../src/config.js";
import {
  SPACE_CONFIG_CHANGED_KIND,
  buildSpaceSignalTemplate,
  flushSpaceSignal,
  notifySpaceChanged,
  resetSpaceSignalForTests,
  setSpaceSignalPublisherForTests,
  type SpaceSignalEvent,
} from "../../src/services/spaceSignalService.js";

/** A throwaway ingest key — the service signs with whatever config holds. */
const TEST_KEY = "7".repeat(64);

describe("spaceSignalService", () => {
  let published: SpaceSignalEvent[];
  let restore: () => void;
  let savedKey: string;

  beforeEach(() => {
    published = [];
    restore = setSpaceSignalPublisherForTests(async (event) => {
      published.push(event);
    });
    savedKey = config.ingestSecretKey;
    config.ingestSecretKey = TEST_KEY;
    resetSpaceSignalForTests();
  });

  afterEach(() => {
    restore();
    config.ingestSecretKey = savedKey;
    resetSpaceSignalForTests();
  });

  it("builds a d-tagged (never h-tagged) kind 20900 with one what-tag per change, in vocabulary order", () => {
    const t = buildSpaceSignalTemplate("sp1", ["roles", "meta", "roles"], 1000);
    expect(t.kind).toBe(SPACE_CONFIG_CHANGED_KIND);
    expect(t.created_at).toBe(1000);
    expect(t.content).toBe("");
    expect(t.tags[0]).toEqual(["d", "sp1"]);
    expect(t.tags.filter((x) => x[0] === "what")).toEqual([["what", "meta"], ["what", "roles"]]);
    expect(t.tags.some((x) => x[0] === "h")).toBe(false);
  });

  it("coalesces a burst into one signed event carrying the union of changes", async () => {
    notifySpaceChanged("sp1", "channels");
    notifySpaceChanged("sp1", ["roles", "channels"]);
    notifySpaceChanged("sp1", "members");
    expect(published).toHaveLength(0);
    await flushSpaceSignal("sp1");
    expect(published).toHaveLength(1);
    const ev = published[0];
    expect(verifyEvent(ev)).toBe(true);
    expect(ev.kind).toBe(SPACE_CONFIG_CHANGED_KIND);
    expect(ev.tags.filter((x) => x[0] === "what").map((x) => x[1])).toEqual(["channels", "roles", "members"]);
    // A second flush has nothing queued.
    await flushSpaceSignal("sp1");
    expect(published).toHaveLength(1);
  });

  it("is a silent no-op without an ingest key", async () => {
    config.ingestSecretKey = "";
    notifySpaceChanged("sp2", "meta");
    await flushSpaceSignal("sp2");
    expect(published).toHaveLength(0);
  });

  it("never lets a publisher failure throw at the caller", async () => {
    restore();
    restore = setSpaceSignalPublisherForTests(async () => {
      throw new Error("relay down");
    });
    notifySpaceChanged("sp3", "meta");
    await expect(flushSpaceSignal("sp3")).resolves.toBeUndefined();
  });
});
