/**
 * Module-singleton owner of every LLM provider client for the active account.
 * Mirrors `features/wallet/walletManager.ts`: API keys stay in memory + the OS
 * keychain and NEVER enter Redux. The slice carries only non-secret config
 * (baseUrl/label/model) + connection status. Dispatches directly to the store so
 * login, settings, and the chat path share one source of truth.
 */
import { nanoid } from "nanoid";
import { store } from "@/store";
import {
  setProviders,
  upsertProviderConfig,
  removeProviderConfig,
  patchProviderStatus,
  setProviderModels,
} from "@/store/slices/aiSlice";
import {
  getSecret,
  setSecret,
  deleteSecret,
  llmProvidersKey,
  llmApiKeySecret,
} from "@/lib/nostr/secretStore";
import type { AIModelInfo, AIProviderConfig } from "@/types/ai";
import type { LLMProvider } from "./types";
import { makeOpenAICompatProvider } from "./providers/openaiCompat";
import { makeAnthropicProvider } from "./providers/anthropic";
import { detectLocalEngines } from "./detectLocal";
import { getPreset } from "./providerCatalog";

const providers = new Map<string, LLMProvider>();
const apiKeys = new Map<string, string>(); // id → key (kept here, NEVER in Redux)
const configs = new Map<string, AIProviderConfig>();
let activePubkey: string | null = null;

interface StoredConfig {
  providers: AIProviderConfig[];
}

function buildProvider(config: AIProviderConfig): LLMProvider {
  const getKey = () => apiKeys.get(config.id) ?? null;
  switch (config.kind) {
    case "anthropic":
      return makeAnthropicProvider(config, getKey);
    case "openai-compat":
    case "local-llama":
    default:
      // Image/audio/rust-inproc engines slot in here in later phases.
      return makeOpenAICompatProvider(config, getKey);
  }
}

async function persistConfigs(): Promise<void> {
  if (!activePubkey) return;
  const list = [...configs.values()];
  if (list.length === 0) {
    await deleteSecret(llmProvidersKey(activePubkey));
    return;
  }
  const blob: StoredConfig = { providers: list };
  await setSecret(llmProvidersKey(activePubkey), JSON.stringify(blob));
}

function syncReduxConfigs(): void {
  store.dispatch(setProviders([...configs.values()]));
}

/** Load every stored provider for the active account (on login / account switch). */
export async function loadProvidersForAccount(pubkey: string): Promise<void> {
  activePubkey = pubkey;
  providers.clear();
  apiKeys.clear();
  configs.clear();

  const raw = await getSecret(llmProvidersKey(pubkey));
  if (raw) {
    try {
      const blob = JSON.parse(raw) as StoredConfig;
      for (const config of blob.providers ?? []) {
        configs.set(config.id, config);
        if (config.keyRequired) {
          const key = await getSecret(llmApiKeySecret(pubkey, config.id));
          if (key) apiKeys.set(config.id, key);
        }
        providers.set(config.id, buildProvider(config));
      }
    } catch {
      /* corrupt blob — start empty */
    }
  }
  syncReduxConfigs();
  // Verify each provider in the background (populates status + model lists).
  for (const id of configs.keys()) void testProvider(id);
}

/** Add or update a provider. Persists the (optional) key to the keychain. */
export async function upsertProvider(
  input: Omit<AIProviderConfig, "id"> & { id?: string },
  apiKey?: string | null,
): Promise<string> {
  if (!activePubkey) throw new Error("Log in before configuring AI providers.");
  const id = input.id ?? nanoid(8);
  const config: AIProviderConfig = { ...input, id };
  configs.set(id, config);

  if (apiKey !== undefined) {
    const trimmed = apiKey?.trim() ?? "";
    if (trimmed) {
      apiKeys.set(id, trimmed);
      await setSecret(llmApiKeySecret(activePubkey, id), trimmed);
    } else {
      apiKeys.delete(id);
      await deleteSecret(llmApiKeySecret(activePubkey, id));
    }
  }

  providers.set(id, buildProvider(config));
  store.dispatch(upsertProviderConfig(config));
  await persistConfigs();
  void testProvider(id);
  return id;
}

