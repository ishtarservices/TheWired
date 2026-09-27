import { describe, it, expect, beforeEach, vi } from "vitest";
import { deliverMediaKey, registerMediaKeyReceiver, resetMediaKeyInbox } from "../mediaKeyInbox";

const A = "a".repeat(64);
const env = { v: 1 as const, room: "r", keys: [{ idx: 0, key: "00".repeat(32) }], ts: 1 };

beforeEach(() => resetMediaKeyInbox());

describe("media key inbox", () => {
  it("delivers to the registered receiver once per wrap id", () => {
    const rx = vi.fn();
    registerMediaKeyReceiver(rx);
    expect(deliverMediaKey(A, env, "w1")).toBe(true);
    expect(deliverMediaKey(A, env, "w1")).toBe(false); // relay replay
    expect(deliverMediaKey(A, env, "w2")).toBe(true);
    expect(rx).toHaveBeenCalledTimes(2);
    expect(rx).toHaveBeenCalledWith(A, env);
  });

  it("does not consume an envelope nobody was listening for — a later session still gets the replay", () => {
    expect(deliverMediaKey(A, env, "w1")).toBe(false);
    const rx = vi.fn();
    registerMediaKeyReceiver(rx);
    expect(deliverMediaKey(A, env, "w1")).toBe(true);
    expect(rx).toHaveBeenCalledTimes(1);
  });

  it("the uninstaller only removes its own receiver", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registerMediaKeyReceiver(first);
    registerMediaKeyReceiver(second);
    offFirst();
    deliverMediaKey(A, env, "w9");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
