/**
 * The ONLY module that imports recharts — loaded lazily (see ArtifactRenderer)
 * so recharts + d3 stay out of the main bundle. Renders exclusively from a
 * validated {@link ChartSpec}; the LLM never supplies markup, props, colors, or
 * formatters. Colors resolve to theme tokens (`var(--chart-N)`); axes/grid use
 * semantic tokens so the chart is dark-mode-correct.
 */
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import type { ChartSpec } from "./chartSpec";
import { seriesColorVar } from "./chartSpec";

const AXIS = "var(--color-muted, #888)";
const GRID = "var(--color-border, #333)";

const axisProps = {
  stroke: AXIS,
  tick: { fill: AXIS, fontSize: 11 },
} as const;

const tooltipStyle = {
  contentStyle: {
    background: "var(--color-popover, #1a1a1a)",
    border: "1px solid var(--color-border, #333)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--color-body, #ddd)",
  },
  labelStyle: { color: "var(--color-heading, #fff)" },
} as const;

/** Merge series into recharts row objects keyed by x: `{ x, [series]: y }`. */
function toRows(spec: ChartSpec): Record<string, string | number>[] {
  const byX = new Map<string | number, Record<string, string | number>>();
  const order: (string | number)[] = [];
  for (const s of spec.series) {
    for (const p of s.data) {
      let row = byX.get(p.x);
      if (!row) {
        row = { x: p.x };
        byX.set(p.x, row);
        order.push(p.x);
      }
      row[s.name] = p.y;
    }
  }
  return order.map((x) => byX.get(x)!);
}

export default function ChartArtifact({ spec }: { spec: ChartSpec }) {
  const rows = toRows(spec);

  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
      <XAxis dataKey="x" {...axisProps} />
      <YAxis {...axisProps} />
      <Tooltip {...tooltipStyle} />
      {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
    </>
  );

  let chart: React.ReactElement;
  switch (spec.type) {
    case "area":
      chart = (
        <AreaChart data={rows}>
          {common}
          {spec.series.map((s, i) => (
            <Area
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stackId={spec.stacked ? "1" : undefined}
              stroke={seriesColorVar(s, i)}
              fill={seriesColorVar(s, i)}
              fillOpacity={0.25}
            />
          ))}
        </AreaChart>
      );
      break;
    case "bar":
      chart = (
        <BarChart data={rows}>
          {common}
          {spec.series.map((s, i) => (
            <Bar
              key={s.name}
              dataKey={s.name}
              stackId={spec.stacked ? "1" : undefined}
              fill={seriesColorVar(s, i)}
            />
          ))}
        </BarChart>
      );
      break;
    case "pie": {
      const s0 = spec.series[0];
      chart = (
        <PieChart>
          <Tooltip {...tooltipStyle} />
          <Pie
            data={s0.data.map((p) => ({ name: String(p.x), value: p.y }))}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius="75%"
            label
          >
            {s0.data.map((_, i) => (
              <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />
            ))}
          </Pie>
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      );
      break;
    }
    case "scatter":
      chart = (
        <ScatterChart>
          {common}
          {spec.series.map((s, i) => (
            <Scatter key={s.name} name={s.name} data={s.data} fill={seriesColorVar(s, i)} />
          ))}
        </ScatterChart>
      );
      break;
    case "line":
    default:
      chart = (
        <LineChart data={rows}>
          {common}
          {spec.series.map((s, i) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={seriesColorVar(s, i)}
              dot={false}
            />
          ))}
        </LineChart>
      );
  }

  return (
    <div className="w-full">
      {spec.title && (
        <h3 className="mb-2 text-sm font-semibold text-heading">{spec.title}</h3>
      )}
      <div className="h-[300px] min-h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
