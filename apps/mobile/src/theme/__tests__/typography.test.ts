import {
  resolveFontFamily,
  resolveMonoFamily,
  setFontsReady,
  typeStyle,
} from "../typography";

const INTER = { family: "Inter" };
const TWO_VOICE = { family: "Inter", displayFamily: "Space Grotesk" };

describe("typography", () => {
  afterEach(() => setFontsReady(false));

  describe("resolveFontFamily", () => {
    it("returns undefined (system font) until fonts are loaded", () => {
      expect(resolveFontFamily("Inter", 600)).toBeUndefined();
    });

    it("maps (family, weight) to the loaded asset name", () => {
      setFontsReady(true);
      expect(resolveFontFamily("Inter", 400)).toBe("Inter_400Regular");
      expect(resolveFontFamily("Inter", 700)).toBe("Inter_700Bold");
      expect(resolveFontFamily("Space Grotesk", 600)).toBe("SpaceGrotesk_600SemiBold");
    });

    it("falls back to the system font for unknown families", () => {
      setFontsReady(true);
      expect(resolveFontFamily("Comic Sans", 400)).toBeUndefined();
      expect(resolveFontFamily(undefined, 400)).toBeUndefined();
    });
  });

  describe("resolveMonoFamily", () => {
    it("uses the platform mono stack until fonts load", () => {
      expect(resolveMonoFamily(400)).toMatch(/Menlo|monospace/);
    });

    it("upgrades to JetBrains Mono once loaded, clamping heavy weights to 500", () => {
      setFontsReady(true);
      expect(resolveMonoFamily(400)).toBe("JetBrainsMono_400Regular");
      expect(resolveMonoFamily(500)).toBe("JetBrainsMono_500Medium");
      expect(resolveMonoFamily(700)).toBe("JetBrainsMono_500Medium");
    });
  });

  describe("typeStyle", () => {
    it("display sits in the 28–34pt band with tight tracking", () => {
      const style = typeStyle("display", INTER);
      expect(style.fontSize).toBeGreaterThanOrEqual(28);
      expect(style.fontSize).toBeLessThanOrEqual(34);
      expect(style.letterSpacing).toBeLessThan(0);
    });

    it("uses the loaded family (weight in the name, no fontWeight)", () => {
      setFontsReady(true);
      const style = typeStyle("headline", INTER);
      expect(style.fontFamily).toBe("Inter_600SemiBold");
      expect(style.fontWeight).toBeUndefined();
    });

    it("keeps fontWeight when resolving to the system font", () => {
      const style = typeStyle("headline", INTER); // fonts not ready
      expect(style.fontFamily).toBeUndefined();
      expect(style.fontWeight).toBe("600");
    });

    it("display voice resolves the preset displayFamily", () => {
      setFontsReady(true);
      expect(typeStyle("display", TWO_VOICE).fontFamily).toBe("SpaceGrotesk_700Bold");
      expect(typeStyle("title", TWO_VOICE).fontFamily).toBe("SpaceGrotesk_600SemiBold");
    });

    it("display voice falls back to the body family without displayFamily", () => {
      setFontsReady(true);
      expect(typeStyle("display", INTER).fontFamily).toBe("Inter_700Bold");
    });

    it("body voice ignores displayFamily", () => {
      setFontsReady(true);
      expect(typeStyle("body", TWO_VOICE).fontFamily).toBe("Inter_400Regular");
    });

    it("meta voice uses the platform mono stack before fonts load", () => {
      const style = typeStyle("mono", INTER);
      expect(style.fontFamily).toMatch(/Menlo|monospace/);
      expect(style.fontWeight).toBe("400"); // system stack needs explicit weight
    });

    it("meta voice upgrades to JetBrains Mono regardless of preset font", () => {
      setFontsReady(true);
      expect(typeStyle("mono", INTER).fontFamily).toBe("JetBrainsMono_400Regular");
      expect(typeStyle("meta", TWO_VOICE).fontFamily).toBe("JetBrainsMono_400Regular");
      expect(typeStyle("metaLabel", undefined).fontFamily).toBe("JetBrainsMono_500Medium");
      expect(typeStyle("mono", INTER).fontWeight).toBeUndefined();
    });

    it("meta voice clamps weight overrides to the loaded 500", () => {
      setFontsReady(true);
      expect(typeStyle("meta", INTER, { weight: 700 }).fontFamily).toBe(
        "JetBrainsMono_500Medium",
      );
    });

    it("meta roles carry protocol-voice tracking", () => {
      const meta = typeStyle("meta", INTER);
      expect(meta.fontSize).toBe(11);
      expect(meta.letterSpacing).toBeGreaterThan(0.5);
      const label = typeStyle("metaLabel", INTER);
      expect(label.fontSize).toBe(10);
      expect(label.letterSpacing).toBeGreaterThan(0.5);
    });

    it("tabular option adds tabular-nums", () => {
      const style = typeStyle("body", INTER, { tabular: true });
      expect(style.fontVariant).toEqual(["tabular-nums"]);
    });

    it("weight override changes the resolved family", () => {
      setFontsReady(true);
      const style = typeStyle("body", INTER, { weight: 600 });
      expect(style.fontFamily).toBe("Inter_600SemiBold");
    });

    it("scale is monotonic: display > title > headline > body > caption > micro", () => {
      const sizes = (["display", "title", "headline", "body", "caption", "micro"] as const).map(
        (role) => typeStyle(role, INTER).fontSize!,
      );
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]).toBeLessThan(sizes[i - 1]);
      }
    });

    it("meta roles sit at the bottom of the scale", () => {
      const micro = typeStyle("micro", INTER).fontSize!;
      const meta = typeStyle("meta", INTER).fontSize!;
      const metaLabel = typeStyle("metaLabel", INTER).fontSize!;
      expect(meta).toBeLessThanOrEqual(micro);
      expect(metaLabel).toBeLessThan(meta);
    });
  });
});
