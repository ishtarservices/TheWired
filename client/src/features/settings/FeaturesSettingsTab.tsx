import { Blocks } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  FEATURE_AI,
  FEATURE_DECENTRALIZED_SPACES,
  setFeatureEnabled,
  type FeatureId,
} from "../../store/slices/featuresSlice";
import { saveEnabledFeatures } from "./featuresPersistence";
import { HostRelaySection } from "./HostRelaySection";

interface FeatureRow {
  id: FeatureId;
  label: string;
  description: string;
}

// Storage copy must match reality per platform: desktop = OS keychain; web =
// session memory unless the user opts into persistence (audit #95).
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const FEATURES: FeatureRow[] = [
  {
    id: FEATURE_DECENTRALIZED_SPACES,
    label: "Decentralized Spaces",
    description:
      "Create spaces on a relay you choose, start pure NIP-29 groups, and import groups from other Nostr apps. Platform spaces are unaffected.",
  },
  {
    id: FEATURE_AI,
    label: "AI",
    description: `An AI chat tab. Connect a local engine (Ollama, LM Studio) or your own API keys (Claude, OpenAI, OpenRouter, Deepseek, Kimi). Conversations stay on this device; ${
      IS_TAURI
        ? "keys are stored in your OS keychain."
        : "keys stay in memory for this session unless you opt into persistent storage in Settings → Security."
    }`,
  },
];

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="pr-4">
        <div className="text-sm font-medium text-heading">{label}</div>
        <div className="text-xs text-muted">{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
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

export function FeaturesSettingsTab() {
  const dispatch = useAppDispatch();
  const enabled = useAppSelector((s) => s.features.enabled);

  const toggle = (feature: FeatureId, value: boolean) => {
    dispatch(setFeatureEnabled({ feature, enabled: value }));
    // Persist the resulting set (compute it here — the dispatch above mutates
    // the store synchronously, but we derive the next set to avoid a stale read).
    const next = value
      ? Array.from(new Set([...enabled, feature]))
      : enabled.filter((f) => f !== feature);
    void saveEnabledFeatures(next);
  };

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      <div className="rounded-lg border border-border bg-panel p-4">
        <div className="mb-1 flex items-center gap-2">
          <Blocks size={14} className="text-primary" />
          <h3 className="text-sm font-semibold text-heading">Optional Features</h3>
        </div>
        <p className="mb-3 text-xs text-muted">
          Toggleable built-in features. Enabling one reveals its UI; disabling it
          hides the UI without touching your existing data. Stored per account on
          this device.
        </p>

        <div className="divide-y divide-border">
          {FEATURES.map((f) => (
            <Toggle
              key={f.id}
              label={f.label}
              description={f.description}
              checked={enabled.includes(f.id)}
              onChange={(v) => toggle(f.id, v)}
            />
          ))}
        </div>
      </div>

      {enabled.includes(FEATURE_DECENTRALIZED_SPACES) && <HostRelaySection />}
    </div>
  );
}
