import { verifyEvent } from "nostr-tools";
import type { FastifyRequest } from "fastify";
import { config } from "../config.js";

export interface BlossomAuthOk {
  ok: true;
  pubkey: string;
  xTags: string[];
}

export interface BlossomAuthErr {
  ok: false;
  status: number;
  reason: string;
}

export type BlossomAuthResult = BlossomAuthOk | BlossomAuthErr;

/**
 * Verify a Blossom kind 24242 Authorization header per BUD-11.
 */
export function verifyBlossomAuth(
  request: FastifyRequest,
  requiredAction: "upload" | "get" | "delete" | "list",
  requiredHash?: string,
): BlossomAuthResult {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Nostr ")) {
    return { ok: false, status: 401, reason: "Authorization required" };
  }

  let eventJson: string;
  try {
    const token = header.slice(6);
    eventJson = atob(token);
  } catch {
    return { ok: false, status: 401, reason: "Invalid base64 encoding" };
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(eventJson);
  } catch {
    return { ok: false, status: 401, reason: "Invalid JSON" };
  }

  // BUD-11: kind must be 24242
  if (event.kind !== 24242) {
    return { ok: false, status: 401, reason: "Event kind must be 24242" };
  }

  const tags = event.tags as string[][];
  if (!Array.isArray(tags)) {
    return { ok: false, status: 401, reason: "Missing tags" };
  }

  // created_at must not be in the future (allow 60s clock drift)
  const now = Math.floor(Date.now() / 1000);
  if ((event.created_at as number) > now + 60) {
    return { ok: false, status: 401, reason: "Event created_at is in the future" };
  }

  // Expiration tag must exist and be in the future
  const expiration = getTagValue(tags, "expiration");
  if (!expiration || parseInt(expiration, 10) <= now) {
    return { ok: false, status: 401, reason: "Missing or expired expiration tag" };
  }

  // t tag must match required action
  const action = getTagValue(tags, "t");
  if (action !== requiredAction) {
    return { ok: false, status: 401, reason: `Expected t=${requiredAction}, got t=${action}` };
  }

  // Server tag validation (if present)
  const serverTags = getTagValues(tags, "server");
  if (serverTags.length > 0) {
    const ourDomain = new URL(config.publicUrl).hostname;
    if (!serverTags.includes(ourDomain)) {
      return { ok: false, status: 403, reason: "Server not authorized by auth token" };
    }
  }

  // x tag validation
  const xTags = getTagValues(tags, "x");
  if (requiredHash && xTags.length > 0 && !xTags.includes(requiredHash)) {
    return { ok: false, status: 403, reason: "Hash not authorized by auth token x-tags" };
  }

  // Verify schnorr signature (most expensive, do last)
  if (!verifyEvent(event as Parameters<typeof verifyEvent>[0])) {
    return { ok: false, status: 401, reason: "Invalid signature" };
  }

  return { ok: true, pubkey: event.pubkey as string, xTags };
}

function getTagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

function getTagValues(tags: string[][], name: string): string[] {
  return tags.filter((t) => t[0] === name).map((t) => t[1]);
}
