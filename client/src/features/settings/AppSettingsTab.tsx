import { useState, useEffect } from "react";
import { useAppDispatch } from "../../store/hooks";
import { setSidebarExpanded } from "../../store/slices/uiSlice";
import { useAppUpdater } from "../../hooks/useAppUpdater";
import { RefreshCw, Download, RotateCcw, Check, AlertCircle } from "lucide-react";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
          checked ? "bg-primary" : "bg-faint"
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
      {/* App preferences */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <h3 className="mb-1 text-sm font-semibold text-heading">
          App Preferences
        </h3>
        <p className="mb-3 text-xs text-muted">
          These settings are stored locally on this device.
        </p>

        <div className="divide-y divide-border">
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

      {/* Updates (Tauri only) */}
      {isTauri && <UpdateSection />}

      {/* App info */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <h3 className="mb-1 text-sm font-semibold text-heading">About</h3>
        <p className="text-xs text-muted">
          The Wired v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}

declare const __APP_VERSION__: string;

function UpdateSection() {
  const {
    status,
    version,
    error,
    progress,
    checkForUpdate,
    downloadAndInstall,
    relaunch,
  } = useAppUpdater(false);

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <h3 className="mb-1 text-sm font-semibold text-heading">Updates</h3>
      <p className="mb-3 text-xs text-muted">
        Check for new versions of The Wired.
      </p>

      <div className="flex items-center gap-3">
        {status === "idle" && (
          <button
            onClick={checkForUpdate}
            className="flex items-center gap-2 rounded-md bg-card px-3 py-1.5 text-sm font-medium text-heading transition-colors hover:bg-faint"
          >
            <RefreshCw size={14} />
            Check for Updates
          </button>
        )}

        {status === "checking" && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <RefreshCw size={14} className="animate-spin" />
            Checking...
          </div>
        )}

        {status === "up-to-date" && (
          <div className="flex items-center gap-2 text-sm text-green-400">
            <Check size={14} />
            You're on the latest version.
            <button
              onClick={checkForUpdate}
              className="ml-2 text-xs text-muted hover:text-heading"
            >
              Check again
            </button>
          </div>
        )}

        {status === "available" && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-heading">
              v{version} available
            </span>
            <button
              onClick={downloadAndInstall}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/80"
            >
              <Download size={14} />
              Download & Install
            </button>
          </div>
        )}

        {status === "downloading" && (
          <div className="flex w-full flex-col gap-1">
            <div className="flex items-center justify-between text-sm text-muted">
              <span>Downloading...</span>
              <span>{progress ?? 0}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-faint">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {status === "ready" && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-green-400">
              Update installed — restart to apply.
            </span>
            <button
              onClick={relaunch}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/80"
            >
              <RotateCcw size={14} />
              Restart Now
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
            <button
              onClick={checkForUpdate}
              className="ml-2 text-xs text-muted hover:text-heading"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
