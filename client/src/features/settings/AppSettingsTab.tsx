import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch } from "../../store/hooks";
import { setSidebarExpanded } from "../../store/slices/uiSlice";
import { setShowAppTour } from "../onboarding/onboardingSlice";
import { persistOnboardingFlag } from "../onboarding/onboardingPersistence";
import { useIdentity } from "../identity/useIdentity";
import { useProfile } from "../profile/useProfile";
import { AddAccountModal } from "../identity/AddAccountModal";
import { Avatar } from "../../components/ui/Avatar";
import { useAppUpdater } from "../../hooks/useAppUpdater";
import { RefreshCw, Download, RotateCcw, Check, AlertCircle, Map, Plus, Trash2, Users } from "lucide-react";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const STORAGE_KEY = "thewired_app_settings";

interface AppSettings {
  sidebarDefaultExpanded: boolean;
  memberListDefaultVisible: boolean;
  autoUpdates: boolean;
  developerMode: boolean;
}

const defaults: AppSettings = {
  sidebarDefaultExpanded: true,
  memberListDefaultVisible: true,
  autoUpdates: true,
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

/** Read whether auto-updates are enabled (for use outside settings UI) */
export function getAutoUpdatesEnabled(): boolean {
  return loadSettings().autoUpdates;
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
  const navigate = useNavigate();
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
          {isTauri && (
            <Toggle
              label="Automatic updates"
              description="Download and install updates automatically on startup"
              checked={settings.autoUpdates}
              onChange={(v) => update("autoUpdates", v)}
            />
          )}
          <Toggle
            label="Developer mode"
            description="Enable developer tools and debug information"
            checked={settings.developerMode}
            onChange={(v) => update("developerMode", v)}
          />
        </div>
      </div>

      {/* Accounts */}
      {isTauri && <AccountsSection />}

      {/* Onboarding */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <h3 className="mb-1 text-sm font-semibold text-heading">Onboarding</h3>
        <p className="mb-3 text-xs text-muted">
          Re-run the guided walkthrough of The Wired.
        </p>
        <button
          onClick={() => {
            persistOnboardingFlag("appTourCompleted", false);
            dispatch(setShowAppTour(true));
            navigate("/");
          }}
          className="flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/20 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 hover:border-primary/40"
        >
          <Map size={14} />
          Restart App Tour
        </button>
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

function AccountsSection() {
  const { pubkey, accounts, switchTo, removeAccount } = useIdentity();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users size={14} className="text-primary" />
        <h3 className="text-sm font-semibold text-heading">Accounts</h3>
      </div>

      <div className="space-y-2 mb-3">
        {accounts.map((account) => (
          <AccountRow
            key={account.pubkey}
            accountPubkey={account.pubkey}
            signerType={account.signerType}
            isActive={account.pubkey === pubkey}
            onSwitch={() => switchTo(account.pubkey)}
            onRemove={() => removeAccount(account.pubkey)}
          />
        ))}
      </div>

      <button
        onClick={() => setAddOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/20 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 hover:border-primary/40"
      >
        <Plus size={14} />
        Add Account
      </button>

      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function AccountRow({
  accountPubkey,
  signerType,
  isActive,
  onSwitch,
  onRemove,
}: {
  accountPubkey: string;
  signerType: string | null;
  isActive: boolean;
  onSwitch: () => void;
  onRemove: () => void;
}) {
  const { profile } = useProfile(accountPubkey);
  const displayName =
    profile?.display_name || profile?.name || accountPubkey.slice(0, 12) + "...";

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <Avatar
        src={profile?.picture}
        alt={displayName}
        size="sm"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-heading truncate">
          {displayName}
        </div>
        <div className="text-[10px] text-muted">
          {signerType === "nip07" ? "Extension" : "Keystore"}
          {isActive && (
            <span className="ml-1.5 text-primary font-medium">Active</span>
          )}
        </div>
      </div>
      {!isActive && (
        <div className="flex items-center gap-1">
          <button
            onClick={onSwitch}
            className="rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10 transition-colors"
          >
            Switch
          </button>
          <button
            onClick={onRemove}
            className="rounded-md p-1 text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Remove account"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

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
              Update installed — close and reopen to apply.
            </span>
            <button
              onClick={relaunch}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/80"
            >
              <RotateCcw size={14} />
              Close App
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