export async function removeProvider(id: string): Promise<void> {
  providers.delete(id);
  apiKeys.delete(id);
  configs.delete(id);
  store.dispatch(removeProviderConfig(id));
  if (activePubkey) {
    await deleteSecret(llmApiKeySecret(activePubkey, id));
    await persistConfigs();
  }
}

/** Detect local engines (Ollama / LM Studio) and add any not already present. */
export async function detectAndAddLocalEngines(): Promise<number> {
  const detected = await detectLocalEngines();
  let added = 0;
  for (const engine of detected) {
    const exists = [...configs.values()].some(
      (c) => c.baseUrl === engine.baseUrl,
    );
    if (exists) continue;
    await upsertProvider({
      kind: "openai-compat",
      label: engine.label,
      baseUrl: engine.baseUrl,
      keyRequired: false,
      defaultModel: engine.models[0]?.id,
    });
    added++;
  }
  return added;
}

export async function testProvider(id: string): Promise<void> {
  const provider = providers.get(id);
  if (!provider) return;
  store.dispatch(
    patchProviderStatus({ providerId: id, patch: { status: "connecting" } }),
  );
  const result = await provider.testConnection();
  if (!result.ok) {
    store.dispatch(
      patchProviderStatus({
        providerId: id,
        patch: { status: "error", lastError: result.error ?? "Unreachable" },
      }),
    );
    return;
  }
  store.dispatch(
    patchProviderStatus({
      providerId: id,
      patch: { status: "connected", lastError: null },
    }),
  );
  void refreshModels(id);
}

export async function refreshModels(id: string): Promise<AIModelInfo[]> {
  const provider = providers.get(id);
  if (!provider) return [];
  try {
    const models = await provider.listModels();
    store.dispatch(setProviderModels({ providerId: id, models }));
    return models;
  } catch {
    return [];
  }
}

export function getProvider(id: string): LLMProvider | undefined {
  return providers.get(id);
}

export function getProviderConfig(id: string): AIProviderConfig | undefined {
  return configs.get(id);
}

/** True when a provider requires an API key but none is loaded — used to surface
 *  a clear "add a key" message instead of a raw 401 from the provider. */
export function providerNeedsKey(id: string): boolean {
  const config = configs.get(id);
  return !!config?.keyRequired && !apiKeys.get(id);
}

/**
 * Pick a sensible default provider + model for a new conversation: the first
 * connected provider, preferring its configured default model, else its first
 * advertised model.
 */
export function getDefaultProviderAndModel(): {
  providerId: string;
  model: string;
} | null {
  const ai = store.getState().ai;
  const status = ai.providerStatus;

  // 1. The user's chosen default, if that provider still exists.
  const prefId = ai.prefs.defaultProviderId;
  if (prefId && configs.has(prefId)) {
    const config = configs.get(prefId)!;
    const model =
      ai.prefs.defaultModel ?? config.defaultModel ?? status[prefId]?.models?.[0]?.id;
    if (model) return { providerId: prefId, model };
  }

  for (const config of configs.values()) {
    const s = status[config.id];
    if (s?.status !== "connected") continue;
    const model = config.defaultModel ?? s.models?.[0]?.id;
    if (model) return { providerId: config.id, model };
  }
  // Fall back to any configured provider with a known model (even if untested).
  for (const config of configs.values()) {
    const fallback =
      config.defaultModel ?? getPreset(config.kind)?.defaultModels?.[0];
    if (fallback) return { providerId: config.id, model: fallback };
  }
  return null;
}

export function resetLLMManager(): void {
  providers.clear();
  apiKeys.clear();
  configs.clear();
  activePubkey = null;
  store.dispatch(setProviders([]));
}
