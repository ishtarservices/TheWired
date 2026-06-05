import { describe, it, expect } from "vitest";
import { parseChartSpec } from "../artifacts/chartSpec";

describe("parseChartSpec", () => {
  it("parses a valid line chart", () => {
    const res = parseChartSpec(
      JSON.stringify({
        type: "line",
        title: "Sales",
        series: [{ name: "A", data: [{ x: "Jan", y: 1 }, { x: "Feb", y: 2 }] }],
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.spec.type).toBe("line");
      expect(res.spec.series[0].data).toHaveLength(2);
    }
  });

  it("coerces numeric strings and drops invalid points", () => {
    const res = parseChartSpec({
      type: "bar",
      series: [{ name: "A", data: [{ x: "a", y: "5" }, { x: "b", y: "nope" }] }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.spec.series[0].data).toEqual([{ x: "a", y: 5 }]);
    }
  });

  it("rejects unknown chart types", () => {
    expect(parseChartSpec({ type: "pie3d", series: [] }).ok).toBe(false);
  });

  it("rejects non-JSON strings and non-objects", () => {
    expect(parseChartSpec("not json").ok).toBe(false);
    expect(parseChartSpec(42).ok).toBe(false);
  });

  it("ignores non-palette colors (no raw CSS reaches the renderer)", () => {
    const res = parseChartSpec({
      type: "line",
      series: [{ name: "A", color: "url(http://evil)", data: [{ x: 1, y: 1 }] }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.spec.series[0].color).toBeUndefined();
  });

  it("clamps series and points to anti-DoS ceilings", () => {
    const series = Array.from({ length: 50 }, (_, i) => ({
      name: `S${i}`,
      data: Array.from({ length: 2000 }, (_, j) => ({ x: j, y: j })),
    }));
    const res = parseChartSpec({ type: "line", series });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.spec.series.length).toBeLessThanOrEqual(6);
      for (const s of res.spec.series) expect(s.data.length).toBeLessThanOrEqual(500);
    }
  });

  it("strips code fences around the JSON", () => {
    const res = parseChartSpec('```json\n{"type":"bar","series":[{"name":"A","data":[{"x":1,"y":1}]}]}\n```');
    expect(res.ok).toBe(true);
  });

  it("rejects empty/invalid series", () => {
    expect(parseChartSpec({ type: "line", series: [] }).ok).toBe(false);
    expect(parseChartSpec({ type: "line", series: [{ name: "A", data: [] }] }).ok).toBe(false);
    expect(parseChartSpec({ type: "line" }).ok).toBe(false);
  });

  it("reduces a pie chart to a single series", () => {
    const res = parseChartSpec({
      type: "pie",
      series: [
        { name: "A", data: [{ x: "a", y: 1 }] },
        { name: "B", data: [{ x: "b", y: 2 }] },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.spec.series).toHaveLength(1);
  });

  it("accepts scatter and drops points missing y", () => {
    const res = parseChartSpec({
      type: "scatter",
      series: [{ name: "A", data: [{ x: 1, y: 2 }, { x: 3 }] }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.spec.series[0].data).toEqual([{ x: 1, y: 2 }]);
  });
});
