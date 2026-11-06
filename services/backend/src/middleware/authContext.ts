import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { config } from "../config.js";
import { recordAccountClient, WIRED_CLIENT_HEADER } from "../services/accountClients.js";

/**
 * Identity headers set by the gateway: X-Auth-Pubkey after NIP-98
 * verification, X-Client-Ip for the guest report intake. The gateway also
 * sends X-Gateway-Auth, an HMAC over both, so this hook can tell a
 * gateway-vouched identity from a header planted by anything else that can
 * reach the backend port.
 *
 * Wire format (gateway services/gateway/internal/gatewayauth):
 *
 *   X-Gateway-Auth: <unix_ts>.<hex HMAC-SHA256(GATEWAY_SHARED_SECRET, msg)>
 *   msg = ts + "\n" + pubkey + "\n" + METHOD + "\n" + path + "\n" + clientIp
 *
 * `path` is this request's path as received (no query string, percent-encoded
 * as on the wire — the gateway signs the /api-stripped path it forwards);
 * `pubkey` / `clientIp` are the exact header values, "" when absent.
 */

export type GatewayAuthMode = "off" | "warn" | "enforce";

export const GATEWAY_AUTH_HEADER = "x-gateway-auth";
export const AUTH_PUBKEY_HEADER = "x-auth-pubkey";
export const CLIENT_IP_HEADER = "x-client-ip";
/** |now - ts| allowed, in seconds. Both containers share the host clock. */
export const GATEWAY_AUTH_MAX_SKEW_SECONDS = 120;
const WARN_INTERVAL_MS = 60_000;

export interface AuthContextOptions {
  mode: GatewayAuthMode;
  secret: string;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
  /** Where the (rate-limited) mismatch warnings go; defaults to console.warn. */
  warn?: (message: string) => void;
}

export function gatewayAuthMac(
  secret: string,
  ts: number,
  pubkey: string,
  method: string,
  path: string,
  clientIp: string,
): string {
  return createHmac("sha256", secret)
    .update(`${ts}\n${pubkey}\n${method}\n${path}\n${clientIp}`)
    .digest("hex");
}

type VerifyResult = "ok" | "missing" | "malformed" | "stale" | "mismatch";

function verifyGatewayAuth(
  header: string | undefined,
  opts: { secret: string; pubkey: string; clientIp: string; method: string; path: string; nowSeconds: number },
): VerifyResult {
  if (!header) return "missing";
  const dot = header.indexOf(".");
  if (dot <= 0) return "malformed";
  const tsStr = header.slice(0, dot);
  const mac = header.slice(dot + 1);
  if (!/^\d{1,12}$/.test(tsStr) || !/^[0-9a-f]{64}$/.test(mac)) return "malformed";
  const ts = Number(tsStr);
  if (Math.abs(opts.nowSeconds - ts) > GATEWAY_AUTH_MAX_SKEW_SECONDS) return "stale";
  const expected = gatewayAuthMac(opts.secret, ts, opts.pubkey, opts.method, opts.path, opts.clientIp);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(mac, "hex")) ? "ok" : "mismatch";
}

function headerString(request: FastifyRequest, name: string): string {
  const v = request.headers[name];
  return typeof v === "string" ? v : "";
}

/** Build the identity hook. The default export below is configured from env;
 *  tests build their own with explicit options. */
export function createAuthContext(opts: AuthContextOptions) {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const emit = opts.warn ?? ((message: string) => console.warn(message));
  let lastWarnAt = 0;
  const warnThrottled = (message: string) => {
    const t = Date.now();
    if (t - lastWarnAt < WARN_INTERVAL_MS) return;
    lastWarnAt = t;
    emit(message);
  };

  return function authContext(request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) {
    const pubkey = headerString(request, AUTH_PUBKEY_HEADER);
    const clientIp = headerString(request, CLIENT_IP_HEADER);

    if (opts.mode !== "off" && (pubkey !== "" || clientIp !== "")) {
      let verdict: VerifyResult | "no-secret";
      if (opts.secret === "") {
        verdict = "no-secret";
      } else {
        const rawUrl = request.raw.url ?? request.url;
        const q = rawUrl.indexOf("?");
        verdict = verifyGatewayAuth(headerString(request, GATEWAY_AUTH_HEADER) || undefined, {
          secret: opts.secret,
          pubkey,
          clientIp,
          method: request.method,
          path: q === -1 ? rawUrl : rawUrl.slice(0, q),
          nowSeconds: now(),
        });
      }
      if (verdict !== "ok") {
        warnThrottled(
          verdict === "no-secret"
            ? `GATEWAY_AUTH_MODE=${opts.mode} but GATEWAY_SHARED_SECRET is empty: identity headers cannot be verified`
            : `X-Gateway-Auth ${verdict} on ${request.method} ${request.url} (mode=${opts.mode}); identity header present without a valid gateway MAC`,
        );
        if (opts.mode === "enforce") {
          // Routes read x-auth-pubkey directly too, so the header itself goes.
          delete request.headers[AUTH_PUBKEY_HEADER];
          delete request.headers[CLIENT_IP_HEADER];
          delete request.headers[GATEWAY_AUTH_HEADER];
          done();
          return;
        }
      }
    }

    if (pubkey.length === 64) {
      (request as any).pubkey = pubkey;
      // Which of our apps this account uses (activity report). Throttled and
      // fire-and-forget inside; a missing or malformed header is a no-op.
      try {
        recordAccountClient(pubkey, headerString(request, WIRED_CLIENT_HEADER) || undefined);
      } catch {
        // Informational only: never let it fail the request.
      }
    }
    done();
  };
}

/** Extract pubkey from X-Auth-Pubkey header (set by gateway after NIP-98 verification) */
export const authContext = createAuthContext({
  mode: config.gatewayAuth.mode,
  secret: config.gatewayAuth.secret,
});
