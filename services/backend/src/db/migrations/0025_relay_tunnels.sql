-- Per-user named relay tunnels (Decentralized Spaces, PACKAGES_DESIGN §6 / M7).
-- Maps a Wired user to the Cloudflare tunnel + subdomain that fronts their
-- self-hosted embedded relay (<id>.relay.thewired.app).
--
-- We store NO tunnel secret here: the connector secret is generated and held on
-- the user's device (OS keychain) and only passed transiently to Cloudflare when
-- the tunnel is created. This table is purely the routing record — one tunnel
-- per user — used for idempotent re-provisioning and abuse accounting.
CREATE TABLE IF NOT EXISTS app.relay_tunnels (
    owner_pubkey TEXT PRIMARY KEY,            -- authenticated Wired user (X-Auth-Pubkey)
    relay_pubkey TEXT,                        -- the embedded relay's signing key (informational)
    tunnel_id    TEXT NOT NULL,               -- Cloudflare cfd_tunnel id
    hostname     TEXT NOT NULL,               -- <id>.relay.thewired.app
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_relay_tunnels_hostname ON app.relay_tunnels(hostname);
