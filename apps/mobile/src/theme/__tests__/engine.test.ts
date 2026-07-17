import { deriveTokens, isDarkTheme, parseHSL, toCSS, withAlpha } from "../engine";

describe("parseHSL", () => {
  it("parses raw HSL params", () => {
    expect(parseHSL("220 14% 8%")).toEqual({ h: 220, s: 14, l: 8 });
    expect(parseHSL("  340 25% 94%  ")).toEqual({ h: 340, s: 25, l: 94 });
  });

  it("defaults malformed input to zeros", () => {
    expect(parseHSL("")).toEqual({ h: 0, s: 0, l: 0 });
  });
});

describe("color emission (RN parser compatibility)", () => {
  it("emits legacy comma syntax, not CSS Color 4 space syntax", () => {
    expect(toCSS("220 14% 8%")).toBe("hsl(220, 14%, 8%)");
    expect(withAlpha("235 55% 58%", 0.5)).toBe("hsla(235, 55%, 58%, 0.5)");
  });
});

describe("isDarkTheme", () => {
  it("classifies by background lightness", () => {
    expect(isDarkTheme("220 14% 8%")).toBe(true);
    expect(isDarkTheme("220 14% 97%")).toBe(false);
  });
});

describe("deriveTokens", () => {
  // Clean Dark's core colors must reproduce the desktop @theme fallback values
  // in client/src/index.css — same derivation math as lib/themeEngine.ts.
  it("matches the desktop Clean Dark token values", () => {
    const t = deriveTokens("220 14% 8%", "220 14% 92%", "235 55% 58%");

    expect(t.background).toBe("hsl(220, 14%, 8%)");
    expect(t.panel).toBe("hsl(220, 14%, 11%)");
    expect(t.card).toBe("hsl(220, 14%, 14%)");
    expect(t.cardHover).toBe("hsl(220, 14%, 17%)");
    expect(t.field).toBe("hsl(220, 14%, 12%)");
    expect(t.popover).toBe("hsl(220, 14%, 11%)");

    expect(t.heading).toBe("hsl(220, 14%, 92%)");
    expect(t.body).toBe("hsl(220, 14%, 79.4%)");
    expect(t.soft).toBe("hsl(220, 14%, 66.8%)");
    expect(t.muted).toBe("hsl(220, 14%, 50%)");
    expect(t.faint).toBe("hsl(220, 14%, 37.4%)");

    expect(t.primary).toBe("hsl(235, 55%, 58%)");
    expect(t.primarySoft).toBe("hsl(235, 55%, 68%)");
    expect(t.primaryDim).toBe("hsla(235, 55%, 58%, 0.15)");
    expect(t.border).toBe("hsl(220, 14%, 20.6%)");
    expect(t.borderLight).toBe("hsl(220, 14%, 16.4%)");
  });

  it("derives away from the background in the right direction for light themes", () => {
    const t = deriveTokens("220 14% 97%", "220 14% 10%", "235 55% 52%");
    expect(t.panel).toBe("hsl(220, 14%, 94%)"); // darker, not lighter
    expect(t.card).toBe("hsl(220, 14%, 91%)");
  });

  it("flips primary foreground for light primaries", () => {
    const dark = deriveTokens("220 14% 8%", "220 14% 92%", "235 55% 58%");
    expect(dark.primaryForeground).toBe("hsl(0, 0%, 100%)");

    const light = deriveTokens("220 14% 8%", "220 14% 92%", "235 55% 70%");
    expect(light.primaryForeground).toBe("hsl(0, 0%, 5%)");
  });

  it("adjusts semantic colors toward the theme", () => {
    const dark = deriveTokens("220 14% 8%", "220 14% 92%", "235 55% 58%");
    expect(dark.destructive).toBe("hsl(0, 72%, 56%)"); // lightened +5

    const light = deriveTokens("220 14% 97%", "220 14% 10%", "235 55% 52%");
    expect(light.destructive).toBe("hsl(0, 72%, 46%)"); // darkened -5
  });

  // The signal preset: all-achromatic core colors through the same lightness
  // math — the ramp must stay S=0 end to end, with the accent inverting.
  describe("achromatic derivation (signal)", () => {
    const t = deriveTokens("0 0% 4%", "0 0% 95%", "0 0% 100%", { semantics: "muted" });

    it("lands the elevation ramp on the spec targets", () => {
      expect(t.background).toBe("hsl(0, 0%, 4%)"); // #0a0a0a
      expect(t.panel).toBe("hsl(0, 0%, 7%)");
      expect(t.field).toBe("hsl(0, 0%, 8%)"); // #141414
      expect(t.card).toBe("hsl(0, 0%, 10%)");
      expect(t.border).toBe("hsl(0, 0%, 17.7%)"); // ≈ white @ 0.14 over canvas
      expect(t.borderLight).toBe("hsl(0, 0%, 13.1%)"); // ≈ white @ 0.08
    });

    it("the accent is the inversion: white fill, near-black text", () => {
      expect(t.primary).toBe("hsl(0, 0%, 100%)");
      expect(t.primaryForeground).toBe("hsl(0, 0%, 5%)");
      expect(t.primarySoft).toBe("hsl(0, 0%, 100%)"); // clamped at white
    });

    it("keeps every non-semantic token achromatic", () => {
      const semanticKeys = new Set([
        "destructive",
        "destructiveForeground",
        "success",
        "warning",
      ]);
      for (const [key, value] of Object.entries(t)) {
        if (semanticKeys.has(key)) continue;
        const s = parseFloat(value.split(",")[1]);
        expect({ key, s }).toEqual({ key, s: 0 });
      }
    });

    it("muted semantics keep destructive readable but quiet, others near-grey", () => {
      expect(t.destructive).toBe("hsl(0, 30%, 56%)");
      expect(t.success).toBe("hsl(142, 8%, 50%)");
      expect(t.warning).toBe("hsl(38, 12%, 55%)");
    });

    it("defaults to full semantics when no options are passed", () => {
      const full = deriveTokens("0 0% 4%", "0 0% 95%", "0 0% 100%");
      expect(full.destructive).toBe("hsl(0, 72%, 56%)");
    });
  });
});
