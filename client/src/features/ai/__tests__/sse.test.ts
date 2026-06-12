import { describe, it, expect } from "vitest";
import { parseSSE } from "../engine/sse";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of parseSSE(stream)) out.push(data);
  return out;
}

describe("parseSSE", () => {
  it("yields the payload of each data: line", async () => {
    const out = await collect(
      streamFrom(['data: {"a":1}\n\n', "data: [DONE]\n\n"]),
    );
    expect(out).toEqual(['{"a":1}', "[DONE]"]);
  });

  it("reassembles payloads split across chunks", async () => {
    const out = await collect(streamFrom(['data: {"hel', 'lo":1}\n\n']));
    expect(out).toEqual(['{"hello":1}']);
  });

  it("ignores non-data lines (event:, comments, blanks)", async () => {
    const out = await collect(
      streamFrom(["event: message\n", 'data: {"x":1}\n', ": keepalive\n\n"]),
    );
    expect(out).toEqual(['{"x":1}']);
  });

  it("handles CRLF line endings", async () => {
    const out = await collect(streamFrom(['data: {"a":1}\r\n\r\n']));
    expect(out).toEqual(['{"a":1}']);
  });

  it("flushes a final event-framed payload with no trailing newline", async () => {
    // Connection drops right after the last token (common with local engines):
    // the leftover buffer is `event: x\ndata: {…}` (not a bare data: line).
    const out = await collect(streamFrom(['data: {"a":1}\n\n', "event: x\ndata: {\"last\":1}"]));
    expect(out).toEqual(['{"a":1}', '{"last":1}']);
  });

  it("joins multiple data: lines of one event with newlines", async () => {
    // Per the SSE spec, consecutive data: lines belong to a single event and are
    // joined with "\n", dispatched at the blank line — not yielded separately.
    const out = await collect(streamFrom(["data: line one\ndata: line two\n\n"]));
    expect(out).toEqual(["line one\nline two"]);
  });

  it("strips a single leading space (not all whitespace) after data:", async () => {
    const out = await collect(streamFrom(["data:  two-leading-spaces\n\n"]));
    expect(out).toEqual([" two-leading-spaces"]);
  });

  it("PROBE #97: rejects a newline-less stream past the 4MB cap and cancels the reader", async () => {
    // A hostile/misconfigured OpenAI-compatible endpoint (the "Custom" preset
    // accepts any baseUrl) streaming a giant body with no \n grew the buffer
    // unboundedly pre-fix (O(n²) string churn → renderer OOM).
    let cancelled = false;
    const encoder = new TextEncoder();
    const megabyte = encoder.encode("x".repeat(1024 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 6; i++) controller.enqueue(megabyte);
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(collect(stream)).rejects.toThrow(/exceeded|4\s?MB/i);
    expect(cancelled).toBe(true);
  });

  it("PROBE #97: rejects a single event whose accumulated data exceeds the cap", async () => {
    // Same ceiling applies to the per-event `data:` accumulator — a stream of
    // endless data: lines with no blank-line dispatch must not balloon.
    const line = `data: ${"y".repeat(1024 * 1024)}\n`;
    const out = collect(streamFrom([line, line, line, line, line, line]));
    await expect(out).rejects.toThrow(/exceeded|4\s?MB/i);
  });

  it("PROBE #97: a well-formed multi-megabyte multi-event stream still passes", async () => {
    // Cap is per-line-buffer / per-event, NOT per-stream: ten 512KB events
    // (5MB total) are fine because the buffer drains at every newline.
    const events = Array.from({ length: 10 }, (_, i) => `data: ${String(i)}${"z".repeat(512 * 1024)}\n\n`);
    const out = await collect(streamFrom(events));
    expect(out).toHaveLength(10);
    expect(out[3].startsWith("3")).toBe(true);
  });

  it("flushes a trailing multibyte char split across the final chunk", async () => {
    // "é" (U+00E9) is 0xC3 0xA9; split the two bytes across the last two reads.
    const encoder = new TextEncoder();
    const head = encoder.encode("data: caf"); // "data: caf"
    const eBytes = encoder.encode("é"); // [0xC3, 0xA9]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(head);
        controller.enqueue(eBytes.slice(0, 1)); // 0xC3 — incomplete on its own
        controller.enqueue(eBytes.slice(1)); // 0xA9 — completes the char (no trailing \n)
        controller.close();
      },
    });
    const out = await collect(stream);
    expect(out).toEqual(["café"]);
  });
});
