import { entranceDelay, fadeEntering, listEntering, pressedScale } from "../motion";

describe("motion", () => {
  describe("pressedScale", () => {
    it("is 0.97 at full intensity and 1 at zero", () => {
      expect(pressedScale(1)).toBeCloseTo(0.97);
      expect(pressedScale(0)).toBe(1);
      expect(pressedScale(0.5)).toBeCloseTo(0.985);
    });

    it("clamps out-of-range intensity", () => {
      expect(pressedScale(5)).toBeCloseTo(0.97);
      expect(pressedScale(-1)).toBe(1);
    });
  });

  describe("entranceDelay", () => {
    it("staggers 40ms per item", () => {
      expect(entranceDelay(0)).toBe(0);
      expect(entranceDelay(1)).toBe(40);
      expect(entranceDelay(5)).toBe(200);
    });

    it("caps at 8 items so long lists don't wait forever", () => {
      expect(entranceDelay(7)).toBe(280);
      expect(entranceDelay(8)).toBe(280);
      expect(entranceDelay(50)).toBe(280);
    });

    it("never returns a negative delay", () => {
      expect(entranceDelay(-3)).toBe(0);
    });
  });

  describe("entering builders", () => {
    it("return undefined when motion is off", () => {
      expect(listEntering(0, 0, false)).toBeUndefined();
      expect(listEntering(0, 1, true)).toBeUndefined();
      expect(fadeEntering(0, false)).toBeUndefined();
      expect(fadeEntering(1, true)).toBeUndefined();
    });

    it("return an animation when motion is on", () => {
      expect(listEntering(0, 1, false)).toBeDefined();
      expect(fadeEntering(1, false)).toBeDefined();
    });
  });
});
