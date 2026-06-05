import type { AIProviderKind } from "@/types/ai";

/**
 * Static metadata for the providers we offer presets for. Per-provider quirks
 * (baseUrl, header requirements, fallback model lists) live here as data, not as
 * branches in the adapters. "Custom" lets a user point at any OpenAI-compatible
 * endpoint.
 */
export interface ProviderPreset {
  presetId: string;
  label: string;
  kind: AIProviderKind;
  /** Includes the API version path segment, e.g. `/v1`. */
  baseUrl: string;
  keyRequired: boolean;
  /** Extra headers merged into every request (e.g. OpenRouter attribution). */
  extraHeaders?: Record<string, string>;
  /** Fallback model ids when the provider has no usable `/models` endpoint. */
  defaultModels?: string[];
  /** Where to get an API key / install the engine. */
  helpUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    presetId: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    keyRequired: true,
    defaultModels: [
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    presetId: "openai",
    label: "OpenAI",
    kind: "openai-compat",
    baseUrl: "https://api.openai.com/v1",
    keyRequired: true,
    helpUrl: "https://platform.openai.com/api-keys",
  },
  {
    presetId: "openrouter",
    label: "OpenRouter",
    kind: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    keyRequired: true,
    extraHeaders: {
      "HTTP-Referer": "https://thewired.app",
      "X-Title": "The Wired",
    },
    helpUrl: "https://openrouter.ai/keys",
  },
  {
    presetId: "deepseek",
    label: "DeepSeek",
    kind: "openai-compat",
    baseUrl: "https://api.deepseek.com/v1",
    keyRequired: true,
    defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    helpUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    presetId: "kimi",
    label: "Kimi (Moonshot)",
    kind: "openai-compat",
    baseUrl: "https://api.moonshot.ai/v1",
    keyRequired: true,
    helpUrl: "https://platform.moonshot.ai/console/api-keys",
  },
  {
    presetId: "ollama",
    label: "Ollama (local)",
    kind: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    keyRequired: false,
    helpUrl: "https://ollama.com/download",
  },
  {
    presetId: "lmstudio",
    label: "LM Studio (local)",
    kind: "openai-compat",
    baseUrl: "http://localhost:1234/v1",
    keyRequired: false,
    helpUrl: "https://lmstudio.ai",
  },
  {
    presetId: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai-compat",
    baseUrl: "",
    keyRequired: false,
  },
];

export function getPreset(presetId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.presetId === presetId);
}

/** Headers that should accompany requests for a given baseUrl, if it matches a preset. */
export function extraHeadersForBaseUrl(baseUrl: string): Record<string, string> {
  const preset = PROVIDER_PRESETS.find(
    (p) => p.baseUrl && baseUrl.startsWith(p.baseUrl),
  );
  return preset?.extraHeaders ?? {};
}
