import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Loader2,
  Check,
  WifiOff,
  RefreshCw,
  Trash2,
  X,
  ExternalLink,
  Star,
  Globe,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Toggle } from "../../components/ui/Toggle";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  selectProviderConfigs,
  selectProviderStatus,
  selectAIPrefs,
  setPrefs,
} from "../../store/slices/aiSlice";
import type { AIProviderConfig, AIProviderStatusKind } from "../../types/ai";
import { saveAIPrefs, type AIPrefs } from "../../features/ai/aiPrefs";
import { setDefaultModelPref } from "../../features/ai/aiPrefsActions";
import {
  upsertProvider,
  removeProvider,
  testProvider,
  detectAndAddLocalEngines,
} from "../../features/ai/engine/llmManager";
import {
  PROVIDER_PRESETS,
  getPreset,
} from "../../features/ai/engine/providerCatalog";
import {
  WEB_SEARCH_PROVIDERS,
  getWebSearchProvider,
  setWebSearchKey,
  getWebSearchKey,
} from "../../features/ai/tools/webSearch";

// Storage copy must match reality per platform: desktop = OS keychain; web =
// session memory unless the user opts into persistence (audit #95).
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function AISettingsTab() {
  const providers = useAppSelector(selectProviderConfigs);
  const [showAdd, setShowAdd] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  const detect = async () => {
    setDetecting(true);
    setDetectMsg(null);
    try {
      const added = await detectAndAddLocalEngines();
      setDetectMsg(
        added > 0
          ? `Added ${added} local engine${added === 1 ? "" : "s"}.`
          : "No new local engines found (is Ollama or LM Studio running?).",
      );
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-heading">AI Engines</h3>
          <p className="mt-1 text-xs text-muted">
            Connect local engines or your own API keys.{" "}
            {IS_TAURI
              ? "Keys are stored in your OS keychain (never synced); conversations stay on this device."
              : "On the web, keys are kept in memory for this session only (see Settings → Security to persist them); conversations stay on this device."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={detect}
            disabled={detecting}
            className="gap-1.5"
          >
            {detecting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )}
            Detect local
          </Button>
          {!showAdd && (
            <Button
              variant="secondary"
              onClick={() => setShowAdd(true)}
              className="gap-1.5"
            >
              <Plus size={14} />
              Add provider
            </Button>
          )}
          {detectMsg && <span className="text-xs text-muted">{detectMsg}</span>}
        </div>

        {showAdd && <AddProviderForm onDone={() => setShowAdd(false)} />}

        {providers.length === 0 && !showAdd ? (
          <div className="rounded-xl bg-field/50 p-4 text-center text-xs text-muted ring-1 ring-border">
            No providers yet. Detect a local engine or add one with an API key.
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((config) => (
              <ProviderCard key={config.id} config={config} />
            ))}
          </div>
        )}
      </section>

      <PreferencesSection />
      <PersonalizationSection />
      <WebSearchSection />
    </div>
  );
}

