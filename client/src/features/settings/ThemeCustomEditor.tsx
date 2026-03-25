import { useState } from "react";
import { RotateCcw, Download, Upload } from "lucide-react";
import { useTheme } from "../../contexts/ThemeContext";
import { ColorPicker } from "../../components/ui/ColorPicker";
import { DEFAULT_PRESET } from "../../lib/themePresets";
import type { CoreColors } from "../../lib/themeTypes";

export function ThemeCustomEditor() {
  const { config, setCustomColors, setCustomFont, setPreset } = useTheme();
  const [fontInput, setFontInput] = useState(config.font?.family || "Inter");

  const handleColorChange = (key: keyof CoreColors) => (value: string) => {
    setCustomColors({ ...config.colors, [key]: value });
  };

  const handleFontSubmit = () => {
    if (fontInput.trim()) {
      setCustomFont({ family: fontInput.trim() });
    }
  };

  const handleReset = () => {
    setPreset(DEFAULT_PRESET);
  };

  const handleExport = () => {
    const data = JSON.stringify({ colors: config.colors, font: config.font }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "thewired-theme.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.colors?.background && data.colors?.foreground && data.colors?.primary) {
          setCustomColors(data.colors);
          if (data.font) setCustomFont(data.font);
        }
      } catch { /* ignore invalid JSON */ }
    };
    input.click();
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-panel p-4">
        <h4 className="mb-3 text-sm font-semibold text-heading">Custom Colors</h4>
        <div className="space-y-4">
          <ColorPicker
            label="Background"
            value={config.colors.background}
            onChange={handleColorChange("background")}
          />
          <ColorPicker
            label="Foreground"
            value={config.colors.foreground}
            onChange={handleColorChange("foreground")}
          />
          <ColorPicker
            label="Primary Accent"
            value={config.colors.primary}
            onChange={handleColorChange("primary")}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-panel p-4">
        <h4 className="mb-3 text-sm font-semibold text-heading">Font</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={fontInput}
            onChange={(e) => setFontInput(e.target.value)}
            onBlur={handleFontSubmit}
            onKeyDown={(e) => e.key === "Enter" && handleFontSubmit()}
            placeholder="Font family (e.g. Inter, Lora)"
            className="flex-1 rounded-md border border-border bg-field px-3 py-1.5 text-sm text-heading placeholder:text-muted focus:border-primary focus:outline-none"
          />
        </div>
        <p className="mt-1.5 text-[10px] text-muted">
          Enter any Google Font name. It will be loaded automatically.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading"
        >
          <RotateCcw size={12} />
          Reset
        </button>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading"
        >
          <Download size={12} />
          Export
        </button>
        <button
          onClick={handleImport}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading"
        >
          <Upload size={12} />
          Import
        </button>
      </div>
    </div>
  );
}
