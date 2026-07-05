import { resolveFontFamily, setFontsReady, typeStyle } from "../typography";

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

  describe("typeStyle", () => {
    it("display sits in the 28–34pt band with tight tracking", () => {
      const style = typeStyle("display", "Inter");
      expect(style.fontSize).toBeGreaterThanOrEqual(28);
      expect(style.fontSize).toBeLessThanOrEqual(34);
      expect(style.letterSpacing).toBeLessThan(0);
    });

    it("uses the loaded family (weight in the name, no fontWeight)", () => {
      setFontsReady(true);
      const style = typeStyle("title", "Inter");
      expect(style.fontFamily).toBe("Inter_600SemiBold");
      expect(style.fontWeight).toBeUndefined();
    });

    it("keeps fontWeight when resolving to the system font", () => {
      const style = typeStyle("title", "Inter"); // fonts not ready
      expect(style.fontFamily).toBeUndefined();
      expect(style.fontWeight).toBe("600");
    });

    it("mono roles use the platform mono stack regardless of preset font", () => {
      setFontsReady(true);
      const style = typeStyle("mono", "Inter");
      expect(style.fontFamily).toMatch(/Menlo|monospace/);
    });

    it("tabular option adds tabular-nums", () => {
      const style = typeStyle("body", "Inter", { tabular: true });
      expect(style.fontVariant).toEqual(["tabular-nums"]);
    });

    it("weight override changes the resolved family", () => {
      setFontsReady(true);
      const style = typeStyle("body", "Inter", { weight: 600 });
      expect(style.fontFamily).toBe("Inter_600SemiBold");
    });

    it("scale is monotonic: display > title > headline > body > caption > micro", () => {
      const sizes = (["display", "title", "headline", "body", "caption", "micro"] as const).map(
        (role) => typeStyle(role, "Inter").fontSize!,
      );
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]).toBeLessThan(sizes[i - 1]);
      }
    });
  });
});
