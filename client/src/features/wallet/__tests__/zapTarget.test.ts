import { describe, it, expect } from "vitest";
import { resolveZapTarget } from "../zapTarget";

describe("resolveZapTarget", () => {
  it("prefers lud16 and does not pass an lnurl fallback", () => {
    const t = resolveZapTarget({ lud16: "luna@wallet.com", lud06: "lnurl1xyz" });
    expect(t.canZap).toBe(true);
    expect(t.lud16).toBe("luna@wallet.com");
    expect(t.lnurl).toBeUndefined(); // never pass both — resolveZapEndpoint prefers lud16
    expect(t.display).toBe("luna@wallet.com");
  });

  it("falls back to lud06 as the lnurl when no lud16", () => {
    const t = resolveZapTarget({ lud06: "lnurl1abc" });
    expect(t.canZap).toBe(true);
    expect(t.lud16).toBeUndefined();
    expect(t.lnurl).toBe("lnurl1abc");
    expect(t.display).toBe("Lightning (LNURL)");
  });

  it("is not zappable when neither is set", () => {
    const t = resolveZapTarget({ name: "Luna" });
    expect(t.canZap).toBe(false);
    expect(t.lud16).toBeUndefined();
    expect(t.lnurl).toBeUndefined();
    expect(t.display).toBeUndefined();
  });

  it("treats empty-string lud16 as unset and falls through to lud06", () => {
    const t = resolveZapTarget({ lud16: "", lud06: "lnurl1abc" });
    expect(t.canZap).toBe(true);
    expect(t.lud16).toBeUndefined();
    expect(t.lnurl).toBe("lnurl1abc");
  });

  it("handles null/undefined profile", () => {
    expect(resolveZapTarget(null).canZap).toBe(false);
    expect(resolveZapTarget(undefined).canZap).toBe(false);
  });
});
