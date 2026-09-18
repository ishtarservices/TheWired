/**
 * Expo Push Service client (plain fetch, no SDK): send chunking at 100,
 * receipt chunking at 1000, ticket-count validation, non-OK and malformed
 * responses, and the optional access-token header. Pure unit tests over an
 * injected fake fetch — no network, no DB.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createExpoSender,
  EXPO_PUSH_URL,
  EXPO_RECEIPTS_URL,
  EXPO_SEND_CHUNK,
  EXPO_RECEIPT_CHUNK,
  isExpoPushToken,
  type ExpoPushMessage,
  type ExpoTicket,
} from "../../src/services/expoPushSender.js";
import { config } from "../../src/config.js";

const msg = (i: number): ExpoPushMessage => ({ to: `ExponentPushToken[t${i}]`, body: `m${i}` });

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** fetch that answers each send chunk with one ok ticket per message. */
function fakeFetch(handler: (url: string, body: unknown) => unknown) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body));
    const out = handler(String(url), parsed);
    if (out instanceof Response || (typeof out === "object" && out !== null && "ok" in (out as object))) {
      return out as Response;
    }
    return okJson(out);
  });
}

afterEach(() => {
  config.expoAccessToken = "";
});

describe("send", () => {
  it("chunks at 100 and returns tickets in message order across chunks", async () => {
    const fetchImpl = fakeFetch((_url, body) => ({
      data: (body as ExpoPushMessage[]).map((m): ExpoTicket => ({ status: "ok", id: `id-${m.body}` })),
    }));
    const sender = createExpoSender(fetchImpl as unknown as typeof fetch);

    const messages = Array.from({ length: 150 }, (_, i) => msg(i));
    const tickets = await sender.send(messages);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calls = fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(calls[0]).toHaveLength(EXPO_SEND_CHUNK);
    expect(calls[1]).toHaveLength(50);
    expect(fetchImpl.mock.calls.every((c) => String(c[0]) === EXPO_PUSH_URL)).toBe(true);
    expect(tickets).toHaveLength(150);
    expect(tickets[0].id).toBe("id-m0");
    expect(tickets[149].id).toBe("id-m149");
  });

  it("throws on a non-OK response and on a malformed ticket payload", async () => {
    const bad = fakeFetch(() => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(createExpoSender(bad as unknown as typeof fetch).send([msg(0)])).rejects.toThrow(
      "expo push 503",
    );

    // data missing entirely
    const noData = fakeFetch(() => ({ errors: [{ code: "oops" }] }));
    await expect(createExpoSender(noData as unknown as typeof fetch).send([msg(0)])).rejects.toThrow(
      "malformed ticket response",
    );

    // ticket count doesn't match the chunk — indexing tickets to devices
    // would silently misattribute, so it must throw instead
    const short = fakeFetch(() => ({ data: [] as ExpoTicket[] }));
    await expect(
      createExpoSender(short as unknown as typeof fetch).send([msg(0), msg(1)]),
    ).rejects.toThrow("malformed ticket response");
  });

  it("sends the access token only when configured", async () => {
    const fetchImpl = fakeFetch((_url, body) => ({
      data: (body as ExpoPushMessage[]).map((): ExpoTicket => ({ status: "ok" })),
    }));
    const sender = createExpoSender(fetchImpl as unknown as typeof fetch);

    await sender.send([msg(0)]);
    let headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();

    config.expoAccessToken = "secret-token";
    await sender.send([msg(0)]);
    headers = (fetchImpl.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret-token");
  });
});

describe("receipts", () => {
  it("chunks at 1000 and merges the receipt maps", async () => {
    const fetchImpl = fakeFetch((_url, body) => {
      const ids = (body as { ids: string[] }).ids;
      return { data: Object.fromEntries(ids.map((id) => [id, { status: "ok" }])) };
    });
    const sender = createExpoSender(fetchImpl as unknown as typeof fetch);

    const ids = Array.from({ length: 1500 }, (_, i) => `t${i}`);
    const receipts = await sender.receipts(ids);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calls = fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(calls[0].ids).toHaveLength(EXPO_RECEIPT_CHUNK);
    expect(calls[1].ids).toHaveLength(500);
    expect(fetchImpl.mock.calls.every((c) => String(c[0]) === EXPO_RECEIPTS_URL)).toBe(true);
    expect(Object.keys(receipts)).toHaveLength(1500);
    expect(receipts.t0).toEqual({ status: "ok" });
    expect(receipts.t1499).toEqual({ status: "ok" });
  });

  it("throws on a non-OK response and tolerates a missing data field", async () => {
    const bad = fakeFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(createExpoSender(bad as unknown as typeof fetch).receipts(["t"])).rejects.toThrow(
      "expo receipts 500",
    );

    const empty = fakeFetch(() => ({}));
    expect(await createExpoSender(empty as unknown as typeof fetch).receipts(["t"])).toEqual({});
  });
});

describe("isExpoPushToken", () => {
  it("accepts both prefixes, rejects everything else", () => {
    expect(isExpoPushToken("ExponentPushToken[abc-123_XYZ]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc]")).toBe(true);
    expect(isExpoPushToken("apns-hex-token")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
  });
});
