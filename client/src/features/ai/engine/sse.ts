/**
 * Minimal Server-Sent-Events reader over a byte ReadableStream. Yields the
 * payload of each event (the caller JSON-parses it). Works for the
 * OpenAI-compatible (`data: {…}\n\n` … `data: [DONE]`) and Anthropic
 * (`event: …\ndata: {…}`) streaming formats alike — we only care about `data:`.
 *
 * Per the SSE spec an event may carry several `data:` lines that are joined with
 * "\n" and dispatched at the terminating blank line, so we accumulate them
 * rather than yielding each line independently (some proxies / local servers
 * split a payload this way). A single leading space after `data:` is stripped
 * (spec rule) instead of trimming, so payloads with significant whitespace
 * survive intact.
 */
/**
 * Ceiling for BOTH the un-newlined line buffer and one event's accumulated
 * `data:` payload. Legit SSE events are a few KB; a misbehaving or hostile
 * endpoint (the "Custom" preset accepts any baseUrl) streaming a giant
 * newline-less body would otherwise grow the strings unboundedly with O(n²)
 * re-allocation churn (audit #97). Measured in UTF-16 code units (≈ bytes for
 * the ASCII-dominated streams providers emit).
 */
const MAX_SSE_BUFFER = 4 * 1024 * 1024;

export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let dataSize = 0; // running total of the un-dispatched dataLines

  // The throw propagates to the provider's chat() loop, whose existing catch
  // turns it into an error chunk for the UI.
  async function overflow(what: string): Promise<never> {
    await reader.cancel().catch(() => {});
    throw new Error(
      `SSE ${what} exceeded ${MAX_SSE_BUFFER / (1024 * 1024)}MB — aborting (misbehaving provider).`,
    );
  }

  // Consume one complete line; returns a payload to yield when the line is the
  // blank-line event boundary (and there is buffered data), else undefined.
  function takeLine(line: string): string | undefined {
    const stripped = line.replace(/\r$/, "");
    if (stripped === "") {
      // Event boundary: dispatch the accumulated data lines (if any).
      if (dataLines.length === 0) return undefined;
      const payload = dataLines.join("\n");
      dataLines = [];
      dataSize = 0;
      return payload;
    }
    if (stripped.startsWith("data:")) {
      const value = stripped.slice(5);
      const data = value.startsWith(" ") ? value.slice(1) : value;
      dataLines.push(data);
      dataSize += data.length;
    }
    // event:/id:/retry: and comments (": …") carry no payload we use.
    return undefined;
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_SSE_BUFFER) await overflow("line buffer");
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        const payload = takeLine(line);
        if (payload !== undefined) yield payload;
      }
      if (dataSize > MAX_SSE_BUFFER) await overflow("event data");
    }
    // Flush any bytes the decoder is holding for an incomplete trailing
    // multibyte sequence, then process a final line with no trailing newline.
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const payload = takeLine(buffer);
      if (payload !== undefined) yield payload;
    }
    // Dispatch a final event that closed without a terminating blank line.
    if (dataLines.length > 0) yield dataLines.join("\n");
  } finally {
    reader.releaseLock();
  }
}
