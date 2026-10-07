import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode, npubEncode } from "nostr-tools/nip19";
import {
  GIFT_WRAP_ACCEPT_KINDS,
  KIND_DM_PROJECT_KEY,
  buildProjectKeyDMContent,
  parseProjectKeyDM,
  projectPubkeyOf,
} from "../sharedKey/projectKeyDM";

const ME = "a".repeat(64);
const PARTNER = "b".repeat(64);
const OTHER = "c".repeat(64);

const projectSk = generateSecretKey();
const projectPk = getPublicKey(projectSk);
const coord = `33123:${projectPk}:basement-tapes`;

function dm(over: Partial<{ kind: number; sender: string; tags: string[][]; content: string }> = {}) {
  return {
    kind: KIND_DM_PROJECT_KEY,
    sender: PARTNER,
    tags: [["p", ME]],
    content: buildProjectKeyDMContent(coord, projectSk),
    createdAt: 1_700_000_000,
    ...over,
  };
}

describe("project key DM", () => {
  it("accepts kind 20017 alongside the DM rumor kinds", () => {
    expect(GIFT_WRAP_ACCEPT_KINDS).toContain(14);
    expect(GIFT_WRAP_ACCEPT_KINDS).toContain(KIND_DM_PROJECT_KEY);
  });

  it("parses a valid key DM", () => {
    const grant = parseProjectKeyDM(dm(), ME);
    expect(grant).not.toBeNull();
    expect(grant!.projectPubkey).toBe(projectPk);
    expect(grant!.coord).toBe(coord);
    expect(getPublicKey(grant!.secretKey)).toBe(projectPk);
    expect(grant!.sentAt).toBe(1_700_000_000);
  });

  it("accepts my own self-wrap echo (sender = me, p = the recipient)", () => {
    expect(parseProjectKeyDM(dm({ sender: ME, tags: [["p", PARTNER]] }), ME)).not.toBeNull();
  });

  it("drops another rumor kind", () => {
    expect(parseProjectKeyDM(dm({ kind: 14 }), ME)).toBeNull();
  });

  it("drops a room (g tag) or a multi-recipient rumor", () => {
    expect(parseProjectKeyDM(dm({ tags: [["p", ME], ["g", "room"]] }), ME)).toBeNull();
    expect(parseProjectKeyDM(dm({ tags: [["p", ME], ["p", OTHER]] }), ME)).toBeNull();
    expect(parseProjectKeyDM(dm({ tags: [] }), ME)).toBeNull();
  });

  it("drops a 1:1 between two other people", () => {
    expect(parseProjectKeyDM(dm({ sender: PARTNER, tags: [["p", OTHER]] }), ME)).toBeNull();
  });

  it("drops bad JSON, a wrong version or missing fields", () => {
    expect(parseProjectKeyDM(dm({ content: "not json" }), ME)).toBeNull();
    expect(parseProjectKeyDM(dm({ content: "null" }), ME)).toBeNull();
    const nsec = nsecEncode(projectSk);
    expect(parseProjectKeyDM(dm({ content: JSON.stringify({ v: 2, a: coord, nsec }) }), ME)).toBeNull();
    expect(parseProjectKeyDM(dm({ content: JSON.stringify({ v: 1, a: coord }) }), ME)).toBeNull();
  });

  it("drops a coordinate that isn't a 33123 project", () => {
    const nsec = nsecEncode(projectSk);
    for (const a of [`31683:${projectPk}:t`, `33123:${projectPk}:`, `33123:${projectPk.toUpperCase()}:d`, "33123:abc:d"]) {
      expect(parseProjectKeyDM(dm({ content: JSON.stringify({ v: 1, a, nsec }) }), ME)).toBeNull();
    }
  });

  it("drops an nsec that doesn't match the coordinate's pubkey", () => {
    const content = JSON.stringify({ v: 1, a: coord, nsec: nsecEncode(generateSecretKey()) });
    expect(parseProjectKeyDM(dm({ content }), ME)).toBeNull();
  });

  it("drops a non-nsec bech32 value", () => {
    const content = JSON.stringify({ v: 1, a: coord, nsec: npubEncode(projectPk) });
    expect(parseProjectKeyDM(dm({ content }), ME)).toBeNull();
  });

  it("refuses a 'project' that is my own account key", () => {
    const mySk = generateSecretKey();
    const myPk = getPublicKey(mySk);
    const content = buildProjectKeyDMContent(`33123:${myPk}:x`, mySk);
    expect(parseProjectKeyDM(dm({ content, tags: [["p", myPk]] }), myPk)).toBeNull();
  });

  it("reads the project pubkey from a coordinate", () => {
    expect(projectPubkeyOf(coord)).toBe(projectPk);
    expect(projectPubkeyOf("31683:x:y")).toBeNull();
  });
});
