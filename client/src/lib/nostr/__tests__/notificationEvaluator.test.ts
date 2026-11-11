import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import type { Space } from "@/types/space";

vi.mock("@/features/notifications/browserNotify", () => ({ showBrowserNotification: vi.fn() }));

import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { setSpaces, setChannels } from "@/store/slices/spacesSlice";
import { setSpaceNotifSettings, setSpaceMute, DEFAULT_SPACE_NOTIF_MODE } from "@/store/slices/notificationSlice";
import { evaluateNotification } from "../notificationEvaluator";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const SPACE = "space-1";
const CHANNEL = `${SPACE}:c1`;

const space: Space = {
  id: SPACE,
  name: "Space",
  hostRelay: "wss://host.example",
  mode: "read-write",
  isPrivate: false,
  adminPubkeys: [OTHER],
  memberPubkeys: [ME, OTHER],
  feedPubkeys: [],
  creatorPubkey: OTHER,
  createdAt: 0,
  spaceType: "platform",
};

let seq = 0;
function chat(opts: { mention?: boolean; content?: string } = {}): NostrEvent {
  seq += 1;
  return {
    id: seq.toString(16).padStart(64, "0"),
    pubkey: OTHER,
    kind: 9,
    created_at: Math.floor(Date.now() / 1000) + seq,
    tags: [["h", SPACE], ...(opts.mention ? [["p", ME]] : [])],
    content: opts.content ?? "hello",
    sig: "0".repeat(128),
  };
}

const n = () => store.getState().notifications;
const mentionToasts = () => n().notifications.filter((x) => x.type === "mention");

beforeEach(() => {
  store.dispatch(resetAll());
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
  store.dispatch(setSpaces([space]));
  store.dispatch(
    setChannels({
      spaceId: SPACE,
      channels: [
        {
          id: "c1",
          spaceId: SPACE,
          type: "chat",
          label: "#chat",
          position: 0,
          isDefault: true,
          adminOnly: false,
          slowModeSeconds: 0,
          feedMode: "all",
        },
      ],
    }),
  );
});

const setMode = (mode: "all" | "mentions" | "nothing") =>
  store.dispatch(
    setSpaceNotifSettings({
      spaceId: SPACE,
      settings: { mode, suppressEveryone: false, suppressRoleMentions: false },
    }),
  );

describe("space chat notification modes", () => {
  it("default to 'mentions', the server's and the mobile app's default", () => {
    expect(DEFAULT_SPACE_NOTIF_MODE).toBe("mentions");
  });

  it("defaults to mentions: a mention badges and toasts, a plain message only counts unread", () => {
    evaluateNotification(chat({ mention: true }));
    expect(n().spaceMentions[SPACE]).toBe(1);
    expect(mentionToasts()).toHaveLength(1);

    evaluateNotification(chat());
    expect(n().spaceMentions[SPACE]).toBe(1);
    expect(n().channelUnread[CHANNEL]).toBe(2);
    expect(mentionToasts()).toHaveLength(1);
  });

  it("'nothing' keeps mentions to the unread dot: no badge, no toast", () => {
    setMode("nothing");
    evaluateNotification(chat({ mention: true }));
    evaluateNotification(chat());
    expect(n().spaceMentions[SPACE] ?? 0).toBe(0);
    expect(mentionToasts()).toHaveLength(0);
    expect(n().channelUnread[CHANNEL]).toBe(2);
  });

  it("'all' still badges and toasts mentions", () => {
    setMode("all");
    evaluateNotification(chat({ mention: true }));
    expect(n().spaceMentions[SPACE]).toBe(1);
    expect(mentionToasts()).toHaveLength(1);
  });

  it("a muted space silences everything, mentions included", () => {
    store.dispatch(setSpaceMute({ spaceId: SPACE, mute: { muted: true } }));
    evaluateNotification(chat({ mention: true }));
    expect(n().spaceMentions[SPACE] ?? 0).toBe(0);
    expect(n().channelUnread[CHANNEL] ?? 0).toBe(0);
    expect(mentionToasts()).toHaveLength(0);
  });
});
