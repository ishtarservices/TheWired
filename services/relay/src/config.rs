use crate::nostr::wrap_gate::WrapAuthGate;

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

    // ── Rate limits (always on; the Caddy proxy routes the relay around the
    //    gateway, so nothing else limits WebSocket traffic) ──
    /// Messages per window per connection. `RELAY_RATE_MAX_MSGS` (300).
    pub rate_max_msgs: u32,
    /// Window length in seconds. `RELAY_RATE_WINDOW_SECS` (10).
    pub rate_window_secs: u64,
    /// Concurrent connections per client IP. `RELAY_MAX_CONNS_PER_IP` (32); 0 = off.
    pub max_conns_per_ip: usize,
    /// Trust `X-Forwarded-For` for the client IP (set behind Caddy).
    /// `RELAY_TRUST_PROXY` = 1|true.
    pub trust_proxy: bool,
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
            rate_max_msgs: 300,
            rate_window_secs: 10,
            max_conns_per_ip: 32,
            trust_proxy: false,
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
            rate_max_msgs: env_or("RELAY_RATE_MAX_MSGS", d.rate_max_msgs),
            rate_window_secs: env_or("RELAY_RATE_WINDOW_SECS", d.rate_window_secs),
            max_conns_per_ip: env_or("RELAY_MAX_CONNS_PER_IP", d.max_conns_per_ip),
            trust_proxy: env_bool("RELAY_TRUST_PROXY"),
        }
    }

    /// Does this pubkey hold the ingest role?
    pub fn is_ingest(&self, pubkey: &str) -> bool {
        self.ingest_pubkeys.iter().any(|p| p == pubkey)
    }
}
