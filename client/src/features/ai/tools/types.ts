/**
 * Tool registry types. A `ToolDef` is fed to providers as an OpenAI/Anthropic
 * tool schema; on a call we run it locally. READ tools return data (framed as
 * untrusted); WRITE tools NEVER act — they register a PendingWrite for the human
 * gate and return an "awaiting approval" result so the provider's tool contract
 * is satisfied. (master plan §8; agentic-safety research checklist.)
 */
export interface ToolContext {
  conversationId: string;
  /** Assistant message that emitted the tool call. */
  messageId: string;
  /** The originating provider tool-call id (kept on PendingWrites as a field —
   *  never used as their identity, see audit #48). */
  toolCallId: string;
  /** The turn's abort signal — long-running tools (web search) pass it to their
   *  fetches so Stop / logout actually cancels them (audit #94). */
  signal?: AbortSignal;
}

export interface ToolRunResult {
  /** Text fed back to the model as the tool result. */
  output: string;
  /** Explicit failure flag — preferred over sniffing the output for "Error" (a
   *  legitimate result could start with that word). Defaults handled by callers. */
  isError?: boolean;
  /** Set by write tools — the PendingWrite registered for human approval. */
  pendingWriteId?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for arguments. */
  parameters: Record<string, unknown>;
  access: "read" | "write";
  run(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): ToolRunResult | Promise<ToolRunResult>;
}
