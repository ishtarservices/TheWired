import { describe, it, expect } from "vitest";
import { isMediaOnly, splitMessageSegments } from "../messageLayout";
import type { ContentSegment } from "../parseContent";

const text = (t: string): ContentSegment => ({ type: "text", text: t });
const img = (n: number): ContentSegment => ({ type: "image", url: `https://x.test/${n}.png` });
const vid: ContentSegment = { type: "video", url: "https://x.test/v.mp4" };
const mention: ContentSegment = { type: "mention", pubkey: "a".repeat(64) };
const note: ContentSegment = { type: "event-ref", id: "b".repeat(64) };

function flowText(segs: ContentSegment[]): string {
  return segs.map((s) => (s.type === "text" ? s.text : `<${s.type}>`)).join("");
}

describe("splitMessageSegments", () => {
  it("lifts media and cards out of the text, in order", () => {
    const { flow, attachments } = splitMessageSegments([text("look "), img(1), text(" and "), note, text(" ok")]);
    expect(flowText(flow)).toBe("look and ok");
    expect(attachments).toEqual([img(1), note]);
  });

  it("a URL on its own line leaves no blank line", () => {
    const { flow } = splitMessageSegments([text("hello\n"), img(1), text("\nworld")]);
    expect(flowText(flow)).toBe("hello\nworld");
  });

  it("trims the whitespace left at the ends", () => {
    expect(flowText(splitMessageSegments([text("caption\n"), img(1)]).flow)).toBe("caption");
    expect(flowText(splitMessageSegments([img(1), text("\ncaption")]).flow)).toBe("caption");
  });

  it("a body of only media has no flow", () => {
    const layout = splitMessageSegments([img(1), text("\n"), img(2), text(" \n "), vid]);
    expect(layout.flow).toEqual([]);
    expect(layout.attachments).toHaveLength(3);
    expect(isMediaOnly(layout)).toBe(true);
  });

  it("keeps a space between a mention and the words after a lifted URL", () => {
    const { flow } = splitMessageSegments([mention, img(1), text(" hi there")]);
    expect(flowText(flow)).toBe("<mention> hi there");
  });

  it("keeps a space before a mention that follows a lifted URL", () => {
    const { flow } = splitMessageSegments([text("hi "), img(1), text(" "), mention]);
    expect(flowText(flow)).toBe("hi <mention>");
  });

  it("collapses runs of blank lines", () => {
    const { flow } = splitMessageSegments([text("a\n\n\n\n"), img(1), text("\n\n\nb")]);
    expect(flowText(flow)).toBe("a\n\nb");
  });

  it("lifts card URLs only when the predicate says so", () => {
    const segs: ContentSegment[] = [text("song "), { type: "url", url: "https://music.test/1" }];
    expect(splitMessageSegments(segs).attachments).toEqual([]);
    expect(splitMessageSegments(segs, () => true).attachments).toHaveLength(1);
  });

  it("text alone or a shared post is not media-only", () => {
    expect(isMediaOnly(splitMessageSegments([text("hi")]))).toBe(false);
    expect(isMediaOnly(splitMessageSegments([note]))).toBe(false);
    expect(isMediaOnly(splitMessageSegments([text("hi "), img(1)]))).toBe(false);
  });
});
