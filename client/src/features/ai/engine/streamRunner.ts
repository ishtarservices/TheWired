/**
 * Orchestrates an assistant turn — including the agentic tool loop. One turn may
 * stream several assistant messages: the model emits tool calls, we run them
 * (reads return data; writes register a PendingWrite for the human gate and
 * return "awaiting approval"), feed the results back, and let the model continue,
 * bounded by MAX_TOOL_DEPTH. The agent NEVER signs — publishing happens only when
 * the user approves a PendingWrite (see gate/approveWrite).
 *
 * Throttled deltas (~14 fps), AbortControllers, and the tool loop all live here,
 * never in Redux. Only the final assistant message of a turn is parsed for
 * artifacts. Streaming deltas are memory-only; finished messages write through.
 */
import { nanoid } from "nanoid";
import { store } from "@/store";
import {
  startAssistantMessage,
  appendAssistantDelta,
  appendReasoningDelta,
  finishAssistantMessage,
  failAssistantMessage,
  setMessageToolCalls,
  setToolResult,
  removeMessage,
  upsertConversation,
} from "@/store/slices/aiSlice";
import { putMessage, putConversation, deleteMessage as dbDeleteMessage } from "@/lib/db/aiConversationStore";
import type { AIMessage } from "@/types/ai";
import type { EngineChatMessage, LLMProvider, StreamingToolCall, ToolDefinition } from "./types";
import {
  getProvider,
  getProviderConfig,
  getDefaultProviderAndModel,
  providerNeedsKey,
} from "./llmManager";
import { messagesToEngineMessages } from "./buildEngineMessages";
import { syncArtifactsForMessage } from "../artifacts/artifactSync";
import { getActiveTools, toToolDefinitions, runTool } from "../tools/registry";
import { resetWebSearchBudget } from "../tools/webSearch";

const FLUSH_INTERVAL_MS = 70;
/** Coarse durable checkpoint cadence for an in-flight answer, so a reload/crash
 *  mid-generation doesn't lose a long reply (kept well above the flush rate to
 *  avoid IDB thrash). */
const CHECKPOINT_INTERVAL_MS = 2500;
/** Max model↔tool round-trips per user message (anti-runaway). */
const MAX_TOOL_DEPTH = 5;
/** Max tool calls executed in a single assistant turn (anti fan-out / cost). */
const MAX_TOOLS_PER_TURN = 8;
const inFlight = new Map<string, AbortController>();

export function stopTurn(conversationId: string): void {
  inFlight.get(conversationId)?.abort();
}

/** Abort every in-flight turn (logout / account switch) so a late finish can't
 *  write one account's reply into another's state. */
export function abortAllTurns(): void {
  for (const controller of inFlight.values()) controller.abort();
  inFlight.clear();
}

/** Drop an assistant bubble carrying a clear, actionable error (no provider
 *  round-trip) — e.g. a provider configured without its required API key. */
function failTurnImmediately(
  conversationId: string,
  error: string,
  account: string | null,
): void {
  const messageId = nanoid();
  store.dispatch(startAssistantMessage({ conversationId, messageId, createdAt: Date.now() }));
  store.dispatch(failAssistantMessage({ conversationId, messageId, error }));
  persistFinal(conversationId, messageId, account);
}

/** Run an assistant turn (with tool loop) for a conversation. */
export async function runTurn(conversationId: string): Promise<void> {
  if (inFlight.has(conversationId)) return;

  const state = store.getState();
  const conversation = state.ai.conversations.entities[conversationId];
  if (!conversation) return;
  const account = state.identity.pubkey;

  // Resolve provider + model (sticky per conversation, else the default).
  let providerId = conversation.providerId;
  let model = conversation.model;
  if (!providerId || !model) {
    const fallback = getDefaultProviderAndModel();
    if (!fallback) return; // UI surfaces "configure a provider" separately
    providerId = fallback.providerId;
    model = fallback.model;
  }
  const provider = getProvider(providerId);
  if (!provider) return;

  if (conversation.providerId !== providerId || conversation.model !== model) {
    const updated = { ...conversation, providerId, model };
    store.dispatch(upsertConversation(updated));
    if (account) void putConversation(updated, account);
  }

  // Preflight: a provider that needs a key but has none would just 401. Surface
  // an actionable error instead of a raw status code (and skip the round-trip).
  if (providerNeedsKey(providerId)) {
    const label = getProviderConfig(providerId)?.label ?? "this provider";
    failTurnImmediately(
      conversationId,
      `Add an API key for ${label} in Settings → AI to start chatting.`,
      account,
    );
    return;
  }

  const controller = new AbortController();
  inFlight.set(conversationId, controller);
  resetWebSearchBudget(conversationId); // per-user-message web-search budget

  try {
    const prefs = store.getState().ai.prefs;
    const toolsEnabled = prefs.enableTools !== false;
    // Per-conversation system prompt wins; else the global persona from prefs.
    const systemPrompt = conversation.systemPrompt || prefs.systemPrompt || undefined;
    const temperature =
      typeof prefs.temperature === "number" ? prefs.temperature : undefined;
    let depth = 0;
    // Loop: stream a message; if it made tool calls, run them and continue.
    while (true) {
      // On the final allowed iteration omit tools, forcing a prose answer rather
      // than leaving a silent tool-only bubble when the depth cap is hit.
      const offerTools = toolsEnabled && depth < MAX_TOOL_DEPTH;
      const toolDefs = offerTools ? toToolDefinitions(getActiveTools()) : undefined;
      const turn = await streamAssistantMessage({
        conversationId,
        provider,
        model,
        systemPrompt,
        temperature,
        tools: toolDefs && toolDefs.length ? toolDefs : undefined,
        signal: controller.signal,
        account,
      });

      if (turn.error || !turn.toolCalls || turn.toolCalls.length === 0) break;
      // Hard bound: if we didn't offer tools (final iteration) but the model
      // emitted some anyway, stop rather than loop on them forever.
      if (!offerTools) break;
      depth++;
      await executeToolCalls(conversationId, turn.assistantId, turn.toolCalls, account);
      // Next iteration re-streams; buildEngineMessages now includes the results.
    }
  } finally {
    inFlight.delete(conversationId);
  }
}

