import { describe, it, expect } from "vitest";
import { hasReachableAudio } from "../reachableAudio";

const PROD = "https://api.thewired.app";
const DEV = "http://localhost:9080";

const track = (...urls: string[]) => ({
  variants: urls.map((url) => ({ url, mimeType: "audio/mpeg" })),
});

describe("hasReachableAudio", () => {
  it("keeps a track on a public host", () => {
    expect(hasReachableAudio(track("https://api.thewired.app/abc.mp3"), PROD)).toBe(true);
    expect(hasReachableAudio(track("https://blossom.example/abc.mp3"), PROD)).toBe(true);
  });

  it("drops a QA upload whose audio lives on a dev machine", () => {
    expect(hasReachableAudio(track("http://localhost:9080/abc"), PROD)).toBe(false);
    expect(hasReachableAudio(track("http://127.0.0.1:9080/abc"), PROD)).toBe(false);
    expect(hasReachableAudio(track("http://192.168.1.20:9080/abc"), PROD)).toBe(false);
    expect(hasReachableAudio(track("http://studio.local/abc"), PROD)).toBe(false);
  });

  it("keeps a dev build's own local uploads", () => {
    expect(hasReachableAudio(track("http://localhost:9080/abc"), DEV)).toBe(true);
  });

  it("keeps a track when any variant is reachable", () => {
    expect(
      hasReachableAudio(track("http://localhost:9080/abc", "https://api.thewired.app/abc.m3u8"), PROD),
    ).toBe(true);
  });

  it("drops a track whose only url is malformed", () => {
    expect(hasReachableAudio(track("not a url"), PROD)).toBe(false);
  });

  it("leaves variant-less tracks to other checks", () => {
    expect(hasReachableAudio(track(), PROD)).toBe(true);
  });
});
