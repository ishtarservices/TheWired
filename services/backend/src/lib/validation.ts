import { z } from "zod";
import type { FastifyReply } from "fastify";

/** Parse input with a Zod schema, sending 400 on failure. Returns parsed data or null. */
export function validate<S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.output<S> | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.status(400).send({
      error: "Validation error",
      details: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return null;
  }
  return result.data;
}

// ── Reusable field schemas ──

/** 64-character lowercase hex string (Nostr pubkey / event ID) */
export const hexId = z.string().regex(/^[0-9a-f]{64}$/, "Must be a 64-character hex string");

/** Positive integer with optional upper bound */
export const positiveInt = (max?: number) => {
  let s = z.coerce.number().int().min(1);
  if (max !== undefined) s = s.max(max);
  return s;
};

/** Non-negative integer */
export const nonNegativeInt = z.coerce.number().int().min(0);

/** Non-empty trimmed string */
export const nonEmptyString = z.string().min(1).trim();

/** Optional bounded limit with default */
export const limitParam = (def: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(def);

/** Optional non-negative offset */
export const offsetParam = z.coerce.number().int().min(0).default(0);
