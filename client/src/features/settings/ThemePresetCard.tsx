import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { ThemePreset } from "../../lib/themeTypes";
import { parseHSL } from "../../lib/themeEngine";

interface ThemePresetCardProps {
  preset: ThemePreset;
  isActive: boolean;
  onClick: () => void;
}

function hslToCSS(hsl: string): string {
  const { h, s, l } = parseHSL(hsl);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function ThemePresetCard({ preset, isActive, onClick }: ThemePresetCardProps) {
  const bg = hslToCSS(preset.colors.background);
  const fg = hslToCSS(preset.colors.foreground);
  const pri = hslToCSS(preset.colors.primary);

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border p-3 text-left transition-all duration-150",
        isActive
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-border-light hover:shadow-md",
      )}
    >
      {/* Color preview */}
      <div className="mb-2 flex h-16 overflow-hidden rounded-md">
        <div className="flex-1" style={{ backgroundColor: bg }}>
          <div className="flex h-full flex-col justify-end p-2">
            <div className="mb-1 h-1 w-8 rounded-full" style={{ backgroundColor: pri }} />
            <div className="h-1 w-5 rounded-full opacity-60" style={{ backgroundColor: fg }} />
          </div>
        </div>
        <div className="w-10" style={{ backgroundColor: pri, opacity: 0.15 }} />
      </div>

      {/* Info */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{preset.emoji}</span>
        <span className="text-xs font-medium text-heading">{preset.title}</span>
        {isActive && (
          <Check size={12} className="ml-auto text-primary" />
        )}
      </div>
      {preset.font && (
        <span className="mt-0.5 text-[10px] text-muted">{preset.font.family}</span>
      )}
    </button>
  );
}