interface TurnResult {
  assistantId: string;
  toolCalls: StreamingToolCall[] | null;
  error: boolean;
}

/** Stream a single assistant message; returns any tool calls it requested. */
async function streamAssistantMessage(opts: {
  conversationId: string;
  provider: LLMProvider;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  tools?: ToolDefinition[];
  signal: AbortSignal;
  account: string | null;
}): Promise<TurnResult> {
  const { conversationId, provider, model, systemPrompt, temperature, tools, signal, account } = opts;
  const engineMessages = buildEngineMessages(conversationId);

  const assistantId = nanoid();
  const createdAt = Date.now();
  store.dispatch(startAssistantMessage({ conversationId, messageId: assistantId, createdAt }));

  let textBuf = "";
  let reasoningBuf = "";
  let lastFlush = Date.now();
  let lastCheckpoint = Date.now();
  let usage: AIMessage["usage"];
  let firstTextAt: number | undefined;
  let sawReasoning = false;
  let toolCalls: StreamingToolCall[] | null = null;
  let finishReason: string | undefined;
  const flush = () => {
    if (textBuf) {
      store.dispatch(appendAssistantDelta({ messageId: assistantId, text: textBuf }));
      textBuf = "";
    }
    if (reasoningBuf) {
      store.dispatch(appendReasoningDelta({ messageId: assistantId, text: reasoningBuf }));
      reasoningBuf = "";
    }
    lastFlush = Date.now();
    // Durable checkpoint of the partial answer (status stays "streaming"; hydrate
    // converts a leftover streaming message back to a normal bubble on reload).
    if (
      account &&
      (firstTextAt !== undefined || sawReasoning) &&
      Date.now() - lastCheckpoint >= CHECKPOINT_INTERVAL_MS
    ) {
      lastCheckpoint = Date.now();
      const m = store.getState().ai.messages.entities[assistantId];
      if (m) void putMessage(m, account);
    }
  };

  // A user Stop aborts the controller → the provider throws/yields an error.
  // That's not a failure: keep the partial answer (mark complete), or drop the
  // bubble entirely if nothing streamed yet. Never persist a red error for it.
  const finalizeAborted = (): TurnResult => {
    // Account switched mid-stream: abandon without writing this turn's partial
    // answer into the (now different) active account's state.
    if (store.getState().identity.pubkey !== account) {
      return { assistantId, toolCalls: null, error: true };
    }
    flush();
    const gotOutput = firstTextAt !== undefined || sawReasoning;
    if (!gotOutput) {
      store.dispatch(removeMessage({ conversationId, messageId: assistantId }));
      // A checkpoint could have persisted this id before output arrived; clear it
      // (serialized per-id after any pending put, so it can't be resurrected).
      if (account) void dbDeleteMessage(assistantId);
    } else {
      // If tool calls were recorded but not all executed (cancelled before the
      // results came back), drop them — otherwise the next turn re-sends an
      // assistant tool_calls message with no matching tool results, which
      // providers reject (cross-turn 400).
      const stored = store.getState().ai.messages.entities[assistantId];
      if (stored?.toolCalls?.length) {
        const allResolved = stored.toolCalls.every((tc) => stored.toolResults?.[tc.id]);
        if (!allResolved) {
          store.dispatch(setMessageToolCalls({ messageId: assistantId, toolCalls: [] }));
        }
      }
      store.dispatch(
        finishAssistantMessage({
          conversationId,
          messageId: assistantId,
          usage,
          genMs: Date.now() - createdAt,
        }),
      );
      persistFinal(conversationId, assistantId, account);
      const m = store.getState().ai.messages.entities[assistantId];
      if (m) syncArtifactsForMessage(m);
    }
    return { assistantId, toolCalls: null, error: true };
  };

  try {
    for await (const chunk of provider.chat(engineMessages, {
      model,
      stream: true,
      signal,
      systemPrompt,
      temperature,
      tools,
    })) {
      if (chunk.type === "text") {
        if (firstTextAt === undefined && chunk.delta) firstTextAt = Date.now();
        textBuf += chunk.delta;
        if (Date.now() - lastFlush >= FLUSH_INTERVAL_MS) flush();
      } else if (chunk.type === "reasoning") {
        sawReasoning = true;
        reasoningBuf += chunk.delta;
        if (Date.now() - lastFlush >= FLUSH_INTERVAL_MS) flush();
      } else if (chunk.type === "usage") {
        usage = { promptTokens: chunk.promptTokens, completionTokens: chunk.completionTokens };
      } else if (chunk.type === "tool_call") {
        flush();
        // Cap fan-out: store (and later execute) at most MAX_TOOLS_PER_TURN, so
        // every stored call gets a tool-result and the round-trip contract holds.
        toolCalls = chunk.toolCalls.slice(0, MAX_TOOLS_PER_TURN);
        store.dispatch(setMessageToolCalls({ messageId: assistantId, toolCalls }));
      } else if (chunk.type === "error") {
        if (signal.aborted) return finalizeAborted();
        flush();
        store.dispatch(
          failAssistantMessage({ conversationId, messageId: assistantId, error: chunk.message }),
        );
        persistFinal(conversationId, assistantId, account);
        return { assistantId, toolCalls: null, error: true };
      } else if (chunk.type === "done") {
        finishReason = chunk.finishReason;
        break;
      }
    }
    flush();
    store.dispatch(
      finishAssistantMessage({
        conversationId,
        messageId: assistantId,
        usage,
        genMs: Date.now() - createdAt,
        reasoningMs: sawReasoning && firstTextAt ? firstTextAt - createdAt : undefined,
        // Only the final (non-tool) answer surfaces a stop reason; a tool turn
        // legitimately stops with tool_use/tool_calls.
        finishReason: !toolCalls || toolCalls.length === 0 ? finishReason : undefined,
      }),
    );
    persistFinal(conversationId, assistantId, account);
    // Only the FINAL message of a turn (no further tool calls) yields artifacts.
    if (!toolCalls || toolCalls.length === 0) {
      const finalMessage = store.getState().ai.messages.entities[assistantId];
      if (finalMessage) syncArtifactsForMessage(finalMessage);
    }
    return { assistantId, toolCalls, error: false };
  } catch (e) {
    if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      return finalizeAborted();
    }
    flush();
    const message = e instanceof Error ? e.message : String(e);
    store.dispatch(failAssistantMessage({ conversationId, messageId: assistantId, error: message }));
    persistFinal(conversationId, assistantId, account);
    return { assistantId, toolCalls: null, error: true };
  }
}

