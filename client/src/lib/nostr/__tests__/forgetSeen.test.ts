import { describe, it, expect, vi } from "vitest";
import { forgetSeenEvents, registerForgetSeen } from "../forgetSeen";

describe("forgetSeen registry", () => {
  it("hands the ids to whatever the pipeline registered", () => {
    const fn = vi.fn();
    registerForgetSeen(fn);
    forgetSeenEvents(["a", "b"]);
    expect(fn).toHaveBeenCalledWith(["a", "b"]);
  });

  it("does nothing for an empty list", () => {
    const fn = vi.fn();
    registerForgetSeen(fn);
    forgetSeenEvents([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
