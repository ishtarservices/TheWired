import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { useAppDispatch } from "../../store/hooks";
import { setSidebarExpanded } from "../../store/slices/uiSlice";
import { useTheme } from "../../contexts/ThemeContext";

const STORAGE_KEY = "thewired_app_settings";

interface AppSettings {
  sidebarDefaultExpanded: boolean;
  memberListDefaultVisible: boolean;
  developerMode: boolean;
}

const defaults: AppSettings = {
  sidebarDefaultExpanded: true,
  memberListDefaultVisible: true,
  developerMode: false,
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-sm font-medium text-heading">{label}</div>
        <div className="text-xs text-muted">{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? "bg-pulse" : "bg-faint"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function AppSettingsTab() {
  const dispatch = useAppDispatch();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const update = (key: keyof AppSettings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));

    if (key === "sidebarDefaultExpanded") {
      dispatch(setSidebarExpanded(value));
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Theme selection */}
      <div className="rounded-lg border border-white/[0.04] bg-panel p-4">
        <h3 className="mb-1 text-sm font-semibold text-heading">Theme</h3>
        <p className="mb-3 text-xs text-muted">
          Choose your preferred appearance.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setTheme("dark")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-all duration-150 ${
              theme === "dark"
                ? "border-neon/40 bg-neon/10 text-neon glow-neon"
                : "border-white/[0.04] bg-card text-soft hover:bg-card-hover hover:text-heading"
            }`}
          >
            <Moon size={16} />
            Dark
          </button>
          <button
            onClick={() => setTheme("light")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-all duration-150 ${
              theme === "light"
                ? "border-neon/40 bg-neon/10 text-neon glow-neon"
                : "border-white/[0.04] bg-card text-soft hover:bg-card-hover hover:text-heading"
            }`}
          >
            <Sun size={16} />
            Light
          </button>
        </div>
      </div>

      {/* App preferences */}
      <div className="rounded-lg border border-white/[0.04] bg-panel p-4">
        <h3 className="mb-1 text-sm font-semibold text-heading">
          App Preferences
        </h3>
        <p className="mb-3 text-xs text-muted">
          These settings are stored locally on this device.
        </p>

        <div className="divide-y divide-white/[0.04]">
          <Toggle
            label="Sidebar default expanded"
            description="Show the sidebar expanded when the app starts"
            checked={settings.sidebarDefaultExpanded}
            onChange={(v) => update("sidebarDefaultExpanded", v)}
          />
          <Toggle
            label="Member list default visible"
            description="Show the member list panel by default"
            checked={settings.memberListDefaultVisible}
            onChange={(v) => update("memberListDefaultVisible", v)}
          />
          <Toggle
            label="Developer mode"
            description="Enable developer tools and debug information"
            checked={settings.developerMode}
            onChange={(v) => update("developerMode", v)}
          />
        </div>
      </div>
    </div>
  );
}
