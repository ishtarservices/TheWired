use crate::nostr::firehose::FirehosePolicy;
use crate::nostr::wrap_gate::{WrapAuthGate, WrapIntakeGate};

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub relay_name: String,
    pub relay_description: String,
    pub relay_secret_key: Option<String>,
    pub rust_env: String,

    // ── DM wire contract (docs/DM_WIRE_CONTRACT.md §7) ──
    /// Pubkeys with the *ingest role*: after NIP-42 AUTH they may read every
    /// kind-1059 wrap (metadata only — the backend push planner).
    /// `RELAY_INGEST_PUBKEYS`, comma-separated hex.
    pub ingest_pubkeys: Vec<String>,
    /// `RELAY_WRAP_AUTH_GATE` = enforce (default) | warn | off.
    pub wrap_auth_gate: WrapAuthGate,
    /// Server-side retention for kind-1059 by `first_seen`, in days.
    /// `RELAY_WRAP_RETENTION_DAYS`; 0 = keep forever (default).
    pub wrap_retention_days: u32,
    /// Intake gate for kind-1059 (Postgres only; the embedded relay is a
    /// personal relay with its own write policy). A wrap is stored only when
    /// one of its `p`-tagged recipients has a relay list stored here that
    /// admits it — a kind-10050 DM relay list naming this relay (`RELAY_URL` /
    /// `RELAY_AUTH_RELAY_URLS`, compared like a NIP-42 `relay` tag), or a
    /// kind-10002 when no 10050 is stored here — or when the publishing socket
    /// is NIP-42 authenticated as a recipient. Otherwise `enforce` answers
    /// `OK false blocked:` and stores nothing; `warn` (default) stores it and
    /// logs + counts one line per wrap `enforce` would refuse, so the foreign
    /// share can be measured before flipping; `off` skips the check.
    /// `RELAY_WRAP_INTAKE_GATE` = enforce | warn (default) | off.
    pub wrap_intake_gate: WrapIntakeGate,
    /// Serve kind-1984 reports only to their author and the ingest role
    /// (`nostr::report_gate`). `RELAY_REPORT_READ_GATE` = on (default) | off;
    /// `off` is for local dev without an ingest key.
    pub report_read_gate: bool,

    // ── Firehose (`nostr::firehose`) ──
    /// What an untargeted kind-1 REQ shows (Postgres only; the embedded
    /// relay has no community and serves everyone). `all` is today's
    /// behaviour; `community` restricts firehose requests to community
    /// authors (`db::community`) while every targeted request is unchanged.
    /// `RELAY_FIREHOSE_POLICY` = all (default) | community.
    pub firehose_policy: FirehosePolicy,
    /// The relay's public address when it differs from `RELAY_URL` (a relay
    /// configured with its internal URL behind a proxy). Only used to
    /// recognise this relay in stored kind-10002/10050 lists for the
    /// community set. `PUBLIC_RELAY_URL`.
    pub public_relay_url: Option<String>,

    // ── Rate limits (always on; the Caddy proxy routes the relay around the
    //    gateway, so nothing else limits WebSocket traffic) ──
    /// Messages per window per connection. `RELAY_RATE_MAX_MSGS` (300).
    pub rate_max_msgs: u32,
    /// Window length in seconds. `RELAY_RATE_WINDOW_SECS` (10).
    pub rate_window_secs: u64,
    /// Counted frames allowed during the FIRST window after connect, when the
    /// desktop client re-opens every subscription at once (a cold start is
    /// more than 100 REQs plus NEG chunk REQ/CLOSE pairs).
    /// `RELAY_RATE_COLD_START_MAX_MSGS` (900); never below `rate_max_msgs`.
    pub rate_cold_start_max_msgs: u32,
    /// Concurrent connections per client IP. `RELAY_MAX_CONNS_PER_IP` (32); 0 = off.
    pub max_conns_per_ip: usize,
    /// Trust `X-Forwarded-For` for the client IP (set behind Caddy).
    /// `RELAY_TRUST_PROXY` = 1|true.
    pub trust_proxy: bool,

    // ── NIP-42 ──
    /// Additional URLs a kind-22242 `relay` tag may name, besides `RELAY_URL`
    /// (e.g. a second public hostname during a DNS move). The relay accepts
    /// an AUTH only for an address in this allow-set; it is never skipped.
    /// `RELAY_AUTH_RELAY_URLS`, comma-separated.
    pub auth_relay_urls: Vec<String>,

    // ── WebSocket keepalive ──
    /// Seconds between server-initiated WebSocket pings. `RELAY_WS_PING_SECS`
    /// (30); 0 = never ping (and never drop idle sockets).
    pub ws_ping_interval_secs: u64,
    /// Drop a connection that has sent nothing (no frame, no pong) for this
    /// many seconds. Sockets a backgrounded phone silently loses otherwise
    /// linger — and keep counting toward `max_conns_per_ip` — until the TCP
    /// stack gives up. `RELAY_WS_IDLE_TIMEOUT_SECS` (90); 0 = never drop.
    pub ws_idle_timeout_secs: u64,

    // ── Live fan-out ──
    /// Capacity of the global broadcast channel every connection reads live
    /// events from. A connection that falls further behind than this lags
    /// (`RecvError::Lagged`) and is resynced from storage.
    /// `RELAY_BROADCAST_CAPACITY` (4096).
    pub broadcast_capacity: usize,
    /// A connection that lags again within this many seconds of a resync is
    /// closed (1013) instead of resynced a second time.
    /// `RELAY_RESYNC_COOLDOWN_SECS` (10).
    pub resync_cooldown_secs: u64,

    // ── Postgres pool (`db::pool::PoolSettings`; ignored by the embedded relay) ──
    /// `RELAY_DB_MAX_CONNECTIONS` (20) / `RELAY_DB_MIN_CONNECTIONS` (2).
    pub db_max_connections: u32,
    pub db_min_connections: u32,
    /// Per-statement cap in ms, the session default of every pooled
    /// connection; 0 disables. `RELAY_DB_STATEMENT_TIMEOUT_MS` (10000).
    pub db_statement_timeout_ms: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            database_url: "postgres://thewired:thewired@localhost:5432/thewired".into(),
            port: 7777,
            relay_name: "The Wired Relay".into(),
            relay_description: "Custom NIP-29 relay for The Wired".into(),
            relay_secret_key: None,
            rust_env: "development".into(),
            ingest_pubkeys: Vec::new(),
            wrap_auth_gate: WrapAuthGate::Enforce,
            wrap_retention_days: 0,
            wrap_intake_gate: WrapIntakeGate::Warn,
            report_read_gate: true,
            firehose_policy: FirehosePolicy::All,
            public_relay_url: None,
            rate_max_msgs: 300,
            rate_window_secs: 10,
            rate_cold_start_max_msgs: 900,
            max_conns_per_ip: 32,
            trust_proxy: false,
            auth_relay_urls: Vec::new(),
            ws_ping_interval_secs: 30,
            ws_idle_timeout_secs: 90,
            broadcast_capacity: 4096,
            resync_cooldown_secs: 10,
            db_max_connections: 20,
            db_min_connections: 2,
            db_statement_timeout_ms: 10_000,
        }
    }
}

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

