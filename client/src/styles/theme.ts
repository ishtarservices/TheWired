// Legacy theme object — uses new CSS variable names.
// Prefer using Tailwind classes directly (e.g. `bg-background`, `text-heading`).

export const theme = {
  colors: {
    bg: {
      primary: "var(--color-background)",
      secondary: "var(--color-panel)",
      tertiary: "var(--color-field)",
      hover: "var(--color-card-hover)",
      active: "var(--color-card-hover)",
    },
    text: {
      primary: "var(--color-heading)",
      secondary: "var(--color-body)",
      muted: "var(--color-muted)",
      accent: "var(--color-primary)",
    },
    border: {
      default: "var(--color-border)",
      light: "var(--color-border-light)",
    },
    surface: {
      default: "var(--color-surface)",
      hover: "var(--color-surface-hover)",
    },
    status: {
      online: "#22c55e",
      connecting: "#eab308",
      offline: "#ef4444",
      error: "#ef4444",
    },
    accent: {
      primary: "var(--color-primary)",
      hover: "var(--color-primary-soft)",
    },
    accentSecondary: {
      primary: "var(--color-primary)",
      hover: "var(--color-primary-soft)",
    },
  },
} as const;
