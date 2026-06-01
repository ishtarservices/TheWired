import { createHash } from "node:crypto";
import { db } from "../db/connection.js";
import { relayTunnels } from "../db/schema/relays.js";
import { config } from "../config.js";

/**
 * Provisions per-user *named* Cloudflare tunnels for self-hosted embedded relays
 * (Decentralized Spaces, PACKAGES_DESIGN §6 / M7).
 *
 * The user's machine runs a loopback-only NIP-29 relay ([client] `relay.rs`) and
 * a `cloudflared` connector. To give that connector a stable, branded public
 * address we create a Cloudflare tunnel + a CNAME `<id>.relay.thewired.app →
 * <tunnel>.cfargotunnel.com`. The connector secret is generated and kept on the
 * user's device — we only relay it to Cloudflare at create time and never store
 * it. The subdomain `<id>` is derived from the *authenticated* owner pubkey, so
 * a caller can't squat someone else's name, and each user gets exactly one
 * tunnel (idempotent re-provisioning).
 *
 * Security: the Cloudflare API token is backend-only (`config.cloudflareApiToken`)
 * and never sent to clients. This service is reachable only through the
 * NIP-98-authed `/relays/tunnel/provision` route.
 */

const CF_BASE = "https://api.cloudflare.com/client/v4";

export interface ProvisionOk {
  ok: true;
  tunnelId: string;
  hostname: string;
  /** Cloudflare account id — the `AccountTag` the client writes into its
   *  cloudflared credentials file. Not a secret. */
  accountTag: string;
}
export interface ProvisionErr {
  ok: false;
  error: string;
  code: string;
  /** HTTP status the route should reply with. */
  status: number;
}
export type ProvisionResult = ProvisionOk | ProvisionErr;

interface ProvisionOpts {
  /** Force delete + recreate the tunnel (e.g. the device lost its secret). */
  reset?: boolean;
  /** The relay's signing pubkey, stored for ops visibility only. */
  relayPubkey?: string;
}

class CloudflareApiError extends Error {
  constructor(
    message: string,
    public cfCode?: number,
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

/** A `cloudflared` connector secret is 32 raw bytes, base64-encoded. */
function isValidTunnelSecret(b64: string): boolean {
  try {
    return Buffer.from(b64, "base64").length === 32;
  } catch {
    return false;
  }
}

/** Stable, non-reversible subdomain label for a user (80 bits of a salted hash
 *  of their pubkey — avoids exposing the raw pubkey in DNS). */
function deriveSubdomain(ownerPubkey: string): string {
  return createHash("sha256")
    .update(`wired-relay-tunnel:${ownerPubkey}`)
    .digest("hex")
    .slice(0, 20);
}

/** Thin Cloudflare v4 fetch wrapper: bearer auth + error unwrapping. */
async function cf(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${CF_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.cloudflareApiToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const cfErr = json?.errors?.[0];
    throw new CloudflareApiError(cfErr?.message ?? `Cloudflare API ${res.status}`, cfErr?.code);
  }
  return json.result;
}

async function findTunnelByName(name: string): Promise<{ id: string } | null> {
  const acct = config.cloudflareAccountId;
  const result = await cf(
    `/accounts/${acct}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`,
  );
  return Array.isArray(result) && result.length ? { id: result[0].id } : null;
}

async function createTunnel(name: string, secretB64: string): Promise<{ id: string }> {
  const acct = config.cloudflareAccountId;
  // `config_src: "local"` → the connector runs from a config file we write on
  // the device (ingress points at the live loopback port), not a remotely
  // managed config. This keeps dynamic-port handling entirely client-side.
  const result = await cf(`/accounts/${acct}/cfd_tunnel`, {
    method: "POST",
    body: JSON.stringify({ name, tunnel_secret: secretB64, config_src: "local" }),
  });
  return { id: result.id };
}

async function deleteTunnel(tunnelId: string): Promise<void> {
  const acct = config.cloudflareAccountId;
  // A tunnel with active connections can't be deleted; clean them up first.
  await cf(`/accounts/${acct}/cfd_tunnel/${tunnelId}/connections`, { method: "DELETE" }).catch(
    () => {},
  );
  await cf(`/accounts/${acct}/cfd_tunnel/${tunnelId}`, { method: "DELETE" });
}

async function upsertDnsCname(hostname: string, target: string): Promise<void> {
  const zone = config.cloudflareZoneId;
  const body = JSON.stringify({ type: "CNAME", name: hostname, content: target, proxied: true, ttl: 1 });
  const existing = await cf(
    `/zones/${zone}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
  );
  if (Array.isArray(existing) && existing.length) {
    await cf(`/zones/${zone}/dns_records/${existing[0].id}`, { method: "PUT", body });
  } else {
    await cf(`/zones/${zone}/dns_records`, { method: "POST", body });
  }
}

export const cloudflareTunnelService = {
  /** Whether the platform has the Cloudflare credentials to provision tunnels. */
  configured(): boolean {
    return Boolean(
      config.cloudflareApiToken && config.cloudflareAccountId && config.cloudflareZoneId,
    );
  },

  /** Expose the subdomain derivation for tests / diagnostics. */
  deriveSubdomain,

  async provision(
    ownerPubkey: string,
    tunnelSecret: string,
    opts: ProvisionOpts = {},
  ): Promise<ProvisionResult> {
    if (!this.configured()) {
      return {
        ok: false,
        error: "Named tunnels are not configured on this server",
        code: "TUNNEL_NOT_CONFIGURED",
        status: 503,
      };
    }
    if (!isValidTunnelSecret(tunnelSecret)) {
      return {
        ok: false,
        error: "tunnelSecret must be base64-encoded 32 bytes",
        code: "INVALID_TUNNEL_SECRET",
        status: 400,
      };
    }

    const sub = deriveSubdomain(ownerPubkey);
    const name = `wired-${sub}`;
    const hostname = `${sub}.${config.tunnelHostnameZone}`;

    try {
      let tunnelId: string | undefined;
      const existing = await findTunnelByName(name);
      if (existing && opts.reset) {
        await deleteTunnel(existing.id);
      } else if (existing) {
        tunnelId = existing.id;
      }
      if (!tunnelId) {
        const created = await createTunnel(name, tunnelSecret);
        tunnelId = created.id;
      }

      await upsertDnsCname(hostname, `${tunnelId}.cfargotunnel.com`);

      await db
        .insert(relayTunnels)
        .values({ ownerPubkey, relayPubkey: opts.relayPubkey ?? null, tunnelId, hostname })
        .onConflictDoUpdate({
          target: relayTunnels.ownerPubkey,
          set: { tunnelId, hostname, relayPubkey: opts.relayPubkey ?? null, updatedAt: new Date() },
        });

      return { ok: true, tunnelId, hostname, accountTag: config.cloudflareAccountId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "tunnel provisioning failed";
      return { ok: false, error: message, code: "CLOUDFLARE_ERROR", status: 502 };
    }
  },
};
