/**
 * Call timer semantics.
 *
 * pre-fix: `startedAt` was stamped when the invite went out, and both the
 * on-screen timer and the history `duration` counted from it — a call that
 * rang for 25s showed 0:25 the moment it connected.
 * post-fix: `connectedAt` is stamped on the first transition to "active";
 * duration measures from it, and a never-connected call has duration 0.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { callSlice, startOutgoingCall, setCallState, endCall } from "../callSlice";

const reducer = callSlice.reducer;
const initial = () => reducer(undefined, { type: "@@INIT" });

const outgoing = () =>
  reducer(
    initial(),
    startOutgoingCall({
      partnerPubkey: "a".repeat(64),
      callType: "audio",
      roomId: "room",
      roomSecretKey: "01".repeat(32),
    }),
  );

afterEach(() => {
  vi.useRealTimers();
});

describe("callSlice connectedAt", () => {
  it("is unset while ringing/connecting", () => {
    let s = outgoing();
    expect(s.activeCall?.connectedAt).toBeUndefined();
    s = reducer(s, setCallState("connecting"));
    expect(s.activeCall?.connectedAt).toBeUndefined();
  });

  it("is stamped once on the first 'active' transition", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    let s = reducer(outgoing(), setCallState("active"));
    expect(s.activeCall?.connectedAt).toBe(1_000_000);

    vi.setSystemTime(1_005_000);
    s = reducer(s, setCallState("active"));
    expect(s.activeCall?.connectedAt).toBe(1_000_000);
  });

  it("history duration counts from connectedAt, not from the invite", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    let s = outgoing(); // startedAt = 1_000_000
    vi.setSystemTime(1_025_000); // rang for 25s
    s = reducer(s, setCallState("active"));
    vi.setSystemTime(1_085_000); // talked for 60s
    s = reducer(s, endCall("completed"));
    expect(s.callHistory[0].duration).toBe(60_000);
    expect(s.callHistory[0].startedAt).toBe(1_000_000);
  });

  it("a call that never connected has duration 0", () => {
    const s = reducer(outgoing(), endCall("missed"));
    expect(s.callHistory[0].duration).toBe(0);
    expect(s.callHistory[0].outcome).toBe("missed");
  });
});