fn env_bool(name: &str) -> bool {
    matches!(
        std::env::var(name).unwrap_or_default().trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

impl Config {
    pub fn from_env() -> Self {
        let d = Config::default();
        Self {
            database_url: std::env::var("DATABASE_URL").unwrap_or(d.database_url),
            port: env_or("RELAY_PORT", d.port),
            relay_name: std::env::var("RELAY_NAME").unwrap_or(d.relay_name),
            relay_description: std::env::var("RELAY_DESCRIPTION").unwrap_or(d.relay_description),
            relay_secret_key: std::env::var("RELAY_SECRET_KEY").ok(),
            rust_env: std::env::var("RUST_ENV").unwrap_or(d.rust_env),
            ingest_pubkeys: std::env::var("RELAY_INGEST_PUBKEYS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_ascii_lowercase())
                .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
                .collect(),
            wrap_auth_gate: WrapAuthGate::parse(
                &std::env::var("RELAY_WRAP_AUTH_GATE").unwrap_or_else(|_| "enforce".into()),
            ),
            wrap_retention_days: env_or("RELAY_WRAP_RETENTION_DAYS", d.wrap_retention_days),
            wrap_intake_gate: WrapIntakeGate::parse(
                &std::env::var("RELAY_WRAP_INTAKE_GATE").unwrap_or_else(|_| "warn".into()),
            ),
            report_read_gate: !matches!(
                std::env::var("RELAY_REPORT_READ_GATE")
                    .unwrap_or_default()
                    .trim()
                    .to_ascii_lowercase()
                    .as_str(),
                "off" | "0" | "false"
            ),
            firehose_policy: FirehosePolicy::parse(&std::env::var("RELAY_FIREHOSE_POLICY").unwrap_or_default()),
            public_relay_url: std::env::var("PUBLIC_RELAY_URL")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            rate_max_msgs: env_or("RELAY_RATE_MAX_MSGS", d.rate_max_msgs),
            rate_window_secs: env_or("RELAY_RATE_WINDOW_SECS", d.rate_window_secs),
            rate_cold_start_max_msgs: env_or("RELAY_RATE_COLD_START_MAX_MSGS", d.rate_cold_start_max_msgs),
            max_conns_per_ip: env_or("RELAY_MAX_CONNS_PER_IP", d.max_conns_per_ip),
            trust_proxy: env_bool("RELAY_TRUST_PROXY"),
            auth_relay_urls: std::env::var("RELAY_AUTH_RELAY_URLS")
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect(),
            ws_ping_interval_secs: env_or("RELAY_WS_PING_SECS", d.ws_ping_interval_secs),
            ws_idle_timeout_secs: env_or("RELAY_WS_IDLE_TIMEOUT_SECS", d.ws_idle_timeout_secs),
            broadcast_capacity: env_or("RELAY_BROADCAST_CAPACITY", d.broadcast_capacity).max(1),
            resync_cooldown_secs: env_or("RELAY_RESYNC_COOLDOWN_SECS", d.resync_cooldown_secs),
            db_max_connections: env_or("RELAY_DB_MAX_CONNECTIONS", d.db_max_connections),
            db_min_connections: env_or("RELAY_DB_MIN_CONNECTIONS", d.db_min_connections),
            db_statement_timeout_ms: env_or("RELAY_DB_STATEMENT_TIMEOUT_MS", d.db_statement_timeout_ms),
        }
    }

    /// Postgres pool knobs for `db::pool::create_pool_with`.
    pub fn pool_settings(&self) -> crate::db::pool::PoolSettings {
        crate::db::pool::PoolSettings {
            max_connections: self.db_max_connections,
            min_connections: self.db_min_connections,
            statement_timeout_ms: self.db_statement_timeout_ms,
        }
    }

    /// Does this pubkey hold the ingest role?
    pub fn is_ingest(&self, pubkey: &str) -> bool {
        self.ingest_pubkeys.iter().any(|p| p == pubkey)
    }
}
