import { describe, it, expect } from "vitest";
import { createThinkSplitter, type ThinkPiece } from "../engine/thinkSplitter";

/** Feed deltas, collect all pieces, then merge adjacent same-kind pieces. */
function run(deltas: string[]): ThinkPiece[] {
  const s = createThinkSplitter();
  const pieces: ThinkPiece[] = [];
  for (const d of deltas) pieces.push(...s.push(d));
  pieces.push(...s.flush());
  const merged: ThinkPiece[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.kind === p.kind) last.text += p.text;
    else merged.push({ ...p });
  }
  return merged;
}

describe("createThinkSplitter", () => {
  it("routes a <think> span to reasoning and the rest to text", () => {
    expect(run(["<think>reasoning here</think>The answer."])).toEqual([
      { kind: "reasoning", text: "reasoning here" },
      { kind: "text", text: "The answer." },
    ]);
  });

  it("handles tags split across deltas", () => {
    expect(run(["<thi", "nk>why</thi", "nk>done"])).toEqual([
      { kind: "reasoning", text: "why" },
      { kind: "text", text: "done" },
    ]);
  });

  it("streams reasoning in pieces", () => {
    expect(run(["<think>", "step 1 ", "step 2", "</think>", "answer"])).toEqual([
      { kind: "reasoning", text: "step 1 step 2" },
      { kind: "text", text: "answer" },
    ]);
  });

  it("treats plain content (no tags) as text", () => {
    expect(run(["hello ", "world"])).toEqual([{ kind: "text", text: "hello world" }]);
  });

  it("flushes an unclosed <think> as reasoning", () => {
    expect(run(["<think>still thinking"])).toEqual([
      { kind: "reasoning", text: "still thinking" },
    ]);
  });

  it("does not mistake a lone < in text for a tag", () => {
    expect(run(["a < b is true"])).toEqual([{ kind: "text", text: "a < b is true" }]);
  });
});
