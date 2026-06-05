/**
 * Safe, bounded chart-spec parsing for LLM-generated charts. The model emits
 * DATA + INTENT as JSON only — never JSX, recharts props, colors, or formatters.
 * We clamp every field and resolve colors to a fixed theme palette index, so a
 * malformed or prompt-injected spec can't break the renderer or smuggle CSS /
 * URLs through to the DOM (research: recharts-safety brief; nostr-security skill).
 *
 * Validation is hand-rolled (no zod dep): coerce numbers, enum-check types, and
 * cap series/points/label lengths to anti-DoS ceilings.
 */
export type ChartType = "line" | "area" | "bar" | "pie" | "scatter";

/** Palette index only — resolved to `var(--chart-N)` at render time. */
export type ChartColorToken =
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5";

export interface ChartDataPoint {
  x: string | number;
  y: number;
}

export interface ChartSeries {
  name: string;
  color?: ChartColorToken;
  data: ChartDataPoint[];
}

export interface ChartSpec {
  type: ChartType;
  title?: string;
  stacked: boolean;
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
}

const MAX_SERIES = 6;
const MAX_POINTS = 500;
const MAX_LABEL = 80;
const MAX_CELLS = MAX_SERIES * MAX_POINTS;
const CHART_TYPES: ReadonlySet<string> = new Set([
  "line",
  "area",
  "bar",
  "pie",
  "scatter",
]);
const COLOR_TOKENS: ReadonlySet<string> = new Set([
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
]);

function clampLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t) return undefined;
  return t.slice(0, MAX_LABEL);
}

function toFinite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function parsePoint(raw: unknown): ChartDataPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const y = toFinite(o.y);
  if (y === null) return null;
  let x: string | number;
  if (typeof o.x === "number" && Number.isFinite(o.x)) x = o.x;
  else if (typeof o.x === "string") x = o.x.slice(0, MAX_LABEL);
  else {
    const xn = toFinite(o.x);
    if (xn === null) return null;
    x = xn;
  }
  return { x, y };
}

function parseSeries(raw: unknown): ChartSeries | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = clampLabel(o.name) ?? "Series";
  const color =
    typeof o.color === "string" && COLOR_TOKENS.has(o.color)
      ? (o.color as ChartColorToken)
      : undefined;
  if (!Array.isArray(o.data)) return null;
  const data: ChartDataPoint[] = [];
  for (const p of o.data) {
    if (data.length >= MAX_POINTS) break;
    const point = parsePoint(p);
    if (point) data.push(point);
  }
  if (data.length === 0) return null;
  return { name, color, data };
}

/** Strip code fences / surrounding prose and return the JSON object string. */
export function extractJsonObject(input: string): string | null {
  const fence = input.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const body = fence?.[1] ?? input;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

export type ChartParseResult =
  | { ok: true; spec: ChartSpec }
  | { ok: false; error: string };

/** Parse + clamp an untrusted chart spec (string JSON or already-parsed value). */
export function parseChartSpec(raw: unknown): ChartParseResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const json = extractJsonObject(raw);
    if (!json) return { ok: false, error: "No JSON object found in chart block." };
    try {
      value = JSON.parse(json);
    } catch {
      return { ok: false, error: "Chart block is not valid JSON." };
    }
  }
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Chart spec must be an object." };
  }
  const o = value as Record<string, unknown>;
  const type =
    typeof o.type === "string" && CHART_TYPES.has(o.type)
      ? (o.type as ChartType)
      : null;
  if (!type) return { ok: false, error: "Unknown or missing chart type." };

  if (!Array.isArray(o.series)) return { ok: false, error: "Missing series array." };
  const series: ChartSeries[] = [];
  let cells = 0;
  for (const s of o.series) {
    if (series.length >= MAX_SERIES) break;
    const parsed = parseSeries(s);
    if (!parsed) continue;
    cells += parsed.data.length;
    if (cells > MAX_CELLS) break;
    series.push(parsed);
  }
  if (series.length === 0) return { ok: false, error: "No valid series." };
  if (type === "pie" && series.length !== 1) {
    // Pie renders the first series only; keep it.
    series.length = 1;
  }

  return {
    ok: true,
    spec: {
      type,
      title: clampLabel(o.title),
      stacked: o.stacked === true,
      series,
      xLabel: clampLabel(o.xLabel),
      yLabel: clampLabel(o.yLabel),
    },
  };
}

/** Default color cycle (palette index → token) for series without an explicit color. */
export function seriesColorVar(series: ChartSeries, index: number): string {
  const token = series.color ?? (`chart-${(index % 5) + 1}` as ChartColorToken);
  return `var(--${token})`;
}
