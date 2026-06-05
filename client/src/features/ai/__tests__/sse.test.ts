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
