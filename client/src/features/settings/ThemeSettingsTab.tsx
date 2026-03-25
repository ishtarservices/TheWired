import { useState } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "../../contexts/ThemeContext";
import { PRESETS, CATEGORIES } from "../../lib/themePresets";
import { ThemePresetCard } from "./ThemePresetCard";
import { ThemeCustomEditor } from "./ThemeCustomEditor";
import type { ThemeMode } from "../../lib/themeTypes";

const MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

export function ThemeSettingsTab() {
  const { preset, setPreset, mode, setMode } = useTheme();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [showCustom, setShowCustom] = useState(preset === "custom");

  const presets = Object.values(PRESETS);
  const filtered =
    activeCategory === "all"
      ? presets
      : presets.filter((p) => p.category === activeCategory);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      {/* Mode selector */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <h3 className="mb-3 text-sm font-semibold text-heading">Mode</h3>
        <div className="flex gap-2">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setMode(opt.value)}
              className={cn(
                "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
                mode === opt.value
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "border border-border text-soft hover:bg-surface-hover hover:text-heading",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Preset gallery */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-heading">Theme Presets</h3>
          <button
            onClick={() => setShowCustom((v) => !v)}
            className={cn(
              "text-xs transition-colors",
              showCustom ? "text-primary" : "text-muted hover:text-heading",
            )}
          >
            {showCustom ? "Hide editor" : "Customize"}
          </button>
        </div>

        {/* Category tabs */}
        <div className="mb-3 flex gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveCategory("all")}
            className={cn(
              "whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              activeCategory === "all"
                ? "bg-primary/10 text-primary"
                : "text-muted hover:text-heading",
            )}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                activeCategory === cat
                  ? "bg-primary/10 text-primary"
                  : "text-muted hover:text-heading",
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filtered.map((p) => (
            <ThemePresetCard
              key={p.key}
              preset={p}
              isActive={preset === p.key}
              onClick={() => setPreset(p.key)}
            />
          ))}
        </div>
      </div>

      {/* Custom editor */}
      {showCustom && (
        <div className="rounded-lg border border-border bg-panel p-4">
          <h3 className="mb-3 text-sm font-semibold text-heading">
            Custom Theme
          </h3>
          <ThemeCustomEditor />
        </div>
      )}
    </div>
  );
}
