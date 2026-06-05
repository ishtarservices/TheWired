/**
 * AI UI preferences (device-global, not secret). Persisted to localStorage like
 * `AppSettingsTab`. Mirrored into Redux (`ai.prefs`) for reactive reads.
 */
const STORAGE_KEY = "thewired_ai_prefs";

export interface AIPrefs {
  /** Show the collapsible chain-of-thought panel for reasoning models. */
  showReasoning: boolean;
  /** Show per-message token usage + tokens/sec footer. */
  showTokenStats: boolean;
  /** Let the AI use tools (read app context; propose gated writes). Disable for
   *  local models that don't support function calling. */
  enableTools: boolean;
  /** Custom system prompt / persona applied to every chat (per-conversation
   *  systemPrompt, when set, takes precedence). Empty = provider default. */
  systemPrompt?: string;
  /** Sampling temperature for new turns (0 = deterministic … 2 = creative).
   *  Undefined = leave to the provider's default. */
  temperature?: number;
  /** Enable the web_search tool (requires a search API key in the keychain). */
  webSearchEnabled?: boolean;
  /** Which search backend the web_search tool uses (tavily | brave | exa). */
  webSearchProvider?: string;
  /** Provider used for new conversations (validated against existing configs). */
  defaultProviderId?: string;
  /** Model used for new conversations. */
  defaultModel?: string;
}

export const DEFAULT_AI_PREFS: AIPrefs = {
  showReasoning: true,
  showTokenStats: false,
  enableTools: true,
};

export function loadAIPrefs(): AIPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_PREFS;
    return { ...DEFAULT_AI_PREFS, ...(JSON.parse(raw) as Partial<AIPrefs>) };
  } catch {
    return DEFAULT_AI_PREFS;
  }
}

export function saveAIPrefs(prefs: AIPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}
