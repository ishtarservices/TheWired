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

/** Result stubbed in for a toolCall whose real result never arrived (turn
 *  aborted / wiped mid-loop by a pre-fix build). Providers reject an assistant
 *  tool_calls message with a missing result — one orphan 400s the whole
 *  conversation forever — so history is healed at serialization time. */
const ORPHAN_TOOL_RESULT =
  "[interrupted — this tool call produced no result; treat it as cancelled]";

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
        out.push({
          role: "tool",
          toolCallId: tc.id,
          name: tc.name,
          content: r ? r.output : ORPHAN_TOOL_RESULT,
        });
      }
      continue;
    }

    // Skip assistant bubbles that would serialize to empty content: zero-output
    // error bubbles ("add an API key", 401s) and reasoning-only replies
    // (reasoning is shown collapsed but never resent). Anthropic rejects empty
    // message content, so ONE such bubble bricks every later turn in the
    // conversation with compounding 400s (audit #11).
    if (m.role === "assistant" && partsToText(m.parts).trim() === "") continue;

    out.push({ role: m.role, content: m.parts });
  }
  return out;
}
