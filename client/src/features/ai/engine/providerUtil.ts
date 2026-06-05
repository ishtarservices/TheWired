/**
 * Small helpers shared by the provider adapters (Anthropic + OpenAI-compat) so
 * the error-normalization and content-flattening logic lives in one place.
 */

/** Normalize a thrown value into a user-facing string (Abort → "Cancelled."). */
export function describeError(e: unknown): string {
  if (e instanceof DOMException && e.name === "AbortError") return "Cancelled.";
  return e instanceof Error ? e.message : String(e);
}

/** Flatten an EngineChatMessage's content (a string, or content parts) to text. */
export function contentToText(
  content: string | { type: string; text?: string }[],
): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}
