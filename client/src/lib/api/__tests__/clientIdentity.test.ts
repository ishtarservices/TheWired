import { describe, it, expect } from "vitest";
import { detectPlatform, wiredClientHeaderValue } from "../clientIdentity";

describe("X-Wired-Client value", () => {
  it("maps user agents to a platform token", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15")).toBe("macos");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectPlatform("")).toBe("unknown");
  });

  it("formats as desktop/<version> (<platform>), matching the backend grammar", () => {
    const value = wiredClientHeaderValue();
    expect(value).toMatch(/^desktop\/0\.0\.0-test \((macos|windows|linux|unknown)\)$/);
  });
});
