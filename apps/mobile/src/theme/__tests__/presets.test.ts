import { parseHSL } from "../engine";
import {
  DEFAULT_PRESET,
  FEATURED_KEYS,
  MOTION_INTENSITY,
  PRESETS,
  PRESET_KEYS,
} from "../presets";

describe("theme presets", () => {
  it("has a valid default preset", () => {
    expect(PRESETS[DEFAULT_PRESET]).toBeDefined();
    expect(DEFAULT_PRESET).toBe("signal");
  });

  it("signal is pure monochrome with grain and muted semantics", () => {
    const signal = PRESETS.signal;
    for (const value of Object.values(signal.colors)) {
      expect(parseHSL(value).s).toBe(0);
    }
    expect(parseHSL(signal.colors.background).l).toBe(4); // #0a0a0a
    expect(parseHSL(signal.colors.primary).l).toBe(100); // accent = inversion
    expect(signal.grain).toBe(true);
    expect(signal.semantics).toBe("muted");
    expect(signal.font?.displayFamily).toBe("Space Grotesk");
  });

  it("only signal carries grain (other presets unaffected)", () => {
    for (const key of PRESET_KEYS.filter((k) => k !== "signal")) {
      expect(PRESETS[key].grain ?? false).toBe(false);
      expect(PRESETS[key].semantics ?? "full").toBe("full");
    }
  });

  it("keys are consistent (key field matches map key, featured ⊆ all)", () => {
    for (const key of PRESET_KEYS) {
      expect(PRESETS[key].key).toBe(key);
    }
    for (const key of FEATURED_KEYS) {
      expect(PRESET_KEYS).toContain(key);
    }
  });

  it("every preset carries valid HSL core colors", () => {
    for (const preset of Object.values(PRESETS)) {
      for (const value of Object.values(preset.colors)) {
        const { h, s, l } = parseHSL(value);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(360);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(100);
      }
    }
  });

  it("every preset has a motion intensity in [0, 1]", () => {
    for (const key of PRESET_KEYS) {
      const intensity = MOTION_INTENSITY[key];
      expect(intensity).toBeDefined();
      expect(intensity).toBeGreaterThanOrEqual(0);
      expect(intensity).toBeLessThanOrEqual(1);
    }
  });
});
