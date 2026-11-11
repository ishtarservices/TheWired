import { describe, it, expect } from "vitest";
import { parseDim, peekMediaDims, rememberMediaDims } from "../mediaDims";

describe("mediaDims", () => {
  it("parses imeta dim strings", () => {
    expect(parseDim("1920x1080")).toEqual({ w: 1920, h: 1080 });
    expect(parseDim(" 640 X 480 ")).toEqual({ w: 640, h: 480 });
    expect(parseDim("0x10")).toBeNull();
    expect(parseDim("wide")).toBeNull();
    expect(parseDim(undefined)).toBeNull();
  });

  it("remembers sizes by URL, ignoring the rotating media grant", () => {
    const url = "https://media.test/abc.png";
    rememberMediaDims(`${url}?tk=v1.one`, 800, 600);
    expect(peekMediaDims(url)).toEqual({ w: 800, h: 600 });
    expect(peekMediaDims(`${url}?tk=v1.two`)).toEqual({ w: 800, h: 600 });
  });

  it("ignores empty sizes", () => {
    rememberMediaDims("https://media.test/zero.png", 0, 10);
    expect(peekMediaDims("https://media.test/zero.png")).toBeUndefined();
  });
});
