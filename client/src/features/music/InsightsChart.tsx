import { useState } from "react";

interface InsightsChartProps {
  data: { date: string; count: number }[];
  height?: number;
}

export function InsightsChart({ data, height = 200 }: InsightsChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const barCount = data.length;
  const padding = { top: 20, right: 12, bottom: 32, left: 40 };
  const chartWidth = 600;
  const chartHeight = height;
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  const barWidth = Math.max(innerWidth / barCount - 2, 2);
  const barGap = (innerWidth - barWidth * barCount) / barCount;

  // Y-axis scale ticks
  const yTicks = [];
  const tickCount = 4;
  for (let i = 0; i <= tickCount; i++) {
    const val = Math.round((maxCount / tickCount) * i);
    yTicks.push(val);
  }

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      className="w-full"
      style={{ maxHeight: `${chartHeight}px` }}
    >
      {/* Y-axis grid lines and labels */}
      {yTicks.map((tick) => {
        const y = padding.top + innerHeight - (tick / maxCount) * innerHeight;
        return (
          <g key={`y-${tick}`}>
            <line
              x1={padding.left}
              y1={y}
              x2={chartWidth - padding.right}
              y2={y}
              className="stroke-edge"
              strokeWidth={0.5}
              strokeDasharray="4 4"
            />
            <text
              x={padding.left - 6}
              y={y + 4}
              textAnchor="end"
              className="fill-muted text-[10px]"
            >
              {tick}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const barHeight = maxCount > 0 ? (d.count / maxCount) * innerHeight : 0;
        const x = padding.left + i * (barWidth + barGap) + barGap / 2;
        const y = padding.top + innerHeight - barHeight;
        const isHovered = hoveredIndex === i;

        return (
          <g
            key={d.date}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {/* Hover hit area */}
            <rect
              x={x - barGap / 2}
              y={padding.top}
              width={barWidth + barGap}
              height={innerHeight}
              fill="transparent"
            />
            {/* Bar */}
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barHeight, 0)}
              rx={1}
              className={isHovered ? "fill-pulse" : "fill-pulse/60"}
              style={{ transition: "fill 0.15s" }}
            />
            {/* Hover tooltip */}
            {isHovered && (
              <>
                <rect
                  x={x + barWidth / 2 - 24}
                  y={y - 22}
                  width={48}
                  height={18}
                  rx={4}
                  className="fill-surface"
                />
                <text
                  x={x + barWidth / 2}
                  y={y - 10}
                  textAnchor="middle"
                  className="fill-heading text-[10px] font-medium"
                >
                  {d.count}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* X-axis labels (every 5th day) */}
      {data.map((d, i) => {
        if (i % 5 !== 0 && i !== data.length - 1) return null;
        const x = padding.left + i * (barWidth + barGap) + barGap / 2 + barWidth / 2;
        const label = d.date.slice(5); // MM-DD
        return (
          <text
            key={`x-${d.date}`}
            x={x}
            y={chartHeight - padding.bottom + 16}
            textAnchor="middle"
            className="fill-muted text-[9px]"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
