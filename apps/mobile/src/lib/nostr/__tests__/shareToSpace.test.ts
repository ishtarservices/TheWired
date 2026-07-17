import { generateSecretKey } from "nostr-tools";
import type { NostrEvent } from "@thewired/shared-types";

import { LocalNsecSigner } from "@/auth/LocalNsecSigner";
import type { PlatformAdapters, WebSocketLike } from "@/core/adapters";
import { postNoteRefToChannel } from "../shareToSpace";
import { verifyEventSync } from "../verifyEvent";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  frames(): unknown[][] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
  lastEvent(): NostrEvent | undefined {
    const frames = this.frames().filter((f) => f[0] === "EVENT");
    return frames.length ? (frames[frames.length - 1][1] as NostrEvent) : undefined;
  }
}

function makeAdapters() {
  const sockets: FakeSocket[] = [];
  const adapters = {
    ws: {
      create() {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    },
    verifier: { verify: async (event: NostrEvent) => verifyEventSync(event) },
    signer: new LocalNsecSigner(generateSecretKey()),
  } as unknown as PlatformAdapters;
  return { adapters, sockets };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 40));

function sharePromise(adapters: PlatformAdapters, isDefault = false) {
  return postNoteRefToChannel({
    adapters,
    relayUrl: "wss://host.example",
    spaceId: "space-1",
    channelId: "chan-1",
    isDefaultChannel: isDefault,
    content: "nostr:nevent1qqstest",
  });
}

describe("postNoteRefToChannel", () => {
  it("posts a kind-9 with h + channel tags, resolves on OK, closes the socket", async () => {
    const { adapters, sockets } = makeAdapters();
    const done = sharePromise(adapters);
    await flush();
    sockets[0].open();
    await flush();

    const event = sockets[0].lastEvent();
    expect(event?.kind).toBe(9);
    expect(event?.tags).toEqual([
      ["h", "space-1"],
      ["channel", "chan-1"],
    ]);
    expect(event?.content).toBe("nostr:nevent1qqstest");

    sockets[0].message(["OK", event!.id, true, ""]);
    await expect(done).resolves.toBeUndefined();
    expect(sockets[0].readyState).toBe(3); // destroyed
  });

  it("omits the channel tag for the default channel", async () => {
    const { adapters, sockets } = makeAdapters();
    const done = sharePromise(adapters, true);
    await flush();
    sockets[0].open();
    await flush();

    const event = sockets[0].lastEvent();
    expect(event?.tags).toEqual([["h", "space-1"]]);
    sockets[0].message(["OK", event!.id, true, ""]);
    await done;
  });

  it("retries once when the relay refuses with an auth-required reason", async () => {
    const { adapters, sockets } = makeAdapters();
    const done = sharePromise(adapters);
    await flush();
    sockets[0].open();
    await flush();

    const first = sockets[0].lastEvent();
    sockets[0].message(["OK", first!.id, false, "auth-required: join the space"]);
    // Retry fires after ~600ms. (Both signs can land in the same second and
    // produce identical ids — count EVENT frames, don't compare ids.)
    await new Promise((resolve) => setTimeout(resolve, 700));

    const eventFrames = sockets[0].frames().filter((f) => f[0] === "EVENT");
    expect(eventFrames).toHaveLength(2);
    const second = eventFrames[1][1] as NostrEvent;
    sockets[0].message(["OK", second.id, true, ""]);
    await expect(done).resolves.toBeUndefined();
  });

  it("surfaces non-auth refusals verbatim and still closes the socket", async () => {
    const { adapters, sockets } = makeAdapters();
    const done = sharePromise(adapters);
    await flush();
    sockets[0].open();
    await flush();

    const event = sockets[0].lastEvent();
    sockets[0].message(["OK", event!.id, false, "blocked: not a member"]);
    await expect(done).rejects.toThrow("blocked: not a member");
    expect(sockets[0].readyState).toBe(3);
  });
});
