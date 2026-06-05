/**
 * Pure transform from stored conversation messages to the normalized
 * `EngineChatMessage[]` sent to a provider. Kept side-effect-free (no store
 * access) so the tool round-trip serialization is unit-testable:
 *  - a user turn carrying "Ask AI" context → its untrusted snapshot is framed as
 *    DATA before the user's actual request;
 *  - an assistant turn with tool calls → re-sent WITH its `toolCalls`, followed
 *    by one `tool` result per call (OpenAI rejects orphan tool messages, and the
 *    follow-up turn needs the loop's results in history).
 */
import type { AIContentPart, AIMessage } from "@/types/ai";
import type { EngineChatMessage } from "./types";
import { frameUntrustedContext } from "../context/aiContext";

export function partsToText(parts: AIContentPart[]): string {
  return parts
    .filter((p): p is Extract<AIContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function messagesToEngineMessages(messages: AIMessage[]): EngineChatMessage[] {
  const out: EngineChatMessage[] = [];
  for (const m of messages) {
    if (m.status === "streaming") continue;
    if (m.role === "system") continue; // systemPrompt is sent separately

    if (m.role === "user" && m.context) {
      out.push({
        role: "user",
        content: `${frameUntrustedContext(m.context)}\n\n${partsToText(m.parts)}`,
      });
      continue;
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({ role: "assistant", content: partsToText(m.parts), toolCalls: m.toolCalls });
      for (const tc of m.toolCalls) {
        const r = m.toolResults?.[tc.id];
        if (r) out.push({ role: "tool", toolCallId: tc.id, name: tc.name, content: r.output });
      }
      continue;
    }

    out.push({ role: m.role, content: m.parts });
  }
  return out;
}
