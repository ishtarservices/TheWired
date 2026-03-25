import { useState, useRef, useEffect } from "react";
import { Palette, Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "../../contexts/ThemeContext";
import { PRESETS, FEATURED_KEYS } from "../../lib/themePresets";
import { parseHSL } from "../../lib/themeEngine";
import { useNavigate } from "react-router-dom";

function hslToHex(hsl: string): string {
  const { h, s, l } = parseHSL(hsl);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function ThemeQuickPicker() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { preset, setPreset } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-xl p-2 text-soft transition-colors hover:bg-surface-hover hover:text-heading"
        title="Theme"
      >
        <Palette size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-border bg-panel p-2 shadow-lg animate-fade-in-up"
          style={{ zIndex: "var(--z-dropdown)" }}
        >
          <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Theme
          </div>

          <div className="space-y-0.5">
            {FEATURED_KEYS.map((key) => {
              const p = PRESETS[key];
              const isActive = preset === key;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setPreset(key);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-heading"
                      : "text-body hover:bg-surface-hover hover:text-heading",
                  )}
                >
                  {/* Color swatch */}
                  <div className="flex gap-0.5">
                    <div
                      className="h-4 w-4 rounded-full border border-border-light"
                      style={{ backgroundColor: hslToHex(p.colors.background) }}
                    />
                    <div
                      className="h-4 w-4 rounded-full border border-border-light -ml-1.5"
                      style={{ backgroundColor: hslToHex(p.colors.primary) }}
                    />
                  </div>
                  <span className="flex-1 truncate">{p.title}</span>
                  {isActive && <Check size={14} className="text-primary" />}
                </button>
              );
            })}
          </div>

          <div className="mt-2 border-t border-border pt-2">
            <button
              onClick={() => {
                navigate("/settings");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-heading"
            >
              <span className="flex-1 text-left">All themes & customize</span>
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
