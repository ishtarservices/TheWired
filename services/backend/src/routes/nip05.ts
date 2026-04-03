import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../db/connection.js";
import { nip05Identities } from "../db/schema/nip05.js";
import { eq } from "drizzle-orm";
import { validate, nonEmptyString } from "../lib/validation.js";

const nostrJsonQuery = z.object({
  name: z.string().optional(),
});

const checkUsernameParams = z.object({
  username: z.string().min(1).max(30).transform((s) => s.toLowerCase()),
});

const registerBody = z.object({
  username: nonEmptyString,
});

const USERNAME_REGEX = /^[a-z0-9_.-]{1,30}$/;
const RESERVED_USERNAMES = new Set([
  "_", "admin", "root", "system", "thewired", "wired",
  "relay", "api", "www", "mail", "support", "help",
  "info", "noreply", "postmaster", "webmaster",
]);

export const nip05Routes: FastifyPluginAsync = async (server) => {
  /**
   * GET /.well-known/nostr.json?name=<username>
   * NIP-05 identity verification endpoint.
   * Must be served from thewired.app (Caddy proxies here).
   */
  server.get("/.well-known/nostr.json", async (request, reply) => {
    const query = validate(nostrJsonQuery, request.query, reply);
    if (!query) return;

    const { name } = query;

    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Content-Type", "application/json");

    if (!name) {
      return { names: {}, relays: {} };
    }

    const lower = name.toLowerCase();
    const row = await db
      .select()
      .from(nip05Identities)
      .where(eq(nip05Identities.username, lower))
      .limit(1);

    if (row.length === 0) {
      return { names: {}, relays: {} };
    }

    const pubkey = row[0].pubkey;
    return {
      names: { [lower]: pubkey },
      relays: { [pubkey]: ["wss://relay.thewired.app"] },
    };
  });
};

export const nip05ApiRoutes: FastifyPluginAsync = async (server) => {
  /**
   * GET /check/:username — Check if a username is available
   */
  server.get<{ Params: { username: string } }>("/check/:username", async (request, reply) => {
    const params = validate(checkUsernameParams, request.params, reply);
    if (!params) return;

    const username = params.username;

    if (!USERNAME_REGEX.test(username)) {
      return { data: { available: false, reason: "Invalid username. Use a-z, 0-9, _, ., - (1-30 chars)." } };
    }
    if (RESERVED_USERNAMES.has(username)) {
      return { data: { available: false, reason: "This username is reserved." } };
    }

    const existing = await db
      .select({ username: nip05Identities.username })
      .from(nip05Identities)
      .where(eq(nip05Identities.username, username))
      .limit(1);

    return { data: { available: existing.length === 0 } };
  });

  /**
   * POST /register — Claim a username (requires auth)
   * Body: { username: string }
   */
  server.post("/register", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED", statusCode: 401 });
    }

    const body = validate(registerBody, request.body, reply);
    if (!body) return;

    const { username } = body;

    const lower = username.toLowerCase();

    if (!USERNAME_REGEX.test(lower)) {
      return reply.status(400).send({
        error: "Invalid username. Use a-z, 0-9, _, ., - (1-30 chars).",
        code: "INVALID_USERNAME", statusCode: 400,
      });
    }
    if (RESERVED_USERNAMES.has(lower)) {
      return reply.status(400).send({
        error: "This username is reserved.",
        code: "RESERVED_USERNAME", statusCode: 400,
      });
    }

    // Check if this pubkey already has a username
    const existingForPubkey = await db
      .select({ username: nip05Identities.username })
      .from(nip05Identities)
      .where(eq(nip05Identities.pubkey, pubkey))
      .limit(1);

    if (existingForPubkey.length > 0) {
      return reply.status(409).send({
        error: `You already have the username "${existingForPubkey[0].username}@thewired.app". Release it first to claim a new one.`,
        code: "ALREADY_REGISTERED", statusCode: 409,
      });
    }

    // Try to insert (unique constraint on username handles races)
    try {
      await db.insert(nip05Identities).values({
        username: lower,
        pubkey,
      });
    } catch (err: any) {
      if (err.code === "23505") {
        return reply.status(409).send({
          error: "This username is already taken.",
          code: "USERNAME_TAKEN", statusCode: 409,
        });
      }
      throw err;
    }

    return { data: { username: lower, nip05: `${lower}@thewired.app` } };
  });

  /**
   * GET /me — Get the current user's NIP-05 identity
   */
  server.get("/me", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED", statusCode: 401 });
    }

    const row = await db
      .select()
      .from(nip05Identities)
      .where(eq(nip05Identities.pubkey, pubkey))
      .limit(1);

    if (row.length === 0) {
      return { data: null };
    }

    return { data: { username: row[0].username, nip05: `${row[0].username}@thewired.app` } };
  });

  /**
   * DELETE /me — Release the current user's username
   */
  server.delete("/me", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED", statusCode: 401 });
    }

    const result = await db
      .delete(nip05Identities)
      .where(eq(nip05Identities.pubkey, pubkey))
      .returning({ username: nip05Identities.username });

    if (result.length === 0) {
      return reply.status(404).send({ error: "No NIP-05 identity found", code: "NOT_FOUND", statusCode: 404 });
    }

    return { data: { released: result[0].username } };
  });
};
