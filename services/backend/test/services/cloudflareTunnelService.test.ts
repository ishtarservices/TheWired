import { describe, it, expect, vi } from "vitest";
import { cloudflareTunnelService } from "../../src/services/cloudflareTunnelService.js";

/**
 * Pure-guard tests for named-tunnel provisioning (Decentralized Spaces, M7).
 * These cover the paths that short-circuit before any Cloudflare API call or DB
 * write, so they need neither network nor Postgres.
 */
describe("cloudflareTunnelService", () => {
  function validSecret(): string {
    return Buffer.alloc(32, 7).toString("base64");
  }

  it("derives a stable, distinct subdomain per pubkey", () => {
    const a = cloudflareTunnelService.deriveSubdomain("a".repeat(64));
    const b = cloudflareTunnelService.deriveSubdomain("b".repeat(64));
    expect(a).toMatch(/^[0-9a-f]{20}$/);
    expect(a).not.toBe(b);
    // Deterministic: same input → same label across calls.
    expect(cloudflareTunnelService.deriveSubdomain("a".repeat(64))).toBe(a);
  });

  it("reports not-configured when Cloudflare env is unset (test env)", () => {
    expect(cloudflareTunnelService.configured()).toBe(false);
  });

  it("returns TUNNEL_NOT_CONFIGURED without touching network/DB when unconfigured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await cloudflareTunnelService.provision("a".repeat(64), validSecret());
    expect(res).toMatchObject({ ok: false, code: "TUNNEL_NOT_CONFIGURED", status: 503 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects a malformed connector secret with 400 (no provisioning)", async () => {
    const configuredSpy = vi.spyOn(cloudflareTunnelService, "configured").mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await cloudflareTunnelService.provision("a".repeat(64), "not-base64-32-bytes!!");
    expect(res).toMatchObject({ ok: false, code: "INVALID_TUNNEL_SECRET", status: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
    configuredSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("accepts a base64 32-byte secret as valid (passes the secret guard)", async () => {
    // configured() true + valid secret → it proceeds past the guards to the CF
    // call, which we stub to fail fast so no real network happens.
    const configuredSpy = vi.spyOn(cloudflareTunnelService, "configured").mockReturnValue(true);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled in test"));
    const res = await cloudflareTunnelService.provision("a".repeat(64), validSecret());
    // The valid secret got past validation; failure is the stubbed CF error.
    expect(res).toMatchObject({ ok: false, code: "CLOUDFLARE_ERROR", status: 502 });
    expect(fetchSpy).toHaveBeenCalled();
    configuredSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});