/** Run every tool call from an assistant message and store the results. */
async function executeToolCalls(
  conversationId: string,
  messageId: string,
  toolCalls: StreamingToolCall[],
  account: string | null,
): Promise<void> {
  for (const tc of toolCalls) {
    const result = await runTool(tc.name, tc.arguments, {
      conversationId,
      messageId,
      toolCallId: tc.id,
    });
    const ok =
      result.isError !== undefined ? !result.isError : !result.output.startsWith("Error");
    store.dispatch(
      setToolResult({ messageId, toolCallId: tc.id, result: { ok, output: result.output } }),
    );
  }
  // Persist the message now that it carries its tool results.
  if (account) {
    const message = store.getState().ai.messages.entities[messageId];
    if (message) void putMessage(message, account);
  }
}

function buildEngineMessages(conversationId: string): EngineChatMessage[] {
  const state = store.getState();
  const ids = state.ai.messagesByConversation[conversationId] ?? [];
  const messages = ids
    .map((id) => state.ai.messages.entities[id])
    .filter((m): m is AIMessage => !!m);
  return messagesToEngineMessages(messages);
}

function persistFinal(
  conversationId: string,
  messageId: string,
  account: string | null,
): void {
  if (!account) return;
  const state = store.getState();
  const message = state.ai.messages.entities[messageId] as AIMessage | undefined;
  if (message) void putMessage(message, account);
  const conversation = state.ai.conversations.entities[conversationId];
  if (conversation) void putConversation(conversation, account);
}
