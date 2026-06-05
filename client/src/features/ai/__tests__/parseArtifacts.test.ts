import { describe, it, expect } from "vitest";
import {
  parseArtifactSegments,
  extractArtifacts,
} from "../artifacts/parseArtifacts";

describe("parseArtifactSegments", () => {
  it("returns a single text segment when there are no artifacts", () => {
    const segs = parseArtifactSegments("just some prose with `inline code`.");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ kind: "text", text: "just some prose with `inline code`." });
  });

  it("extracts a chart fenced block as a chart artifact", () => {
    const text = 'Here:\n```chart\n{"type":"bar","series":[]}\n```\nDone.';
    const segs = parseArtifactSegments(text);
    const artifacts = segs.filter((s) => s.kind === "artifact");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: "artifact" });
    if (artifacts[0].kind === "artifact") {
      expect(artifacts[0].artifact.type).toBe("chart");
      expect(artifacts[0].artifact.content).toContain('"type":"bar"');
    }
    // prose before and after is preserved
    expect(segs[0]).toMatchObject({ kind: "text" });
    expect(segs[segs.length - 1]).toMatchObject({ kind: "text" });
  });

  it("treats a large code fence as a code artifact but keeps small ones inline", () => {
    const big = "```ts\n" + Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`).join("\n") + "\n```";
    expect(extractArtifacts(big).map((a) => a.type)).toEqual(["code"]);

    const small = "```ts\nconst x = 1;\n```";
    expect(extractArtifacts(small)).toHaveLength(0);
    // small fence stays as a single text segment (rendered inline by markdown)
    expect(parseArtifactSegments(small)).toHaveLength(1);
  });

  it("recognizes table and document fences", () => {
    expect(extractArtifacts("```table\na,b\n1,2\n```")[0].type).toBe("table");
    expect(extractArtifacts("```document\n# Title\nbody\n```")[0].type).toBe("document");
  });

  it("parses a :::artifact directive with metadata", () => {
    const text = ':::artifact{type="text/markdown" title="My Doc"}\n# Hi\nbody\n:::';
    const arts = extractArtifacts(text);
    expect(arts).toHaveLength(1);
    expect(arts[0].type).toBe("document");
    expect(arts[0].title).toBe("My Doc");
  });

  it("keeps artifacts in document order", () => {
    const text =
      "a\n```chart\n{}\n```\nb\n```table\nx\n```\nc";
    const arts = extractArtifacts(text);
    expect(arts.map((a) => a.type)).toEqual(["chart", "table"]);
  });

  it("does not crash on an unterminated fence (stays prose)", () => {
    const text = "here is some code:\n```ts\nconst x = 1;\n// no closing fence";
    const segs = parseArtifactSegments(text);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe("text");
    expect(extractArtifacts(text)).toHaveLength(0);
  });

  it("doesn't double-count a fence nested inside an :::artifact directive", () => {
    const text =
      ':::artifact{type="text/html" title="Page"}\n```html\n<b>hi</b>\n```\n:::';
    const arts = extractArtifacts(text);
    expect(arts).toHaveLength(1);
    expect(arts[0].title).toBe("Page");
  });

  it("maps directive MIME types to artifact types", () => {
    expect(extractArtifacts(':::artifact{type="image/svg+xml" title="x"}\na\n:::')[0].type).toBe("code");
    expect(extractArtifacts(':::artifact{type="text/markdown" title="x"}\na\n:::')[0].type).toBe("document");
  });
});
