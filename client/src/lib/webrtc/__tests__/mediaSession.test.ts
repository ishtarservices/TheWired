import { describe, it, expect, vi } from "vitest";
import {
  abandonMediaSessions,
  assertMediaEpoch,
  invalidateMediaJoins,
  isMediaEpochCurrent,
  isMediaSessionAborted,
  mediaEpoch,
  MediaSessionAbortedError,
  onAbandonMediaSessions,
} from "../mediaSession";

describe("media session epoch", () => {
  it("a captured epoch goes stale on invalidate and on abandon", async () => {
    const a = mediaEpoch();
    expect(isMediaEpochCurrent(a)).toBe(true);
    invalidateMediaJoins();
    expect(isMediaEpochCurrent(a)).toBe(false);
    expect(() => assertMediaEpoch(a)).toThrow(MediaSessionAbortedError);

    const b = mediaEpoch();
    await abandonMediaSessions();
    expect(isMediaEpochCurrent(b)).toBe(false);
  });

  it("invalidate leaves live sessions alone; abandon runs every teardown", async () => {
    const teardown = vi.fn();
    const off = onAbandonMediaSessions(teardown);
    invalidateMediaJoins();
    expect(teardown).not.toHaveBeenCalled();
    await abandonMediaSessions();
    expect(teardown).toHaveBeenCalledTimes(1);
    off();
    await abandonMediaSessions();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("abandon never rejects, and a failing teardown doesn't stop the others", async () => {
    const ok = vi.fn();
    const offs = [
      onAbandonMediaSessions(() => {
        throw new Error("sync boom");
      }),
      onAbandonMediaSessions(async () => {
        throw new Error("async boom");
      }),
      onAbandonMediaSessions(ok),
    ];
    await expect(abandonMediaSessions()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
    offs.forEach((off) => off());
  });

  it("recognises the abort error by name (it crosses module/bundle boundaries)", () => {
    expect(isMediaSessionAborted(new MediaSessionAbortedError())).toBe(true);
    expect(isMediaSessionAborted(Object.assign(new Error("x"), { name: "MediaSessionAbortedError" }))).toBe(true);
    expect(isMediaSessionAborted(new Error("Could not connect"))).toBe(false);
    expect(isMediaSessionAborted(null)).toBe(false);
  });
});
