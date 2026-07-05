/**
 * NativeWind v4 theme — re-expresses the desktop client's Tailwind v4 `@theme`
 * tokens (client/src/index.css). Color values are CSS variables supplied at
 * runtime by ThemeProvider via NativeWind's vars() (src/theme/ThemeContext.tsx),
 * so preset switching restyles everything without a rebuild — same contract as
 * the desktop themeEngine.
 *
 * Class vocabulary intentionally matches the desktop: bg-panel, bg-card,
 * text-soft, text-muted, border-border, text-primary-soft, bg-primary-dim, …
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        background: "var(--color-background)",
        panel: "var(--color-panel)",
        card: {
          DEFAULT: "var(--color-card)",
          hover: "var(--color-card-hover)",
        },
        field: "var(--color-field)",
        popover: "var(--color-popover)",
        surface: {
          DEFAULT: "var(--color-surface)",
          hover: "var(--color-surface-hover)",
        },

        // Text ramp
        heading: "var(--color-heading)",
        body: "var(--color-body)",
        soft: "var(--color-soft)",
        muted: "var(--color-muted)",
        faint: "var(--color-faint)",

        // Primary accent
        primary: {
          DEFAULT: "var(--color-primary)",
          soft: "var(--color-primary-soft)",
          dim: "var(--color-primary-dim)",
          fg: "var(--color-primary-fg)",
        },

        // Borders
        border: {
          DEFAULT: "var(--color-border)",
          light: "var(--color-border-light)",
        },

        // Focus ring
        ring: "var(--color-ring)",

        // Semantic
        destructive: {
          DEFAULT: "var(--color-destructive)",
          fg: "var(--color-destructive-fg)",
        },
        success: "var(--color-success)",
        warning: "var(--color-warning)",

        // AI chart palette
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          4: "var(--chart-4)",
          5: "var(--chart-5)",
        },
      },
      // Radii tokens (--radius-sm/md/lg/xl on desktop)
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
    },
  },
  plugins: [],
};
