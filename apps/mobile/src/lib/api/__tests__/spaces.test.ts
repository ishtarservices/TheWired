import { parseSpaceChannels, parseSpaceDetail } from "../spaces";

describe("parseSpaceDetail", () => {
  it("parses the {data} envelope defensively", () => {
    const detail = parseSpaceDetail({
      data: {
        id: "my-space",
        name: "My Space",
        about: "hello",
        picture: "https://x/p.png",
        hostRelay: "wss://relay.thewired.app",
        spaceMode: "platform",
        tags: ["music", 42, "art"],
      },
    });
    expect(detail).toEqual({
      id: "my-space",
      name: "My Space",
      about: "hello",
      picture: "https://x/p.png",
      hostRelay: "wss://relay.thewired.app",
      spaceMode: "platform",
      tags: ["music", "art"],
    });
  });

  it("returns null for junk", () => {
    expect(parseSpaceDetail(null)).toBeNull();
    expect(parseSpaceDetail({})).toBeNull();
    expect(parseSpaceDetail({ data: { name: "no id" } })).toBeNull();
  });
});

describe("parseSpaceChannels", () => {
  it("keeps well-formed channels, defaults labels", () => {
    const channels = parseSpaceChannels({
      data: [
        { id: "c1", type: "chat", label: "general", isDefault: true },
        { id: "c2", type: "music" },
        { bad: true },
        null,
      ],
    });
    expect(channels).toEqual([
      { id: "c1", type: "chat", label: "general", isDefault: true },
      { id: "c2", type: "music", label: "music", isDefault: false },
    ]);
  });

  it("degrades to empty on shape changes", () => {
    expect(parseSpaceChannels({ data: "nope" })).toEqual([]);
    expect(parseSpaceChannels(undefined)).toEqual([]);
  });
});
