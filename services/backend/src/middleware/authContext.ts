import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";

/** Extract pubkey from X-Auth-Pubkey header (set by gateway after NIP-98 verification) */
export function authContext(request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) {
  const pubkey = request.headers["x-auth-pubkey"];
  if (typeof pubkey === "string" && pubkey.length === 64) {
    (request as any).pubkey = pubkey;
  }
  done();
}
