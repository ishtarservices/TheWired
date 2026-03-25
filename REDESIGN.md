# The Wired V1 — Design System Redesign

> **Goal**: Transform the app from its current cyberpunk/neon aesthetic into an elegant, minimalistic, contemporary default — while making the current look available as one of many selectable theme presets. Introduce a 3-color → full UI derivation system so that themes are portable, user-publishable, and dead-simple to create.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Theme Engine Architecture](#2-theme-engine-architecture)
3. [Core Token Derivation](#3-core-token-derivation)
4. [CSS Variable Overhaul (`index.css`)](#4-css-variable-overhaul-indexcss)
5. [ThemeContext Rewrite](#5-themecontext-rewrite)
6. [TypeScript Types & Config](#6-typescript-types--config)
7. [Theme Presets](#7-theme-presets)
8. [Font System](#8-font-system)
9. [Background System](#9-background-system)
10. [New Default Aesthetic](#10-new-default-aesthetic)
11. [Component Redesign Checklist](#11-component-redesign-checklist)
12. [Hardcoded Color Remediation](#12-hardcoded-color-remediation)
13. [Settings UI — Theme Picker](#13-settings-ui--theme-picker)
14. [Animation & Micro-interaction Refinement](#14-animation--micro-interaction-refinement)
15. [Z-Index & Layering System](#15-z-index--layering-system)
16. [Spacing & Layout Tokens](#16-spacing--layout-tokens)
17. [Accessibility](#17-accessibility)
18. [Migration Strategy](#18-migration-strategy)
19. [File-by-File Change Map](#19-file-by-file-change-map)

---

## 1. Design Philosophy

### Current State
- **Cyberpunk**: Neon cyan (#00F0FF) + violet pulse (#8B5CF6), heavy glow effects, glass morphism everywhere, dark-first
- **Aesthetic**: "Hacker terminal meets synthwave" — bold, atmospheric, high-energy
- **Pain points**: Hardcoded colors throughout (~117 instances), only dark/light toggle, no customization, some visual noise

### Target State
- **Default**: Clean, airy, contemporary — think Linear, Arc Browser, Vercel. Subtle depth, generous whitespace, refined typography
- **Key traits**: Muted palette, whisper-thin borders, soft shadows (no glows by default), variable weight type, plenty of breathing room
- **Theme system**: Current cyberpunk becomes the "Neon" preset. Users can pick from ~15-20 presets or create their own with just 3 colors + optional font + optional background
- **Portable**: Theme configs are small enough to publish as Nostr events (future v2)

### Design Principles
1. **Content first** — UI chrome should be nearly invisible
2. **Derive, don't define** — 3 colors generate the full token set algorithmically
3. **One font = one personality** — Each theme picks one typeface; it carries the vibe
4. **Progressive disclosure** — 8-10 featured themes in the quick picker, full gallery in settings
5. **Graceful degradation** — Themes work without background images; images are enhancement

---

## 2. Theme Engine Architecture

### Overview

```
┌─────────────────────────────────────────────────────────┐
│                   ThemeConfig                           │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐    │
│  │ 3 Colors │  │ Font?    │  │ Background?        │    │
│  │ bg/fg/   │  │ family   │  │ url, mode, blurhash│    │
│  │ primary  │  │ url?     │  │                    │    │
│  └────┬─────┘  └──────────┘  └────────────────────┘    │
│       │                                                 │
│       ▼                                                 │
│  deriveTokens(bg, fg, primary)                         │
│       │                                                 │
│       ▼                                                 │
│  ~22 CSS custom properties injected on :root           │
│  + font-family override                                │
│  + background-image/video layer                        │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User picks a theme** → preset key or "custom"
2. **ThemeContext** resolves the `ThemeConfig` (colors + font + background)
3. **`deriveTokens()`** computes all ~22 CSS tokens from the 3 core colors
4. **CSS variables** injected on `document.documentElement.style`
5. **Font** loaded dynamically (Google Fonts URL or bundled), applied via `--font-family`
6. **Background** rendered as a fixed full-bleed layer behind the app

### Storage
- `localStorage["thewired_theme"]` — Active theme key: `"default-dark"`, `"default-light"`, `"neon"`, `"custom"`, etc.
- `localStorage["thewired_custom_theme"]` — User's custom `ThemeConfig` JSON (only when theme = "custom")
- Future: Nostr replaceable event kind for publishing themes

---

## 3. Core Token Derivation

### Input: `CoreColors`

```typescript
interface CoreColors {
  background: string;  // HSL string e.g. "220 14% 96%"
  foreground: string;  // HSL string e.g. "220 14% 10%"
  primary: string;     // HSL string e.g. "250 60% 55%"
}
```

### Output: `DerivedTokens` (~22 tokens)

```typescript
interface DerivedTokens {
  // Backgrounds (shift lightness from core background)
  background: string;       // = core.background
  panel: string;            // bg lightness ± 2-3%
  card: string;             // bg lightness ± 4-6%
  cardHover: string;        // card lightness ± 2%
  field: string;            // bg lightness ± 3%
  popover: string;          // = panel
  surface: string;          // fg at 3% opacity
  surfaceHover: string;     // fg at 6% opacity

  // Text (interpolate from core foreground)
  heading: string;          // = core.foreground
  body: string;             // fg lightness shifted 15% toward bg
  soft: string;             // fg lightness shifted 30% toward bg
  muted: string;            // fg lightness shifted 50% toward bg
  faint: string;            // fg lightness shifted 65% toward bg

  // Primary accent (derive from core primary)
  primary: string;          // = core.primary
  primarySoft: string;      // primary lightness + 10%
  primaryDim: string;       // primary at 15% opacity
  primaryForeground: string;// white or black based on primary luminance

  // Borders (interpolate between bg and fg)
  border: string;           // 15% from bg toward fg
  borderLight: string;      // 10% from bg toward fg

  // Semantic (fixed or derived)
  ring: string;             // = primary at 50% opacity
  destructive: string;      // fixed red, lightness adjusted to match theme
  destructiveForeground: string;
  success: string;          // fixed green, lightness adjusted
  warning: string;          // fixed amber, lightness adjusted
}
```

### Algorithm: `deriveTokens(bg, fg, primary)`

```typescript
function deriveTokens(bg: string, fg: string, primary: string): DerivedTokens {
  const bgHSL = parseHSL(bg);
  const fgHSL = parseHSL(fg);
  const priHSL = parseHSL(primary);
  const isDark = bgHSL.l < 50;

  // Direction: lighter or darker from background
  const dir = isDark ? 1 : -1; // +1 = lighten, -1 = darken

  return {
    background: bg,
    panel:       shiftL(bgHSL, dir * 3),
    card:        shiftL(bgHSL, dir * 6),
    cardHover:   shiftL(bgHSL, dir * 9),
    field:       shiftL(bgHSL, dir * 4),
    popover:     shiftL(bgHSL, dir * 3),
    surface:     withAlpha(fg, 0.03),
    surfaceHover:withAlpha(fg, 0.06),

    heading:     fg,
    body:        lerpL(fgHSL, bgHSL, 0.15),
    soft:        lerpL(fgHSL, bgHSL, 0.30),
    muted:       lerpL(fgHSL, bgHSL, 0.50),
    faint:       lerpL(fgHSL, bgHSL, 0.65),

    primary:     primary,
    primarySoft: shiftL(priHSL, 10),
    primaryDim:  withAlpha(primary, 0.15),
    primaryForeground: priHSL.l > 60 ? "0 0% 5%" : "0 0% 100%",

    border:      lerpL(bgHSL, fgHSL, 0.15),
    borderLight: lerpL(bgHSL, fgHSL, 0.10),

    ring:        withAlpha(primary, 0.5),
    destructive: adjustToTheme("0 72% 51%", isDark),
    destructiveForeground: "0 0% 100%",
    success:     adjustToTheme("142 71% 45%", isDark),
    warning:     adjustToTheme("38 92% 50%", isDark),
  };
}
```

### Key Techniques
- **HSL as the storage format**: Store `"258 70% 60%"` not hex. Enables `hsl(var(--primary) / 0.15)` for alpha variants.
- **`lerpL()`**: Linear interpolation of lightness between two HSL values — creates the text hierarchy and border scale.
- **`shiftL()`**: Shift lightness by N% — creates background layers.
- **`withAlpha()`**: Returns `hsl(H S% L% / alpha)` string for transparent overlays.
- **`isDark` detection**: `bgHSL.l < 50` determines derivation direction.

### New File

- [ ] **`client/src/lib/themeEngine.ts`** — Contains `parseHSL`, `shiftL`, `lerpL`, `withAlpha`, `deriveTokens`, and `applyTheme` (sets CSS variables on `:root`)

---

## 4. CSS Variable Overhaul (`index.css`)

### Current Problem
- ~55 CSS custom properties defined statically in `@theme` block and `:root`
- Two complete sets (dark + light) hardcoded
- Many non-color variables (glows, shadows, glass) reference specific rgba values that won't adapt to arbitrary themes
- Tailwind v4 `@theme` block registers color tokens — these become utility classes

### New Approach

The `@theme` block should register **semantic token names only**, with their values set dynamically by JS. The CSS file defines the structure; `deriveTokens()` fills in the values at runtime.

### Changes to `client/src/index.css`

- [ ] **Remove** the static color values from `@theme` block — replace with `initial` or CSS variable fallbacks
- [ ] **Remove** the `:root[data-theme="light"]` override block entirely (themes are now applied by JS)
- [ ] **Rename CSS variables** from current naming (`--color-backdrop`, `--color-pulse`, `--color-neon`) to standardized naming:

#### New Variable Naming Convention

| Old Variable | New Variable | Source |
|---|---|---|
| `--color-backdrop` | `--color-background` | `deriveTokens().background` |
| `--color-panel` | `--color-panel` | `deriveTokens().panel` |
| `--color-card` | `--color-card` | `deriveTokens().card` |
| `--color-card-hover` | `--color-card-hover` | `deriveTokens().cardHover` |
| `--color-field` | `--color-field` | `deriveTokens().field` |
| `--color-surface` | `--color-surface` | `deriveTokens().surface` |
| `--color-surface-hover` | `--color-surface-hover` | `deriveTokens().surfaceHover` |
| `--color-heading` | `--color-heading` | `deriveTokens().heading` |
| `--color-body` | `--color-body` | `deriveTokens().body` |
| `--color-soft` | `--color-soft` | `deriveTokens().soft` |
| `--color-muted` | `--color-muted` | `deriveTokens().muted` |
| `--color-faint` | `--color-faint` | `deriveTokens().faint` |
| `--color-pulse` | `--color-primary` | `deriveTokens().primary` |
| `--color-pulse-soft` | `--color-primary-soft` | `deriveTokens().primarySoft` |
| `--color-pulse-dim` | `--color-primary-dim` | `deriveTokens().primaryDim` |
| `--color-neon` | *(removed — secondary accent is now just primary variations)* | — |
| `--color-neon-soft` | *(removed)* | — |
| `--color-accent-from` | `--color-primary` | reuse primary |
| `--color-accent-to` | `--color-primary-soft` | reuse primarySoft |
| `--color-edge` | `--color-border` | `deriveTokens().border` |
| `--color-edge-light` | `--color-border-light` | `deriveTokens().borderLight` |
| *(new)* | `--color-ring` | `deriveTokens().ring` |
| *(new)* | `--color-destructive` | `deriveTokens().destructive` |
| *(new)* | `--color-success` | `deriveTokens().success` |
| *(new)* | `--color-warning` | `deriveTokens().warning` |
| *(new)* | `--color-primary-fg` | `deriveTokens().primaryForeground` |

> **Breaking change**: `--color-neon` goes away. The current design's secondary cyan accent is specific to the "Neon" theme preset. The base system uses only `primary` + derived variations. Themes that want a secondary accent can use `primarySoft` or define a background.

- [ ] **Update Tailwind `@theme` registration** to use the new variable names
- [ ] **Derive non-color variables** (glass, glow, shadow) from the primary color:

```css
:root {
  /* These are now computed from --color-primary by applyTheme() */
  --glass-bg: hsl(var(--color-background) / 0.82);
  --glass-border: hsl(var(--color-primary) / 0.06);
  --glow-primary: 0 0 12px hsl(var(--color-primary) / 0.2);
  --glow-primary-strong: 0 0 20px hsl(var(--color-primary) / 0.3);
  --shadow-card: 0 2px 8px hsl(var(--color-background) / 0.3);
  /* etc */
}
```

- [ ] **Keep layout utility classes** unchanged (`.safe-area-top`, `.pb-overscroll`, etc.)
- [ ] **Keep animation `@keyframes`** unchanged
- [ ] **Update all glow/shadow classes** to reference `--color-primary` instead of hardcoded `rgba(139, 92, 246, ...)`
- [ ] **Add `--font-family` variable** — set dynamically by theme engine

### Checklist: `client/src/index.css`

- [ ] Rewrite `@theme` block with new variable names (empty/fallback values)
- [ ] Remove `:root[data-theme="light"]` color overrides (both blocks)
- [ ] Update `:root` font-family to use `var(--font-family, 'Inter')`
- [ ] Update `.glass` / `.glass-panel` / `.card-glass` to use HSL variable references
- [ ] Update `.glow-*` classes to use `--color-primary` references
- [ ] Update `.bg-ambient` gradients to use `--color-primary` references
- [ ] Update `.text-silver-gradient` and `.text-gradient-accent` to use derived tokens
- [ ] Update `.border-gradient` pseudo-element to use `--color-primary`/`--color-primary-soft`
- [ ] Update `.neon-bar-left` → rename to `.active-bar-left`, use `--color-primary`
- [ ] Update `.border-neon-glow` → rename to `.border-primary-glow`
- [ ] Update `.focus-glow` to use `--color-primary`
- [ ] Update all animation keyframes referencing specific rgba colors
- [ ] Update scrollbar colors to use derived tokens
- [ ] Add `--font-family` CSS variable with fallback

---

## 5. ThemeContext Rewrite

### Current: `client/src/contexts/ThemeContext.tsx`
- Only supports `"dark" | "light"` toggle
- Sets `data-theme="light"` attribute on `<html>`
- Stores preference in localStorage

### New: Full Theme Engine Context

```typescript
type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  /** Active mode (determines base derivation direction) */
  mode: ThemeMode;
  /** Active preset key, or "custom" */
  preset: string;
  /** Resolved ThemeConfig (always computed, never null) */
  config: ThemeConfig;
  /** All available preset keys */
  presetKeys: string[];
  /** Featured presets (for compact pickers) */
  featuredKeys: string[];
}

interface ThemeActions {
  setMode: (mode: ThemeMode) => void;
  setPreset: (key: string) => void;
  setCustomColors: (colors: CoreColors) => void;
  setCustomFont: (font: ThemeFont | null) => void;
  setCustomBackground: (bg: ThemeBackground | null) => void;
  cyclePreset: (direction: 1 | -1) => void;
}
```

### Checklist: `client/src/contexts/ThemeContext.tsx`

- [ ] Expand `Theme` type to include mode + preset + custom config
- [ ] Add `deriveTokens()` call whenever theme config changes
- [ ] Apply CSS variables to `:root` via `document.documentElement.style.setProperty()`
- [ ] Handle dynamic font loading (insert `<link>` for Google Fonts or `@font-face` for custom URLs)
- [ ] Handle background image/video layer
- [ ] Add "system" mode with `matchMedia("(prefers-color-scheme: dark)")` listener
- [ ] Persist full theme state to localStorage
- [ ] Export `useTheme()` hook with both state and actions
- [ ] Add `cyclePreset()` for keyboard shortcut / quick switcher

---

## 6. TypeScript Types & Config

### New File: `client/src/lib/themeTypes.ts`

```typescript
export interface CoreColors {
  background: string;  // HSL
  foreground: string;  // HSL
  primary: string;     // HSL
}

export interface ThemeFont {
  family: string;
  url?: string;         // .woff2 / Google Fonts URL
  weight?: string;      // e.g. "300 700"
}

export interface ThemeBackground {
  url: string;
  mode: "cover" | "tile";
  blurhash?: string;
  mimeType?: string;
}

export interface ThemeConfig {
  title: string;
  colors: CoreColors;
  font?: ThemeFont;
  background?: ThemeBackground;
}

export interface ThemePreset extends ThemeConfig {
  key: string;
  emoji: string;
  featured?: boolean;
  category?: "minimal" | "atmospheric" | "expressive" | "nostalgic" | "nature";
}
```

### Checklist: New Types

- [ ] Create `client/src/lib/themeTypes.ts` with the above types
- [ ] Create `client/src/lib/themeEngine.ts` with derivation logic
- [ ] Create `client/src/lib/themePresets.ts` with all preset definitions
- [ ] Remove or repurpose `client/src/styles/theme.ts` (the old static color map)
- [ ] Update `client/src/types/` if any files reference old theme types

---

## 7. Theme Presets

### Default Themes (ship with app)

#### Featured (shown in compact picker)

| Key | Label | Emoji | Category | Vibe |
|-----|-------|-------|----------|------|
| `clean-dark` | **Clean Dark** | `🌑` | minimal | **NEW DEFAULT** — slate-900 bg, gray-100 fg, indigo-500 primary. Inter font. No background. |
| `clean-light` | **Clean Light** | `☀️` | minimal | slate-50 bg, slate-900 fg, indigo-500 primary. Inter font. No background. |
| `neon` | **Neon** | `⚡` | expressive | **CURRENT DESIGN** — #050608 bg, #F1F5F9 fg, #8B5CF6 primary, Space Grotesk font. Includes cyan secondary via custom glow CSS. |
| `midnight` | **Midnight** | `🌃` | atmospheric | Near-black bg, cool white fg, sky blue primary. Inter font. City skyline bg. |
| `forest` | **Forest** | `🌲` | nature | Deep green bg, sage fg, emerald primary. Merriweather font. Forest bg. |
| `ocean` | **Ocean** | `🌊` | nature | Deep teal bg, light cyan fg, aqua primary. Nunito font. Ocean bg. |
| `sunset` | **Sunset** | `🌅` | atmospheric | Warm cream bg, brown fg, coral primary. Lora font. |
| `sakura` | **Sakura** | `🌸` | expressive | Soft pink bg, rose fg, pink primary. Comfortaa font. Blossom bg. |
| `retro` | **Retro** | `💿` | nostalgic | Cream bg, dark text, blue primary. Silkscreen font. Retro bg. |
| `galaxy` | **Galaxy** | `🌌` | atmospheric | Deep purple bg, light text, violet primary. DM Sans font. Galaxy bg. |

#### Additional (shown in full settings gallery)

| Key | Label | Emoji | Category |
|-----|-------|-------|----------|
| `slate` | Slate | `🪨` | minimal |
| `warm` | Warm | `🕯️` | minimal |
| `terminal` | Terminal | `>_` | nostalgic |
| `gamer` | Gamer | `🎮` | expressive |
| `cottage` | Cottage | `🏡` | nature |
| `sky` | Sky | `☁️` | nature |
| `grunge` | Grunge | `🖤` | expressive |
| `paper` | Paper | `📝` | minimal |
| `vapor` | Vaporwave | `🌴` | nostalgic |
| `monochrome` | Monochrome | `◼️` | minimal |

### Checklist: Presets

- [ ] Define all presets in `client/src/lib/themePresets.ts`
- [ ] Ensure each has `colors` (3 HSL values), optional `font`, optional `background`
- [ ] Mark featured presets with `featured: true`
- [ ] Assign categories for filtering in the full gallery
- [ ] The "Neon" preset should reproduce the exact current look (carry over glow/glass behavior)

---

## 8. Font System

### Current
- Single font: Space Grotesk (variable, 300-700), self-hosted in `/fonts/`
- Applied via `:root { font-family: 'Space Grotesk', Inter, system-ui, ... }`

### New Approach

- [ ] **Default font**: Switch to **Inter** (system-level fallback, no download needed on most systems) for the clean default aesthetic. Inter is neutral, highly legible, and contemporary.
- [ ] **`--font-family` CSS variable**: Set by theme engine, consumed by `:root`
- [ ] **Dynamic font loading**: When a preset specifies a custom font:
  1. If the font has a `url`, load it via a dynamically inserted `@font-face`
  2. If the font is a Google Font name (no url), insert a `<link>` tag to Google Fonts
  3. Apply `--font-family` once loaded (with fallback during load)
- [ ] **Font preloading hint**: For the active theme's font, add a `<link rel="preload">` on app start
- [ ] **Bundled fonts**: Keep Space Grotesk bundled (for the "Neon" preset). Consider bundling Inter and one serif (Lora) for offline/Tauri use.

### Checklist: Font Files

- [ ] Create `client/src/lib/fontLoader.ts` — dynamic font loading utility
- [ ] Update `index.css` `:root` to use `var(--font-family, 'Inter', system-ui, sans-serif)`
- [ ] Keep `@font-face` for Space Grotesk (used by Neon preset)
- [ ] Add `@font-face` for Inter (bundled for Tauri offline)

---

## 9. Background System

### Implementation

Theme backgrounds are rendered as a fixed full-bleed layer behind the app, with an overlay for readability.

- [ ] **Create `client/src/components/layout/ThemeBackground.tsx`**:
  - Renders a `position: fixed; inset: 0; z-index: -1` container
  - For images: `<img>` with `object-fit: cover` (or `background-size: cover` for tile)
  - For videos: `<video autoPlay muted loop>` with cover fit
  - Blurhash placeholder while loading (use `blurhash` package or `ThumbHash`)
  - Semi-transparent overlay on top: `hsl(var(--color-background) / 0.85)` for readability
- [ ] **Insert `<ThemeBackground />` in `Layout.tsx`** before the main content
- [ ] **Adjust glass morphism**: When a background image is active, glass panels should use more blur and more transparency
- [ ] **No background by default**: Clean Dark and Clean Light have no background image

---

## 10. New Default Aesthetic

### Color Palette: "Clean Dark" (New Default)

```
Background:  220 14% 8%     → #111318  (softer than current #050608)
Foreground:  220 14% 92%    → #E8EAED  (slightly warm gray, not pure white)
Primary:     235 55% 58%    → #5B6ABF  (muted indigo — not violet, not neon)
```

Derived tokens from this palette:
- Panel: slightly lighter background
- Card: +6% lighter
- Text hierarchy: gentle fade from near-white to mid-gray
- Borders: very subtle, ~15% toward foreground
- Shadows: barely there — `0 1px 3px rgba(0,0,0,0.1)` style

### Color Palette: "Clean Light" (Light Default)

```
Background:  220 14% 97%    → #F5F6F8
Foreground:  220 14% 10%    → #171A1E
Primary:     235 55% 52%    → #4A59B5
```

### Visual Characteristics

- [ ] **No glows by default** — glow effects are theme-specific (Neon, Gamer, etc.)
- [ ] **Thin 1px borders** — `border-color: hsl(var(--color-border))` with low contrast
- [ ] **Subtle shadows** — replace current heavy `--shadow-card` with lighter defaults:
  ```
  --shadow-sm: 0 1px 2px hsl(var(--color-background) / 0.05);
  --shadow-md: 0 2px 8px hsl(var(--color-background) / 0.08);
  --shadow-lg: 0 8px 24px hsl(var(--color-background) / 0.12);
  ```
- [ ] **No glass morphism by default** — `.glass` becomes a simple solid background in the clean themes. Themes can opt into blur via a `--glass-blur` token.
- [ ] **Rounded corners**: Keep current radii but slightly reduce: `--radius-sm: 6px`, `--radius-md: 8px`, `--radius-lg: 12px`, `--radius-xl: 16px`
- [ ] **Typography**: Inter variable, regular weight (400) for body, medium (500) for labels, semibold (600) for headings. Tighter line-height (1.45 vs current 1.55).
- [ ] **Spacing**: More generous padding in cards and panels. Increase default card padding from `p-4` to `p-5`.
- [ ] **Active states**: Solid primary background tint instead of glows. `bg-primary/10` for selected items.

---

## 11. Component Redesign Checklist

### UI Primitives (`client/src/components/ui/`)

#### Button.tsx
- [ ] Remove hardcoded `rgba(139,92,246,...)` shadow values from all variants
- [ ] Replace with `hsl(var(--color-primary) / 0.25)` pattern
- [ ] Simplify primary variant: solid `bg-primary text-primary-fg` (no gradient by default)
- [ ] Add `gradient` as an optional prop for themes that want it
- [ ] Rename `neon` variant → `accent` (works regardless of theme)
- [ ] Update focus ring to use `--color-ring`
- [ ] Default hover: subtle `brightness` shift or `bg-primary/90` instead of glow

#### Avatar.tsx
- [ ] Update fallback gradient to use `--color-primary` and `--color-primary-soft`
- [ ] Update ring color from `ring-edge` to `ring-border`

#### Modal.tsx
- [ ] Update backdrop from `bg-black/70` to `hsl(var(--color-background) / 0.8)`
- [ ] Update content styling to use new card tokens

#### PopoverMenu.tsx
- [ ] Rename `card-glass` usage → ensure it reads new tokens
- [ ] Update `z-40`/`z-50` to use z-index tokens (see section 15)
- [ ] Update border colors from `edge` → `border`

#### MagicCard.tsx
- [ ] Replace hardcoded `#1a1a2e`, `#8B5CF6`, `#00F0FF` with theme variables
- [ ] Use `--color-primary` for gradient colors
- [ ] Make gradient effect configurable (disabled in clean themes)

#### ShimmerButton.tsx
- [ ] Replace hardcoded `#00F0FF` shimmer color with `var(--color-primary)`
- [ ] Replace hardcoded `rgba(139, 92, 246, ...)` with primary variable references
- [ ] Update inset shadow white values to use `var(--color-heading)`

#### TextAnimate.tsx
- [ ] No color changes needed (inherits from parent)

#### MediaLightbox.tsx
- [ ] Update `bg-black/90` backdrop to `hsl(var(--color-background) / 0.95)`
- [ ] Update control colors from hardcoded white to `--color-heading`

#### ImageUpload.tsx
- [ ] Update border colors and hover states to use theme tokens

#### BlockedMessage.tsx
- [ ] Update background and text colors to use theme tokens

#### Spinner.tsx
- [ ] Ensure spinner color uses `--color-primary`

### Layout Components (`client/src/components/layout/`)

#### Sidebar.tsx
- [ ] Replace `glass` class usage → should work with new glass variables
- [ ] Rename `neon-bar-left` → `active-bar-left`
- [ ] Update all `bg-pulse/15` active states → `bg-primary/10`
- [ ] Update `text-neon`, `text-pulse` → `text-primary`, `text-primary-soft`
- [ ] Update `border-edge` → `border-border`
- [ ] Simplify active item styling: solid primary tint, no glow

#### TopBar.tsx
- [ ] Replace theme toggle button (Sun/Moon) with theme preset dropdown
- [ ] Add quick cycle button (cycles through featured presets)
- [ ] Update `glass` class usage
- [ ] Rename `neon`/`pulse` color references → `primary` variants

#### CenterPanel.tsx
- [ ] Update background reference from `backdrop` → `background`

#### RightPanel.tsx
- [ ] Same token renames as Sidebar
- [ ] Update `glass` class usage
- [ ] Update resize handle styling

#### RightPanelTabBar.tsx
- [ ] Update active tab indicator from neon glow → solid primary underline/tint

### Layout Root

#### Layout.tsx
- [ ] Remove `bg-ambient animate-gradient-shift` from root div (move ambient to theme-specific)
- [ ] Add `<ThemeBackground />` component
- [ ] Update root div: `bg-background` (using new variable)

#### App.tsx
- [ ] Keep ThemeProvider wrapping (now with expanded capabilities)

### Feature Components

Each feature folder needs the same systematic token renames. Here's the per-feature checklist:

#### Chat (`features/chat/`)
- [ ] `ChatView.tsx` — Update background, border colors
- [ ] `ChatMessage.tsx` — Update hover states, highlight flash, text colors
- [ ] `ChatInput.tsx` — Replace `rgba(139,92,246,0.1)` focus shadow → `hsl(var(--color-primary) / 0.1)` shadow
- [ ] `ChatEditBanner.tsx` — Update banner colors
- [ ] `ChatReply.tsx` — Update reply indicator colors
- [ ] `ChatMessageContextMenu.tsx` — Update menu styling

#### DM (`features/dm/`)
- [ ] `DMConversation.tsx` — Token renames
- [ ] `DMMessage.tsx` — Match ChatMessage updates
- [ ] `DMInput.tsx` — Match ChatInput updates
- [ ] `DMSidebar.tsx` — Update active item styling (no glow)
- [ ] `DMContactPanel.tsx` — Token renames
- [ ] `DMView.tsx` — Token renames
- [ ] `DMConversationContextMenu.tsx` — Token renames
- [ ] `DMMessageContextMenu.tsx` — Token renames
- [ ] `NewDMModal.tsx` — Token renames

#### Identity (`features/identity/`)
- [ ] `LoginScreen.tsx` — Major visual update needed:
  - Replace cyberpunk aesthetic with clean, centered layout
  - Remove `rgba(139,92,246,0.1)` focus shadow
  - Update gradient usage
  - Simplify — the login screen sets first impression
- [ ] `ProfileCard.tsx` — Update colors and borders

#### Music (`features/music/` — **largest, ~59 files**)
- [ ] **PlaybackBar.tsx** — Replace `fill-red-500` heart → use `--color-destructive` or keep red as semantic
- [ ] **playbackBar/MiniBar.tsx** — Replace `rgba(139, 92, 246, 0.2)` progress ring → `hsl(var(--color-primary) / 0.2)`
- [ ] **playbackBar/ExpandedBar.tsx** — Token renames throughout
- [ ] **playbackBar/FloatingPlaybackBar.tsx** — Update glass styling
- [ ] **playbackBar/NowPlayingOverlay.tsx** — Update backdrop blur
- [ ] **playbackBar/ProgressBar.tsx** — Update track/fill colors
- [ ] **panel/ActionsTab.tsx** — Replace `fill-red-500` → semantic red
- [ ] **panel/useWaveform.ts** — Replace hardcoded `[139, 92, 246]` fallback → read from CSS variable
- [ ] **TrackCard.tsx** — Replace `fill-red-500`, update card styling
- [ ] **AlbumCard.tsx** — Update card styling
- [ ] **SearchInput.tsx** — Replace hardcoded focus shadow
- [ ] **All view files** (`views/*.tsx`) — Systematic token renames
- [ ] **All modal files** — Update modal styling
- [ ] **InsightsChart.tsx** — Update chart colors to use primary

#### Media (`features/media/`)
- [ ] `VideoCard.tsx` — Replace `rgba(139,92,246,0.4)` glow → primary variable
- [ ] `EnhancedVideoPlayer.tsx` — Update control colors
- [ ] `ReelsView.tsx` — Update overlay colors
- [ ] `VideoPlayer.tsx` — Minimal changes

#### Profile (`features/profile/`)
- [ ] `ProfilePage.tsx` — Token renames, update gradient usage
- [ ] `ProfileSidePanel.tsx` — Token renames
- [ ] `ProfileEditModal.tsx` — Update form styling
- [ ] `UserPopoverCard.tsx` — Replace hardcoded `rgba(255,255,255,0.04)`, `var(--shadow-elevated)` inline styles → use CSS classes
- [ ] `NoteCard.tsx` — Update card styling, animation delays
- [ ] `NoteComposer.tsx` — Update input styling
- [ ] `FollowCard.tsx` — Token renames
- [ ] `FollowListModal.tsx` — Token renames
- [ ] `PinnedNotesSection.tsx` — Token renames
- [ ] `RepostHeader.tsx` — Token renames

#### Spaces (`features/spaces/` — **~39 files**)
- [ ] `SpaceView.tsx` — Token renames, active channel styling
- [ ] `SpaceList.tsx` — Update list item hover/active states
- [ ] `ChannelPanel.tsx` — Token renames
- [ ] `ChannelList.tsx` — Update active channel indicator (remove neon bar → solid primary tint)
- [ ] `ChannelHeader.tsx` — Token renames
- [ ] `MemberList.tsx` — Token renames
- [ ] `SpaceInfoPanel.tsx` — Token renames
- [ ] `MediaFeed.tsx` — Replace hardcoded `#0a0a1a` → `var(--color-background)`
- [ ] `FeedToolbar.tsx` — Update active tab indicator
- [ ] `NotesFeed.tsx` — Token renames
- [ ] All modal files (`Create*.tsx`, `Join*.tsx`, `Invite*.tsx`) — Token renames
- [ ] `moderation/ModerationTab.tsx` — Token renames
- [ ] `moderation/MemberContextMenu.tsx` — Token renames
- [ ] `notes/*.tsx` (5 files) — Token renames
- [ ] **`settings/RolesTab.tsx`** — The hardcoded role color palette `["#ef4444", ...]` is fine to keep (these are user-chosen role colors, not theme colors)
- [ ] **`settings/MembersTab.tsx`** — Replace hardcoded `#6b7280` fallback → `var(--color-muted)` or `hsl(var(--color-soft))`
- [ ] `settings/GeneralTab.tsx` — Token renames
- [ ] `settings/ChannelsTab.tsx` — Token renames
- [ ] `settings/SpaceSettingsModal.tsx` — Token renames
- [ ] `settings/NotificationsTab.tsx` — Token renames
- [ ] `settings/ChannelOverridesPanel.tsx` — Token renames

#### Voice (`features/voice/`)
- [ ] `VoiceChannel.tsx` — Update backdrop blur, border colors
- [ ] `ParticipantTile.tsx` — Token renames
- [ ] `VoiceControls.tsx` — Token renames
- [ ] `VoiceStatusBar.tsx` — Token renames
- [ ] `VoiceParticipant.tsx` — Token renames
- [ ] `VoiceChannelPreview.tsx` — Token renames
- [ ] `PreJoinModal.tsx` — Token renames
- [ ] `ScreenShareView.tsx` — Token renames
- [ ] `VideoGrid.tsx` — Token renames

#### Calling (`features/calling/`)
- [ ] `CallController.tsx` — Token renames
- [ ] `CallControls.tsx` — Token renames, button colors
- [ ] `IncomingCallModal.tsx` — Update backdrop, button styling

#### Notifications (`features/notifications/`)
- [ ] `NotificationBell.tsx` — Update badge color (keep red as semantic)
- [ ] `NotificationToast.tsx` — Update toast styling to match new aesthetic

#### Settings (`features/settings/`)
- [ ] `SettingsPage.tsx` — Token renames
- [ ] `AppSettingsTab.tsx` — **Major rewrite** → new theme picker UI (see section 13)
- [ ] `ProfileSettingsTab.tsx` — Token renames
- [ ] `NotificationSettingsTab.tsx` — Token renames
- [ ] `RelaySettingsTab.tsx` — Token renames
- [ ] `SecuritySettingsTab.tsx` — Token renames

#### Longform (`features/longform/`)
- [ ] `ArticleCard.tsx` — Token renames
- [ ] `ArticleReader.tsx` — Update reading area styling (more generous whitespace, better typography)
- [ ] `LongFormView.tsx` — Token renames

#### Listen Together (`features/listenTogether/`)
- [ ] All 10 files — Token renames, update glow effects to use primary variable
- [ ] `ReactionOverlay.tsx` — Keep animation, update colors

#### Search (`features/search/`)
- [ ] `UserSearchInput.tsx` — Replace hardcoded focus shadow
- [ ] `UserSearchResultItem.tsx` — Token renames

#### Relay (`features/relay/`)
- [ ] `RelayStatusBadge.tsx` — Keep semantic colors (green/yellow/red), update badge frame styling
- [ ] `RelayStatusPanel.tsx` — Token renames

#### Emoji (`features/emoji/`)
- [ ] `EmojiSetManager.tsx` — Token renames

---

## 12. Hardcoded Color Remediation

### Priority 1: Hardcoded Theme Colors (must fix)

These are instances where the theme's accent color is baked in as a literal:

| Pattern | Count | Replace With |
|---------|-------|-------------|
| `rgba(139, 92, 246, X)` (violet) | ~15 | `hsl(var(--color-primary) / X)` |
| `rgba(0, 240, 255, X)` (cyan) | ~8 | Remove (no secondary accent) or `hsl(var(--color-primary-soft) / X)` |
| `#8B5CF6` / `#A78BFA` | ~5 | `var(--color-primary)` / `var(--color-primary-soft)` |
| `#00F0FF` / `#67F7FF` | ~3 | `var(--color-primary-soft)` |
| `#1a1a2e` | 1 | `var(--color-panel)` |
| `#0a0a1a` | 2 | `var(--color-background)` |

### Priority 2: Tailwind Hardcoded Colors (should fix)

| Pattern | Context | Replace With |
|---------|---------|-------------|
| `text-white` | Over colored backgrounds | `text-primary-fg` (theme-aware) |
| `bg-black/X` | Overlays, backdrops | `bg-background/X` |
| `bg-white/X` | Glass surfaces | `bg-heading/X` (invert-safe) |
| `text-red-500` | Error/destructive | `text-destructive` |
| `bg-red-500` | Error buttons | `bg-destructive` |
| `text-green-500` | Success indicators | `text-success` |
| `bg-green-500` | Online status | `bg-success` |
| `text-amber-400` | Warnings | `text-warning` |

### Priority 3: Acceptable Hardcoded Colors (leave as-is)

| Pattern | Reason |
|---------|--------|
| Role color palette in `RolesTab.tsx` | User-chosen, not theme colors |
| `fill-red-500` for heart/like icons | Universal semantic meaning |
| SVG stroke colors for custom illustrations | Content, not chrome |

### Checklist: Remediation

- [ ] Global find-replace `rgba(139, 92, 246` → `hsl(var(--color-primary) /` (with appropriate closing)
- [ ] Global find-replace `rgba(0, 240, 255` → `hsl(var(--color-primary-soft) /`
- [ ] Replace `bg-black/` with `bg-background/` where used as overlay
- [ ] Replace `text-white` with `text-heading` or `text-primary-fg` contextually
- [ ] Add `--color-destructive`, `--color-success`, `--color-warning` tokens
- [ ] Create Tailwind utility classes for semantic colors

---

## 13. Settings UI — Theme Picker

### New Theme Settings Section

Replace the current dark/light toggle in `AppSettingsTab.tsx` with a full theme configuration panel.

#### Quick Picker (also in TopBar dropdown)
- Grid of featured theme swatches (8-10)
- Each swatch shows: background color, primary dot, emoji, label
- Click to apply immediately
- "See all" link → full gallery

#### Full Gallery (Settings page)
- All presets organized by category tabs (Minimal, Atmospheric, Expressive, Nostalgic, Nature)
- Larger preview cards with font sample + bg thumbnail
- Search/filter
- "Custom" card → opens custom theme editor

#### Custom Theme Editor
- 3 color pickers (background, foreground, primary) with HSL sliders
- Live preview swatch
- Font selector (dropdown of curated fonts + custom URL input)
- Background image upload/URL input
- "Reset to default" button
- Import/export as JSON (prep for Nostr event publishing)

#### Light/Dark/System Toggle
- Moved into the theme picker header as a mode selector
- "System" option auto-switches between light and dark variants of the active preset

### New Files

- [ ] `client/src/features/settings/ThemeSettingsTab.tsx` — Full gallery + custom editor
- [ ] `client/src/features/settings/ThemePresetCard.tsx` — Individual preset preview card
- [ ] `client/src/features/settings/ThemeCustomEditor.tsx` — 3-color picker + font + bg
- [ ] `client/src/components/ui/ColorPicker.tsx` — HSL color picker component
- [ ] `client/src/components/layout/ThemeQuickPicker.tsx` — Compact dropdown for TopBar

### Existing Files to Update

- [ ] `AppSettingsTab.tsx` — Replace theme section with link to new ThemeSettingsTab (or embed it)
- [ ] `SettingsPage.tsx` — Add "Appearance" tab routing to ThemeSettingsTab
- [ ] `TopBar.tsx` — Replace Sun/Moon toggle with theme quick picker dropdown

---

## 14. Animation & Micro-interaction Refinement

### Current State
- Heavy glow animations (`pulse-glow`, `neon-breathe`)
- Glass shimmer effects
- Gradient shifting backgrounds (`animate-gradient-shift`)
- Mouse-tracking gradients (MagicCard)

### New Default
- **Reduce motion intensity**: Clean theme should feel calm
- **Keep structural animations**: `fade-in-up`, `slide-up` are fine
- **Remove ambient animations by default**: `animate-gradient-shift` only for themes that opt in
- **Simplify hover states**: `translateY(-1px)` instead of `-2px` + shadow change

### Per-Theme Animation Tokens

Add a CSS custom property that themes can use to dial animation intensity:

```css
:root {
  --motion-intensity: 0.5;  /* 0 = none, 0.5 = subtle, 1 = full */
}
```

Themes set this:
- Clean Dark/Light: `0.5` (subtle)
- Neon: `1.0` (full glows, ambient animation)
- Paper: `0.2` (barely any)
- Gamer: `1.0` (full)

### Checklist: Animations

- [ ] Gate `bg-ambient animate-gradient-shift` behind a theme flag
- [ ] Make `.hover-lift` respect `--motion-intensity` (reduce translateY amount)
- [ ] Make `.glow-*` effects opacity respect `--motion-intensity`
- [ ] Keep `prefers-reduced-motion` media query support
- [ ] Simplify default hover: `opacity` or `brightness` change instead of transform + shadow

---

## 15. Z-Index & Layering System

### Define Explicit Layers

```css
:root {
  --z-base: 0;
  --z-elevated: 10;      /* Cards, raised content */
  --z-sticky: 20;        /* Sticky headers, resize handles */
  --z-dropdown: 30;      /* Dropdowns, popovers */
  --z-overlay: 40;       /* Modal backdrops, overlays */
  --z-modal: 50;         /* Modal content */
  --z-toast: 60;         /* Notification toasts */
  --z-lightbox: 100;     /* Fullscreen media viewer */
}
```

### Checklist

- [ ] Define z-index scale in `index.css`
- [ ] Audit all `z-*` usage (49 files) and replace with scale values
- [ ] Document which layer each component type belongs to

---

## 16. Spacing & Layout Tokens

### Keep the current spacing scale (Tailwind default is fine)

No changes needed to the spacing system — Tailwind's default scale works well.

### Layout Token Updates

- [ ] Keep `--top-bar-height`, `--bottom-nav-height` variables
- [ ] Add `--sidebar-width` as a CSS variable (currently controlled by JS state)
- [ ] Keep all safe-area utilities unchanged

---

## 17. Accessibility

### Checklist

- [ ] Ensure all theme presets maintain WCAG AA contrast ratios (4.5:1 for text, 3:1 for large text)
- [ ] Add contrast validation to `deriveTokens()` — warn or auto-adjust if derived heading color doesn't meet 4.5:1 against background
- [ ] Keep `prefers-reduced-motion` support
- [ ] Ensure focus indicators (`--color-ring`) are visible on all theme backgrounds
- [ ] Test with `prefers-color-scheme` for system theme
- [ ] Ensure background images don't make text unreadable (overlay opacity)

---

## 18. Migration Strategy

### Phase 1: Theme Engine (no visual changes yet)
1. Create `themeEngine.ts`, `themeTypes.ts`, `themePresets.ts`
2. Create `deriveTokens()` function with tests
3. Create expanded `ThemeContext` with backward compatibility
4. Wire up token injection to `:root`
5. Verify current dark/light themes still look identical

### Phase 2: Token Rename (mechanical, low risk)
1. Rename CSS variables in `index.css`
2. Global find-replace in all components:
   - `backdrop` → `background`
   - `edge` → `border`
   - `pulse` → `primary`
   - `neon` → `primary-soft` (or remove)
3. Update Tailwind `@theme` registration
4. Verify no visual regressions

### Phase 3: Hardcoded Color Fix
1. Replace all `rgba(139, 92, 246, ...)` with `hsl(var(--color-primary) / ...)`
2. Replace `bg-black/`, `text-white`, etc. with semantic tokens
3. Add destructive/success/warning tokens

### Phase 4: New Default Theme
1. Define "Clean Dark" and "Clean Light" core colors
2. Switch default from current cyberpunk → Clean Dark
3. Add current look as "Neon" preset
4. Refine glass/glow/shadow behavior for clean theme

### Phase 5: Theme UI
1. Build preset gallery in settings
2. Build quick picker in TopBar
3. Build custom theme editor
4. Add font loading system
5. Add background system

### Phase 6: Polish
1. Per-theme animation intensity
2. Accessibility validation
3. Test all presets across all pages
4. Performance optimization (font preloading, image lazy-loading)

---

## 19. File-by-File Change Map

### New Files to Create

| File | Purpose |
|------|---------|
| `client/src/lib/themeEngine.ts` | HSL parsing, token derivation, CSS injection |
| `client/src/lib/themeTypes.ts` | CoreColors, ThemeConfig, ThemePreset types |
| `client/src/lib/themePresets.ts` | All preset definitions |
| `client/src/lib/fontLoader.ts` | Dynamic font loading |
| `client/src/components/layout/ThemeBackground.tsx` | Background image/video layer |
| `client/src/components/layout/ThemeQuickPicker.tsx` | TopBar theme dropdown |
| `client/src/components/ui/ColorPicker.tsx` | HSL color picker |
| `client/src/features/settings/ThemeSettingsTab.tsx` | Full theme gallery + editor |
| `client/src/features/settings/ThemePresetCard.tsx` | Preset preview card |
| `client/src/features/settings/ThemeCustomEditor.tsx` | Custom theme builder |

### Files to Heavily Modify

| File | Changes |
|------|---------|
| `client/src/index.css` | Complete rewrite of token system, rename variables, update all utility classes |
| `client/src/contexts/ThemeContext.tsx` | Complete rewrite — mode + preset + custom + font + background |
| `client/src/styles/theme.ts` | Remove or replace with re-export from themeTypes |
| `client/src/features/settings/AppSettingsTab.tsx` | Replace theme section with new picker |
| `client/src/components/layout/TopBar.tsx` | Replace toggle with quick picker |
| `client/src/components/ui/Button.tsx` | Remove hardcoded shadows, update variants |
| `client/src/components/ui/MagicCard.tsx` | Replace all hardcoded colors |
| `client/src/components/ui/ShimmerButton.tsx` | Replace all hardcoded colors |
| `client/src/features/identity/LoginScreen.tsx` | Visual redesign for clean aesthetic |
| `client/src/app/Layout.tsx` | Add ThemeBackground, remove hardcoded ambient |

### Files Needing Token Renames (Systematic)

Every file below needs `pulse` → `primary`, `neon` → `primary-soft`, `edge` → `border`, `backdrop` → `background` renames in Tailwind classes:

**Components:**
- [ ] `components/ui/Avatar.tsx`
- [ ] `components/ui/Modal.tsx`
- [ ] `components/ui/PopoverMenu.tsx`
- [ ] `components/ui/MediaLightbox.tsx`
- [ ] `components/ui/ImageUpload.tsx`
- [ ] `components/ui/BlockedMessage.tsx`
- [ ] `components/ui/Spinner.tsx`
- [ ] `components/layout/Sidebar.tsx`
- [ ] `components/layout/CenterPanel.tsx`
- [ ] `components/layout/RightPanel.tsx`
- [ ] `components/layout/RightPanelTabBar.tsx`

**Chat (6 files):**
- [ ] `features/chat/ChatView.tsx`
- [ ] `features/chat/ChatMessage.tsx`
- [ ] `features/chat/ChatInput.tsx`
- [ ] `features/chat/ChatEditBanner.tsx`
- [ ] `features/chat/ChatReply.tsx`
- [ ] `features/chat/ChatMessageContextMenu.tsx`

**DM (9 files):**
- [ ] `features/dm/DMConversation.tsx`
- [ ] `features/dm/DMMessage.tsx`
- [ ] `features/dm/DMInput.tsx`
- [ ] `features/dm/DMSidebar.tsx`
- [ ] `features/dm/DMContactPanel.tsx`
- [ ] `features/dm/DMView.tsx`
- [ ] `features/dm/DMConversationContextMenu.tsx`
- [ ] `features/dm/DMMessageContextMenu.tsx`
- [ ] `features/dm/NewDMModal.tsx`

**Identity (2 files):**
- [ ] `features/identity/LoginScreen.tsx`
- [ ] `features/identity/ProfileCard.tsx`

**Music (50+ files):**
- [ ] `features/music/PlaybackBar.tsx`
- [ ] `features/music/TrackCard.tsx`
- [ ] `features/music/AlbumCard.tsx`
- [ ] `features/music/SearchInput.tsx`
- [ ] `features/music/GenreCard.tsx`
- [ ] `features/music/GenrePicker.tsx`
- [ ] `features/music/InsightsChart.tsx`
- [ ] `features/music/MusicSidebar.tsx`
- [ ] `features/music/NowPlayingDetail.tsx`
- [ ] `features/music/QueueContent.tsx`
- [ ] `features/music/TrackRow.tsx`
- [ ] `features/music/TrackActionPanel.tsx`
- [ ] `features/music/AnnotationCard.tsx`
- [ ] `features/music/AnnotationComposer.tsx`
- [ ] `features/music/AnnotationsPanel.tsx`
- [ ] `features/music/FeaturedArtistsDisplay.tsx`
- [ ] `features/music/FeaturedArtistsInput.tsx`
- [ ] `features/music/HashtagInput.tsx`
- [ ] `features/music/VisibilityPicker.tsx`
- [ ] `features/music/UpdateAvailableBadge.tsx`
- [ ] `features/music/MusicLinkResolver.tsx`
- [ ] `features/music/ProposalCard.tsx`
- [ ] `features/music/RevisionCard.tsx`
- [ ] `features/music/DuplicateTrackModal.tsx`
- [ ] `features/music/ReleaseNotesModal.tsx`
- [ ] All modal files (Create*, Edit*, Move*, Replace*, Upload*, AddTo*)
- [ ] `features/music/panel/ActionsTab.tsx`
- [ ] `features/music/panel/AudioTab.tsx`
- [ ] `features/music/panel/HistoryTab.tsx`
- [ ] `features/music/panel/NotesTab.tsx`
- [ ] `features/music/panel/PanelHeader.tsx`
- [ ] `features/music/panel/useWaveform.ts`
- [ ] `features/music/playbackBar/ExpandedBar.tsx`
- [ ] `features/music/playbackBar/FloatingPlaybackBar.tsx`
- [ ] `features/music/playbackBar/MiniBar.tsx`
- [ ] `features/music/playbackBar/NowPlayingOverlay.tsx`
- [ ] `features/music/playbackBar/ProgressBar.tsx`
- [ ] `features/music/views/AlbumDetail.tsx`
- [ ] `features/music/views/AlbumGrid.tsx`
- [ ] `features/music/views/ArtistDetail.tsx`
- [ ] `features/music/views/ArtistList.tsx`
- [ ] `features/music/views/ExploreMusic.tsx`
- [ ] `features/music/views/FavoritesList.tsx`
- [ ] `features/music/views/InsightsDashboard.tsx`
- [ ] `features/music/views/MusicHome.tsx`
- [ ] `features/music/views/MyUploads.tsx`
- [ ] `features/music/views/PlaylistDetail.tsx`
- [ ] `features/music/views/PlaylistList.tsx`
- [ ] `features/music/views/ProjectHistory.tsx`
- [ ] `features/music/views/ProjectProposals.tsx`
- [ ] `features/music/views/RecentlyAdded.tsx`
- [ ] `features/music/views/SearchResults.tsx`
- [ ] `features/music/views/SongList.tsx`

**Media (4 files):**
- [ ] `features/media/VideoCard.tsx`
- [ ] `features/media/EnhancedVideoPlayer.tsx`
- [ ] `features/media/ReelsView.tsx`
- [ ] `features/media/VideoPlayer.tsx`

**Profile (11 files):**
- [ ] `features/profile/ProfilePage.tsx`
- [ ] `features/profile/ProfileSidePanel.tsx`
- [ ] `features/profile/ProfileEditModal.tsx`
- [ ] `features/profile/UserPopoverCard.tsx`
- [ ] `features/profile/NoteCard.tsx`
- [ ] `features/profile/NoteComposer.tsx`
- [ ] `features/profile/FollowCard.tsx`
- [ ] `features/profile/FollowListModal.tsx`
- [ ] `features/profile/PinnedNotesSection.tsx`
- [ ] `features/profile/RepostHeader.tsx`
- [ ] `features/profile/UserPopoverContext.tsx`

**Spaces (27 files):**
- [ ] `features/spaces/SpaceView.tsx`
- [ ] `features/spaces/SpaceList.tsx`
- [ ] `features/spaces/ChannelPanel.tsx`
- [ ] `features/spaces/ChannelList.tsx`
- [ ] `features/spaces/ChannelHeader.tsx`
- [ ] `features/spaces/ChannelContextMenu.tsx`
- [ ] `features/spaces/MemberList.tsx`
- [ ] `features/spaces/SpaceInfoPanel.tsx`
- [ ] `features/spaces/SpaceContextMenu.tsx`
- [ ] `features/spaces/SpaceActionModal.tsx`
- [ ] `features/spaces/MediaFeed.tsx`
- [ ] `features/spaces/FeedToolbar.tsx`
- [ ] `features/spaces/NotesFeed.tsx`
- [ ] `features/spaces/LoadMoreButton.tsx`
- [ ] `features/spaces/CreateChannelModal.tsx`
- [ ] `features/spaces/CreateSpaceModal.tsx`
- [ ] `features/spaces/InviteGenerateModal.tsx`
- [ ] `features/spaces/JoinSpaceModal.tsx`
- [ ] `features/spaces/moderation/ModerationTab.tsx`
- [ ] `features/spaces/moderation/MemberContextMenu.tsx`
- [ ] `features/spaces/notes/NoteActionBar.tsx`
- [ ] `features/spaces/notes/QuotedNote.tsx`
- [ ] `features/spaces/notes/ReplyComposer.tsx`
- [ ] `features/spaces/notes/ReplyIndicator.tsx`
- [ ] `features/spaces/notes/ThreadView.tsx`
- [ ] `features/spaces/settings/GeneralTab.tsx`
- [ ] `features/spaces/settings/ChannelsTab.tsx`
- [ ] `features/spaces/settings/MembersTab.tsx`
- [ ] `features/spaces/settings/RolesTab.tsx`
- [ ] `features/spaces/settings/SpaceSettingsModal.tsx`
- [ ] `features/spaces/settings/NotificationsTab.tsx`
- [ ] `features/spaces/settings/ChannelOverridesPanel.tsx`

**Voice (9 files):**
- [ ] `features/voice/VoiceChannel.tsx`
- [ ] `features/voice/ParticipantTile.tsx`
- [ ] `features/voice/VoiceControls.tsx`
- [ ] `features/voice/VoiceStatusBar.tsx`
- [ ] `features/voice/VoiceParticipant.tsx`
- [ ] `features/voice/VoiceChannelPreview.tsx`
- [ ] `features/voice/PreJoinModal.tsx`
- [ ] `features/voice/ScreenShareView.tsx`
- [ ] `features/voice/VideoGrid.tsx`

**Calling (3 files):**
- [ ] `features/calling/CallController.tsx`
- [ ] `features/calling/CallControls.tsx`
- [ ] `features/calling/IncomingCallModal.tsx`

**Listen Together (10 files):**
- [ ] `features/listenTogether/NowPlayingPanel.tsx`
- [ ] `features/listenTogether/NowPlayingStrip.tsx`
- [ ] `features/listenTogether/ListenTogetherBadge.tsx`
- [ ] `features/listenTogether/ListenTogetherInvite.tsx`
- [ ] `features/listenTogether/ListenTogetherPicker.tsx`
- [ ] `features/listenTogether/CallNowPlaying.tsx`
- [ ] `features/listenTogether/DJTransferModal.tsx`
- [ ] `features/listenTogether/ReactionOverlay.tsx`
- [ ] `features/listenTogether/VolumeBalance.tsx`
- [ ] `features/listenTogether/VoteSkipButton.tsx`

**Longform (3 files):**
- [ ] `features/longform/ArticleCard.tsx`
- [ ] `features/longform/ArticleReader.tsx`
- [ ] `features/longform/LongFormView.tsx`

**Search (2 files):**
- [ ] `features/search/UserSearchInput.tsx`
- [ ] `features/search/UserSearchResultItem.tsx`

**Relay (2 files):**
- [ ] `features/relay/RelayStatusBadge.tsx`
- [ ] `features/relay/RelayStatusPanel.tsx`

**Notifications (2 files):**
- [ ] `features/notifications/NotificationBell.tsx`
- [ ] `features/notifications/NotificationToast.tsx`

**Settings (6 files):**
- [ ] `features/settings/SettingsPage.tsx`
- [ ] `features/settings/AppSettingsTab.tsx`
- [ ] `features/settings/ProfileSettingsTab.tsx`
- [ ] `features/settings/NotificationSettingsTab.tsx`
- [ ] `features/settings/RelaySettingsTab.tsx`
- [ ] `features/settings/SecuritySettingsTab.tsx`

**Emoji (1 file):**
- [ ] `features/emoji/EmojiSetManager.tsx`

---

## Summary

| Category | Files | Effort |
|----------|-------|--------|
| New theme engine (types, derivation, presets) | 3 new | High |
| New ThemeContext rewrite | 1 rewrite | High |
| New Settings UI (gallery, editor, picker) | 5 new | High |
| New supporting components (ColorPicker, ThemeBackground) | 3 new | Medium |
| CSS overhaul (index.css) | 1 rewrite | High |
| Layout updates (Layout, TopBar, Sidebar) | 5 modify | Medium |
| UI primitive updates (Button, Modal, etc.) | 11 modify | Medium |
| Feature component token renames | ~150 modify | Medium (mechanical) |
| Hardcoded color remediation | ~30 files | Medium |
| Font system | 2 new + 1 modify | Medium |
| Animation refinement | ~10 modify | Low |
| **Total** | **~10 new, ~200 modify** | |

### Token Rename Quick Reference

For the mechanical rename pass across ~150 files:

| Find (Tailwind class) | Replace |
|------------------------|---------|
| `bg-backdrop` | `bg-background` |
| `text-pulse` | `text-primary` |
| `bg-pulse` | `bg-primary` |
| `border-pulse` | `border-primary` |
| `text-pulse-soft` | `text-primary-soft` |
| `bg-pulse-soft` | `bg-primary-soft` |
| `text-neon` | `text-primary` (or `text-primary-soft` in accents) |
| `bg-neon` | `bg-primary` |
| `border-neon` | `border-primary` |
| `text-neon-soft` | `text-primary-soft` |
| `border-edge` | `border-border` |
| `bg-edge` | `bg-border` |
| `border-edge-light` | `border-border-light` |
| `glow-neon` | `glow-primary` |
| `glow-neon-strong` | `glow-primary-strong` |
| `glow-accent` | `glow-primary` |
| `glow-dual` | `glow-primary` |
| `neon-bar-left` | `active-bar-left` |
| `ring-edge` | `ring-border` |
| `divide-edge` | `divide-border` |
