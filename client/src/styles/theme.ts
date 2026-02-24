export const theme = {
  colors: {
    bg: {
      primary: "var(--color-backdrop)",
      secondary: "var(--color-panel)",
      tertiary: "var(--color-field)",
      hover: "var(--color-card-hover)",
      active: "var(--color-card-hover)",
    },
    text: {
      primary: "var(--color-heading)",
      secondary: "var(--color-body)",
      muted: "var(--color-muted)",
      accent: "var(--color-neon)",
    },
    border: {
      default: "var(--color-edge)",
      light: "var(--color-edge-light)",
    },
    status: {
      online: "#22c55e",
      connecting: "#eab308",
      offline: "#ef4444",
      error: "#ef4444",
    },
    accent: {
      primary: "var(--color-neon)",
      hover: "var(--color-neon-soft)",
    },
  },
} as const;
