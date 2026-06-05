import type { AIModelInfo } from "@/types/ai";
import { engineFetchWithTimeout } from "./httpFetch";

/**
 * Probe for locally-running engines. Ollama runs an always-on daemon at :11434;
 * LM Studio's server is manual and often off. Short timeouts keep the UI snappy
 * when nothing is there. On the web build these may fail to CORS — that's fine,
 * detection is desktop-first.
 */
export interface DetectedEngine {
  presetId: "ollama" | "lmstudio";
  label: string;
  baseUrl: string;
  models: AIModelInfo[];
}

const PROBE_TIMEOUT_MS = 700;

export async function detectLocalEngines(): Promise<DetectedEngine[]> {
  const [ollama, lmstudio] = await Promise.all([
    detectOllama(),
    detectLmStudio(),
  ]);
  return [ollama, lmstudio].filter((e): e is DetectedEngine => e !== null);
}

async function detectOllama(): Promise<DetectedEngine | null> {
  try {
    const res = await engineFetchWithTimeout(
      "http://localhost:11434/api/tags",
      PROBE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { models?: { name: string }[] };
    return {
      presetId: "ollama",
      label: "Ollama (local)",
      baseUrl: "http://localhost:11434/v1",
      models: (json.models ?? []).map((m) => ({ id: m.name })),
    };
  } catch {
    return null;
  }
}

async function detectLmStudio(): Promise<DetectedEngine | null> {
  try {
    const res = await engineFetchWithTimeout(
      "http://localhost:1234/v1/models",
      PROBE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { id: string }[] };
    return {
      presetId: "lmstudio",
      label: "LM Studio (local)",
      baseUrl: "http://localhost:1234/v1",
      models: (json.data ?? []).map((m) => ({ id: m.id })),
    };
  } catch {
    return null;
  }
}