function WebSearchSection() {
  const dispatch = useAppDispatch();
  const prefs = useAppSelector(selectAIPrefs);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [keyInput, setKeyInput] = useState("");
  const [hasKey, setHasKey] = useState(() => !!getWebSearchKey());
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<AIPrefs>) => {
    const next = { ...prefs, ...patch };
    dispatch(setPrefs(next));
    saveAIPrefs(next);
  };

  const provider = getWebSearchProvider(prefs.webSearchProvider);
  const enabled = prefs.webSearchEnabled === true;

  const saveKey = async () => {
    if (!pubkey || !keyInput.trim()) return;
    setSaving(true);
    try {
      await setWebSearchKey(pubkey, keyInput.trim());
      setHasKey(true);
      setKeyInput("");
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    if (!pubkey) return;
    await setWebSearchKey(pubkey, "");
    setHasKey(false);
  };

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-heading">
        <Globe size={14} /> Web search
      </h3>
      <div className="space-y-3 rounded-xl bg-field p-3 ring-1 ring-border">
        <Toggle
          label="Let the AI search the web"
          description="Adds a web_search tool the model can call for current info. Results are treated as untrusted; the AI still can't post or send anything without your approval."
          checked={enabled}
          onChange={(v) => set({ webSearchEnabled: v })}
        />

        {enabled && (
          <>
            <div>
              <label className="text-xs text-muted">Search provider</label>
              <select
                value={provider.id}
                onChange={(e) => set({ webSearchProvider: e.target.value })}
                className="mt-1 w-full rounded-lg bg-field px-3 py-2 text-sm text-heading outline-none ring-1 ring-border focus:ring-primary/30"
              >
                {WEB_SEARCH_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted">{provider.keyHint}</p>
            </div>

            <div>
              <label className="text-xs text-muted">API key</label>
              {hasKey ? (
                <div className="mt-1 flex items-center gap-2">
                  <span className="flex flex-1 items-center gap-1.5 rounded-lg bg-panel px-3 py-2 text-sm text-soft ring-1 ring-border">
                    <Check size={13} className="text-green-400" /> Key saved (
                    {IS_TAURI ? "kept in your OS keychain" : "kept for this session"})
                  </span>
                  <button
                    onClick={clearKey}
                    className="rounded-lg px-2.5 py-2 text-xs text-muted transition-colors hover:bg-surface hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder={`${provider.label} API key`}
                    className="flex-1 rounded-lg bg-field px-3 py-2 text-sm text-heading placeholder-muted outline-none ring-1 ring-border focus:ring-primary/30"
                  />
                  <Button onClick={saveKey} disabled={!keyInput.trim() || saving || !pubkey}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : "Save"}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function PersonalizationSection() {
  const dispatch = useAppDispatch();
  const prefs = useAppSelector(selectAIPrefs);

  const set = (patch: Partial<AIPrefs>) => {
    const next = { ...prefs, ...patch };
    dispatch(setPrefs(next));
    saveAIPrefs(next);
  };

  const temp = prefs.temperature;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-heading">Personalization</h3>
      <div className="space-y-3 rounded-xl bg-field p-3 ring-1 ring-border">
        <div>
          <label className="text-sm text-heading">System prompt</label>
          <p className="mb-1.5 text-xs text-muted">
            A persona / standing instructions sent at the top of every chat (e.g. “You are a
            concise Nostr power-user. Prefer bullet points.”). Leave blank to use the model's
            own default.
          </p>
          <textarea
            value={prefs.systemPrompt ?? ""}
            onChange={(e) => set({ systemPrompt: e.target.value })}
            onBlur={(e) => set({ systemPrompt: e.target.value.trim() || undefined })}
            rows={4}
            placeholder="No custom system prompt — using the model's default."
            className="w-full resize-none rounded-lg bg-field px-3 py-2 text-sm text-heading placeholder-muted outline-none ring-1 ring-border focus:ring-primary/30"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-heading">Temperature</label>
            <span className="text-xs tabular-nums text-muted">
              {temp === undefined ? "Default" : temp.toFixed(1)}
            </span>
          </div>
          <p className="mb-1.5 text-xs text-muted">
            Lower = more focused and deterministic; higher = more creative. Leave at Default to
            use the provider's own setting.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temp ?? 0.7}
              onChange={(e) => set({ temperature: Number(e.target.value) })}
              className="flex-1 accent-primary"
            />
            {temp !== undefined && (
              <button
                onClick={() => set({ temperature: undefined })}
                className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-heading"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PreferencesSection() {
  const dispatch = useAppDispatch();
  const prefs = useAppSelector(selectAIPrefs);

  const set = (patch: Partial<AIPrefs>) => {
    const next = { ...prefs, ...patch };
    dispatch(setPrefs(next));
    saveAIPrefs(next);
  };

  return (
    <section className="space-y-1">
      <h3 className="text-sm font-semibold text-heading">Preferences</h3>
      <div className="divide-y divide-border rounded-xl bg-field ring-1 ring-border">
        <Toggle
          label="Show reasoning"
          description="Display the collapsible chain-of-thought for reasoning models. When off, the response just shows a brief “Thinking…” cue."
          checked={prefs.showReasoning}
          onChange={(v) => set({ showReasoning: v })}
        />
        <Toggle
          label="Show token usage"
          description="Show prompt/response token counts and tokens-per-second under each reply (when the provider reports them)."
          checked={prefs.showTokenStats}
          onChange={(v) => set({ showTokenStats: v })}
        />
        <Toggle
          label="Let the AI use tools"
          description="Allow the AI to read app context (threads, profiles, your spaces) and draft posts/DMs. Every write stops at an approval card before anything is signed. Turn off for local models that don't support tool calling."
          checked={prefs.enableTools}
          onChange={(v) => set({ enableTools: v })}
        />
      </div>
    </section>
  );
}

function ProviderCard({ config }: { config: AIProviderConfig }) {
  const status = useAppSelector(selectProviderStatus(config.id));
  const prefs = useAppSelector(selectAIPrefs);
  const isDefault = prefs.defaultProviderId === config.id;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const models = status.models?.length
    ? status.models
    : config.defaultModel
      ? [{ id: config.defaultModel }]
      : [];

  const saveKey = async () => {
    setBusy(true);
    try {
      await upsertProvider(config, key);
      setKey("");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await testProvider(config.id);
    } finally {
      setBusy(false);
    }
  };

  const chooseDefaultModel = async (model: string) => {
    await upsertProvider({ ...config, defaultModel: model });
    // Keep the global default model in sync when this is the default provider.
    if (isDefault) setDefaultModelPref(config.id, model);
  };

  const makeDefault = () => {
    const model = config.defaultModel ?? models[0]?.id;
    if (model) setDefaultModelPref(config.id, model);
  };

  return (
    <div className="space-y-3 rounded-xl bg-field p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-heading">
            <span className="truncate">{config.label}</span>
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted">
              {config.kind}
            </span>
            {isDefault && (
              <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                <Star size={9} className="fill-primary" />
                Default
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">{config.baseUrl}</div>
        </div>
        <StatusBadge status={status.status} />
      </div>

      {config.keyRequired && (
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              status.status === "connected" ? "API key set — replace…" : "API key"
            }
            disabled={busy}
            className="min-w-0 flex-1 rounded-xl bg-field px-3 py-2 text-sm text-heading ring-1 ring-border placeholder-muted focus:outline-none focus:ring-primary/30"
          />
          <Button onClick={saveKey} disabled={busy || !key.trim()} className="gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </Button>
        </div>
      )}

      {models.length > 0 && (
        <div className="space-y-0.5">
          <label className="flex items-center gap-2 text-xs text-muted">
            Model when used
            <select
              value={config.defaultModel ?? models[0]?.id}
              onChange={(e) => void chooseDefaultModel(e.target.value)}
              className="min-w-0 flex-1 rounded-lg bg-field px-2 py-1.5 text-xs text-heading ring-1 ring-border focus:outline-none focus:ring-primary/30"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </label>
          {isDefault && (
            <p className="text-[10px] text-muted">
              This provider is your default for new chats — this model is what they'll use.
            </p>
          )}
        </div>
      )}

      {status.lastError && status.status === "error" && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {status.lastError}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={test} disabled={busy} className="gap-1.5">
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Test
        </Button>
        {!isDefault && models.length > 0 && (
          <Button
            variant="secondary"
            onClick={makeDefault}
            disabled={busy}
            className="gap-1.5"
          >
            <Star size={14} />
            Set as default provider
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => void removeProvider(config.id)}
          disabled={busy}
          className="gap-1.5"
        >
          <Trash2 size={14} />
          Remove
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AIProviderStatusKind }) {
  if (status === "connected") {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-400">
        <Check size={10} />
        Connected
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
        <Loader2 size={10} className="animate-spin" />
        Connecting
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-yellow-400/10 px-2 py-0.5 text-[10px] font-semibold text-yellow-400">
        <WifiOff size={10} />
        Offline
      </span>
    );
  }
  return null;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </span>
  );
}

function AddProviderForm({ onDone }: { onDone: () => void }) {
  const [presetId, setPresetId] = useState(PROVIDER_PRESETS[0].presetId);
  const preset = getPreset(presetId) ?? PROVIDER_PRESETS[0];
  const isCustom = preset.presetId === "custom";

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = getPreset(presetId) ?? PROVIDER_PRESETS[0];
    setName("");
    setBaseUrl(p.baseUrl);
  }, [presetId]);

  const submit = async () => {
    const trimmedUrl = baseUrl.trim().replace(/\/+$/, "");
    if (!trimmedUrl) {
      setError("Base URL is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await upsertProvider(
        {
          kind: preset.kind,
          label: name.trim() || preset.label || "Provider",
          baseUrl: trimmedUrl,
          keyRequired: preset.keyRequired,
          defaultModel: preset.defaultModels?.[0],
        },
        preset.keyRequired ? key : undefined,
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add provider.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl bg-field/60 p-4 ring-1 ring-border">
      <div className="text-sm font-medium text-heading">Add a provider</div>

      <div>
        <FieldLabel>Provider</FieldLabel>
        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          className="w-full rounded-xl bg-field px-3 py-2 text-sm text-heading ring-1 ring-border focus:outline-none focus:ring-primary/30"
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.presetId} value={p.presetId}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Endpoint: editable only for Custom; shown read-only otherwise so it's clear, not a stray field. */}
      {isCustom ? (
        <div>
          <FieldLabel>Base URL</FieldLabel>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-endpoint/v1"
            disabled={busy}
            className="w-full rounded-xl bg-field px-3 py-2 text-sm text-heading ring-1 ring-border placeholder-muted focus:outline-none focus:ring-primary/30"
          />
        </div>
      ) : (
        <div>
          <FieldLabel>Endpoint</FieldLabel>
          <div className="truncate rounded-xl bg-surface px-3 py-2 text-xs text-muted ring-1 ring-border">
            {preset.baseUrl}
          </div>
        </div>
      )}

      {preset.keyRequired && (
        <div>
          <div className="flex items-center justify-between">
            <FieldLabel>API key</FieldLabel>
            {preset.helpUrl && (
              <a
                href={preset.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="mb-1 flex items-center gap-0.5 text-[10px] text-primary hover:underline"
              >
                Get a key
                <ExternalLink size={9} />
              </a>
            )}
          </div>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-…"
            disabled={busy}
            className="w-full rounded-xl bg-field px-3 py-2 text-sm text-heading ring-1 ring-border placeholder-muted focus:outline-none focus:ring-primary/30"
          />
        </div>
      )}

      <div>
        <FieldLabel>Display name (optional)</FieldLabel>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={preset.label}
          disabled={busy}
          className="w-full rounded-xl bg-field px-3 py-2 text-sm text-heading ring-1 ring-border placeholder-muted focus:outline-none focus:ring-primary/30"
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add provider
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={busy} className="gap-1.5">
          <X size={14} />
          Cancel
        </Button>
      </div>
    </div>
  );
}
