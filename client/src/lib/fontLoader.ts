// ─── Dynamic Font Loader ─────────────────────────────────────────────

import type { ThemeFont } from "./themeTypes";

/** Bundled fonts that don't need external loading */
const BUNDLED_FONTS = new Set(["Space Grotesk", "Inter"]);

/** Google Fonts that can be loaded via API */
const GOOGLE_FONTS_BASE = "https://fonts.googleapis.com/css2";

/** Track loaded fonts to avoid duplicate loads */
const loadedFonts = new Set<string>();

/** ID prefix for dynamically inserted link/style elements */
const LINK_ID_PREFIX = "thewired-font-";

function getFontLinkId(family: string): string {
  return LINK_ID_PREFIX + family.replace(/\s+/g, "-").toLowerCase();
}

/** Remove previously loaded dynamic font link */
function removeFontLink(family: string): void {
  const id = getFontLinkId(family);
  const existing = document.getElementById(id);
  if (existing) existing.remove();
}

/** Load a font from Google Fonts */
function loadGoogleFont(family: string, weight?: string): void {
  const id = getFontLinkId(family);
  if (document.getElementById(id)) return;

  const weights = weight || "300;400;500;600;700";
  const url = `${GOOGLE_FONTS_BASE}?family=${encodeURIComponent(family)}:wght@${weights}&display=swap`;

  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

/** Load a font from a custom URL (.woff2, etc.) */
function loadCustomFont(family: string, url: string, weight?: string): void {
  const id = getFontLinkId(family);
  if (document.getElementById(id)) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    @font-face {
      font-family: '${family}';
      src: url('${url}') format('woff2');
      font-weight: ${weight || "100 900"};
      font-display: swap;
      font-style: normal;
    }
  `;
  document.head.appendChild(style);
}

/** Main entry point: load a theme font and return the family name */
export function loadThemeFont(font: ThemeFont | undefined): string {
  if (!font) return "Inter";

  const { family, url, weight } = font;

  // Bundled fonts are already available
  if (BUNDLED_FONTS.has(family)) {
    loadedFonts.add(family);
    return family;
  }

  // Already loaded
  if (loadedFonts.has(family)) return family;

  if (url) {
    loadCustomFont(family, url, weight);
  } else {
    loadGoogleFont(family, weight);
  }

  loadedFonts.add(family);
  return family;
}

/** Clean up font links when switching themes */
export function unloadFont(family: string): void {
  if (BUNDLED_FONTS.has(family)) return;
  removeFontLink(family);
  loadedFonts.delete(family);
}

/** Add a preload hint for the active theme's font */
export function preloadFont(font: ThemeFont | undefined): void {
  if (!font?.url) return;

  const id = `thewired-font-preload-${font.family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;

  const link = document.createElement("link");
  link.id = id;
  link.rel = "preload";
  link.as = "font";
  link.type = "font/woff2";
  link.href = font.url;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}
