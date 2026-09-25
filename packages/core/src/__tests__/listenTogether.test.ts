import { describe, it, expect } from "vitest";
import { LT_MAX_QUEUE } from "@ishtarservices/shared-types";
import { parseLt, capLtQueue, ltAnchorTime } from "../listenTogether";

const PK = "b".repeat(64);
const T = (d: string) => `31683:${PK}:${d}`;
const meta = { title: "t", artist: "a", variants: [{ url: "https://x.example/a.mp3", mimeType: "audio/mpeg" }] };

describe("parseLt", () => {
  it("rebuilds a valid lt:play, shedding unknown keys", () => {
    const env = parseLt({
      type: "lt:play", ts: 5, dj: PK, extra: 1,
      data: { trackId: T("one"), position: 3, queue: [T("one")], queueIndex: 0, trackMeta: { ...meta, junk: true, visibility: "space" } },
    });
    expect(env).toEqual({
      type: "lt:play", ts: 5, dj: PK,
      data: { trackId: T("one"), position: 3, queue: [T("one")], queueIndex: 0, trackMeta: { ...meta, visibility: "space" } },
    });
  });

  it("drops lt:play without trackMeta or with a foreign queue entry", () => {
    expect(parseLt({ type: "lt:play", data: { trackId: T("one"), position: 0, queue: [], queueIndex: 0 } })).toBeNull();
    expect(
      parseLt({ type: "lt:play", data: { trackId: T("one"), position: 0, queue: [`30023:${PK}:x`], queueIndex: 0, trackMeta: meta } }),
    ).toBeNull();
  });

  it("drops non-finite positions and a null queue on lt:start", () => {
    expect(parseLt({ type: "lt:seek", data: { position: "12" } })).toBeNull();
    expect(
      parseLt({ type: "lt:start", data: { djPubkey: PK, trackId: null, queue: null, position: 0 } }),
    ).toBeNull();
  });

  it("filters non-http variants and image urls", () => {
    const env = parseLt({
      type: "lt:suggest",
      data: {
        trackId: T("s"),
        trackMeta: { ...meta, imageUrl: "javascript:alert(1)", variants: [...meta.variants, { url: "file:///etc/passwd", mimeType: "x" }] },
      },
    });
    expect(env?.data).toEqual({ trackId: T("s"), trackMeta: meta });
  });

  it("drops an unknown visibility but keeps the track", () => {
    const env = parseLt({ type: "lt:suggest", data: { trackId: T("s"), trackMeta: { ...meta, visibility: "unlisted" } } });
    expect(env?.data).toEqual({ trackId: T("s"), trackMeta: meta });
  });

  it("ignores foreign and unknown types", () => {
    expect(parseLt({ type: "chat", data: {} })).toBeNull();
    expect(parseLt({ type: "lt:future_thing", data: {} })).toBeNull();
    expect(parseLt("lt:play")).toBeNull();
  });
});

describe("capLtQueue", () => {
  const long = Array.from({ length: 250 }, (_, i) => T(String(i)));

  it("passes short queues through", () => {
    expect(capLtQueue([T("a")], 0)).toEqual({ queue: [T("a")], queueIndex: 0 });
  });

  it("windows a long queue from the current track", () => {
    const { queue, queueIndex } = capLtQueue(long, 120);
    expect(queue).toHaveLength(LT_MAX_QUEUE);
    expect(queue[queueIndex]).toBe(long[120]);
  });

  it("keeps the current track near the end of a long queue", () => {
    const { queue, queueIndex } = capLtQueue(long, 240);
    expect(queue).toHaveLength(LT_MAX_QUEUE);
    expect(queue[queueIndex]).toBe(long[240]);
  });
});

describe("ltAnchorTime", () => {
  it("clamps latency to 0…5 s", () => {
    const now = 1_000_000;
    expect(ltAnchorTime(now - 200, now)).toBe(now - 200);
    expect(ltAnchorTime(now - 60_000, now)).toBe(now - 5_000);
    expect(ltAnchorTime(now + 60_000, now)).toBe(now);
    expect(ltAnchorTime(Number.NaN, now)).toBe(now);
  });
});
