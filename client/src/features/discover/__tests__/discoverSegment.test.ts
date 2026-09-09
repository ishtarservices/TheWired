import { describe, it, expect, beforeEach } from "vitest";
import {
  SEGMENT_STORAGE_KEY,
  parseSegment,
  readStoredSegment,
  resolveInitialSegment,
  storeSegment,
} from "../discoverSegment";

describe("discoverSegment", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("accepts only the three live segments", () => {
    expect(parseSegment("spaces")).toBe("spaces");
    expect(parseSegment("music")).toBe("music");
    expect(parseSegment("people")).toBe("people");
    expect(parseSegment("relays")).toBeNull(); // retired tab
    expect(parseSegment("garbage")).toBeNull();
    expect(parseSegment(null)).toBeNull();
  });

  it("defaults to spaces when nothing is stored and no route param is given", () => {
    expect(resolveInitialSegment(null)).toBe("spaces");
  });

  it("remembers the last segment across mounts", () => {
    storeSegment("people");
    expect(readStoredSegment()).toBe("people");
    expect(resolveInitialSegment(null)).toBe("people");
  });

  it("lets a route param win over storage", () => {
    storeSegment("people");
    expect(resolveInitialSegment("music")).toBe("music");
  });

  it("falls back past a legacy stored value", () => {
    localStorage.setItem(SEGMENT_STORAGE_KEY, "relays");
    expect(resolveInitialSegment(null)).toBe("spaces");
  });
});
