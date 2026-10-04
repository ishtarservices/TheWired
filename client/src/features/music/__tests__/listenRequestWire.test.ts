import { describe, it, expect } from "vitest";
import {
  LISTEN_REQUEST_COOLDOWN_SEC,
  buildListenRequestEvent,
  canAskAgain,
  isListenRequest,
  listenRequestId,
  parseListenTarget,
} from "../listenRequestWire";
import { parseProposalRow, parseProposalRows } from "../proposalRows";

const OWNER = "b".repeat(64);
const ME = "a".repeat(64);
const TRACK_REF = `31683:${OWNER}:spiral`;

describe("listenRequestId", () => {
  it("matches the pinned soot vector", () => {
    expect(listenRequestId(TRACK_REF)).toBe("req-3eb5a7e1050d0fa3");
  });

  it("is deterministic per target and distinct across targets", () => {
    expect(listenRequestId(TRACK_REF)).toBe(listenRequestId(TRACK_REF));
    expect(listenRequestId(`33123:${OWNER}:spiral`)).not.toBe(listenRequestId(TRACK_REF));
    expect(listenRequestId(TRACK_REF)).toMatch(/^req-[0-9a-f]{16}$/);
  });
});

describe("parseListenTarget", () => {
  it("accepts track and project refs, keeps colons in d", () => {
    expect(parseListenTarget(TRACK_REF)).toEqual({ ref: TRACK_REF, kind: 31683, ownerPubkey: OWNER, d: "spiral" });
    expect(parseListenTarget(`33123:${OWNER}:a:b`)?.d).toBe("a:b");
  });

  it("rejects other kinds and malformed owners", () => {
    expect(parseListenTarget(`30119:${OWNER}:x`)).toBeNull();
    expect(parseListenTarget(`31683:abc:x`)).toBeNull();
    expect(parseListenTarget(`31683:${OWNER}:`)).toBeNull();
  });
});

describe("buildListenRequestEvent", () => {
  it("emits the soot wire shape byte-for-byte", () => {
    const ev = buildListenRequestEvent(ME, TRACK_REF);
    expect(ev.kind).toBe(31685);
    expect(ev.pubkey).toBe(ME);
    expect(ev.tags).toEqual([
      ["d", "req-3eb5a7e1050d0fa3"],
      ["a", TRACK_REF],
      ["p", OWNER],
      ["status", "open"],
    ]);
    expect(ev.content).toBe('{"title":"listen request","changes":[{"type":"grant_access","role":"viewer"}]}');
  });

  it("refuses your own release and garbage refs", () => {
    expect(() => buildListenRequestEvent(OWNER, TRACK_REF)).toThrow();
    expect(() => buildListenRequestEvent(ME, "nope")).toThrow();
  });
});

describe("canAskAgain", () => {
  it("only after the 7-day cooldown", () => {
    expect(canAskAgain(1000, 1000 + LISTEN_REQUEST_COOLDOWN_SEC - 1)).toBe(false);
    expect(canAskAgain(1000, 1000 + LISTEN_REQUEST_COOLDOWN_SEC)).toBe(true);
  });
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "row1",
    proposalId: "req-3eb5a7e1050d0fa3",
    addressableId: `31685:${ME}:req-3eb5a7e1050d0fa3`,
    targetAlbum: TRACK_REF,
    proposerPubkey: ME,
    ownerPubkey: OWNER,
    title: "listen request",
    description: null,
    changes: [{ type: "grant_access", role: "viewer" }],
    status: "open",
    eventId: "e".repeat(64),
    createdAt: 1_700_000_000,
    resolvedAt: null,
    ...overrides,
  };
}

describe("parseProposalRow", () => {
  it("parses a listen request row", () => {
    const p = parseProposalRow(row());
    expect(p).not.toBeNull();
    expect(p!.changes).toEqual([{ type: "grant_access", role: "viewer" }]);
    expect(p!.description).toBeUndefined();
    expect(p!.resolvedAt).toBeUndefined();
    expect(isListenRequest(p!)).toBe(true);
  });

  it("drops malformed rows without throwing", () => {
    expect(parseProposalRow(null)).toBeNull();
    expect(parseProposalRow("x")).toBeNull();
    expect(parseProposalRow(row({ id: "" }))).toBeNull();
    expect(parseProposalRow(row({ proposerPubkey: "short" }))).toBeNull();
    expect(parseProposalRow(row({ ownerPubkey: OWNER.toUpperCase() }))).toBeNull();
    expect(parseProposalRow(row({ targetAlbum: `30023:${OWNER}:x` }))).toBeNull();
    expect(parseProposalRow(row({ status: "maybe" }))).toBeNull();
    expect(parseProposalRow(row({ createdAt: "yesterday" }))).toBeNull();
    expect(parseProposalRow(row({ changes: "nope" }))).toBeNull();
    expect(parseProposalRow(row({ changes: [{ type: "grant_access", role: "editor" }] }))).toBeNull();
  });

  it("refuses tracklist changes aimed at a single track", () => {
    expect(
      parseProposalRow(row({ changes: [{ type: "add_track", trackRef: `31683:${OWNER}:x` }] })),
    ).toBeNull();
  });

  it("keeps tracklist proposals on projects and marks them non-requests", () => {
    const p = parseProposalRow(
      row({
        targetAlbum: `33123:${OWNER}:lp`,
        changes: [{ type: "reorder", from: 0, to: 2 }, { type: "bogus" }],
      }),
    );
    expect(p?.changes).toEqual([{ type: "reorder", from: 0, to: 2 }]);
    expect(isListenRequest(p!)).toBe(false);
  });

  it("parseProposalRows filters bad rows and tolerates bad payloads", () => {
    expect(parseProposalRows({ data: [row(), { junk: true }, row({ id: "row2" })] }).map((p) => p.id)).toEqual([
      "row1",
      "row2",
    ]);
    expect(parseProposalRows(null)).toEqual([]);
    expect(parseProposalRows({ data: "x" })).toEqual([]);
  });
});
