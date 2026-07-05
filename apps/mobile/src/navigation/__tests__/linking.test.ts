import { nip19 } from "nostr-tools";

// expo-linking reads the expo-constants manifest at import time, which does
// not exist under jest — only createURL is used (for the dev-scheme prefix).
jest.mock("expo-linking", () => ({
  createURL: (path: string) => `thewired://${path}`,
}));

import { linking } from "../linking";

const HEX = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

function resolve(path: string) {
  return linking.getStateFromPath!(path, linking.config);
}

/** Last route of a resolved state (the visible screen). */
function topRoute(path: string) {
  const state = resolve(path);
  expect(state).toBeDefined();
  const routes = state!.routes;
  return routes[routes.length - 1] as { name: string; params?: object };
}

describe("nostr entity deep links (nostr:<entity> → path <entity>)", () => {
  it("npub → Profile with the hex pubkey", () => {
    const top = topRoute(nip19.npubEncode(HEX));
    expect(top.name).toBe("Profile");
    expect(top.params).toEqual({ pubkey: HEX });
  });

  it("nprofile → Profile with the hex pubkey", () => {
    const top = topRoute(nip19.nprofileEncode({ pubkey: HEX, relays: [] }));
    expect(top.name).toBe("Profile");
    expect(top.params).toEqual({ pubkey: HEX });
  });

  it("note → NoteThread with the hex event id", () => {
    const top = topRoute(nip19.noteEncode(HEX));
    expect(top.name).toBe("NoteThread");
    expect(top.params).toEqual({ noteId: HEX });
  });

  it("nevent → NoteThread with the hex event id", () => {
    const top = topRoute(nip19.neventEncode({ id: HEX }));
    expect(top.name).toBe("NoteThread");
    expect(top.params).toEqual({ noteId: HEX });
  });

  it("naddr → Article carrying the naddr", () => {
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: HEX, identifier: "post" });
    const top = topRoute(naddr);
    expect(top.name).toBe("Article");
    expect(top.params).toEqual({ naddr });
  });

  it("keeps the tab shell beneath the pushed screen", () => {
    const state = resolve(nip19.npubEncode(HEX));
    expect(state!.routes[0].name).toBe("Tabs");
  });

  it("garbage that looks bech32-ish falls through without crashing", () => {
    expect(resolve("npub1notvalidbech32")).toBeUndefined();
  });
});

describe("https/app-scheme paths (config table)", () => {
  it("profile/:pubkey → Profile", () => {
    const top = topRoute(`profile/${HEX}`);
    expect(top.name).toBe("Profile");
    expect(top.params).toMatchObject({ pubkey: HEX });
  });

  it("invite/:code → JoinSpace", () => {
    const top = topRoute("invite/abc123");
    expect(top.name).toBe("JoinSpace");
    expect(top.params).toMatchObject({ code: "abc123" });
  });

  it("dm/:pubkey lands in the Messages tab conversation", () => {
    const state = resolve(`dm/${HEX}`);
    expect(JSON.stringify(state)).toContain("DMConversation");
  });
});
