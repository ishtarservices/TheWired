//! Embedded NIP-29 relay lifecycle (Decentralized Spaces M6).
//!
//! Hosts an in-process SQLite-backed relay *inside the app* so a user can run
//! their own space relay ("host on my own machine"). The relay engine itself
//! is the shared `thewired-relay` crate (same protocol handler as the
//! production Postgres server) compiled with its `embedded` feature; this
//! module is only the thin Tauri shell: it picks the on-disk paths, manages a
//! persisted signing identity, and exposes start/stop/status commands.
//!
//! The relay binds to **loopback only** (`127.0.0.1`). Exposing it to other
//! devices is a separate, explicit step (M7 tunneling).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Manager, State};
use thewired_relay::db::{sqlite, Db};
use thewired_relay::server::{run_embedded, EmbeddedRelay};

/// Managed Tauri state holding the running relay (if any).
#[derive(Default)]
pub struct EmbeddedRelayState(pub Arc<Mutex<Option<EmbeddedRelay>>>);

/// Status reported to the frontend.
#[derive(serde::Serialize, Clone)]
pub struct RelayStatus {
    pub running: bool,
    pub ws_url: Option<String>,
    /// `ws://<lan-ip>:<port>` when the relay is exposed on the local network.
    pub lan_url: Option<String>,
    /// The relay's NIP-29 signing pubkey — clients MUST pin this as the
    /// expected author of 39000/39001/39002 group-state events.
    pub pubkey: Option<String>,
    pub port: Option<u16>,
}

impl RelayStatus {
    fn stopped() -> Self {
        RelayStatus { running: false, ws_url: None, lan_url: None, pubkey: None, port: None }
    }
    fn from_relay(r: &EmbeddedRelay) -> Self {
        RelayStatus {
            running: true,
            ws_url: Some(r.ws_url()),
            lan_url: r.lan_url.clone(),
            pubkey: Some(r.pubkey.clone()),
            port: Some(r.addr.port()),
        }
    }
}

/// Stable base port for the embedded relay. A fixed port (vs an OS-assigned one)
/// means a space's `hostRelay` stays valid across restarts — no port churn,
/// no stale-connection retries. Each dev instance offsets by its index so two
/// instances on one machine get distinct, stable ports.
const EMBEDDED_RELAY_BASE_PORT: u16 = 7787;

/// The (stable) port this instance's embedded relay should bind. If it's taken,
/// [`run_embedded`] falls back to an OS-assigned port so startup still succeeds.
fn embedded_relay_port() -> u16 {
    EMBEDDED_RELAY_BASE_PORT.saturating_add(crate::keystore::instance_index())
}

/// `<app_local_data_dir>/embedded_relay[_<instance>]` — the home for the relay's
/// db + key (and the downloaded cloudflared binary). The instance suffix keeps
/// concurrent dev instances from sharing one SQLite db / relay identity.
pub(crate) fn base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {e}"))?
        .join(format!("embedded_relay{}", crate::keystore::instance_suffix()));
    std::fs::create_dir_all(&base).map_err(|e| format!("create relay dir: {e}"))?;
    Ok(base)
}

fn db_file(base: &Path) -> PathBuf {
    base.join("relay.sqlite")
}

/// Keychain id for the relay's signing key.
const RELAY_IDENTITY_SECRET: &str = "embedded_relay_identity";

fn is_valid_hex_key(s: &str) -> bool {
    let t = s.trim();
    t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit())
}

/// Derive the relay's signing pubkey from the persisted identity key — works
/// even when the relay isn't running, so the UI can tell "is this MY relay?"
/// for a space (by `relayPubkey`) independently of the changing tunnel URL.
fn persisted_relay_pubkey() -> Option<String> {
    use secp256k1::{Secp256k1, SecretKey};
    let hex_key = crate::keystore::keystore_get_secret(RELAY_IDENTITY_SECRET.to_string()).ok()??;
    let sk = SecretKey::from_slice(&hex::decode(hex_key.trim()).ok()?).ok()?;
    let (xonly, _) = sk.x_only_public_key(&Secp256k1::new());
    Some(hex::encode(xonly.serialize()))
}

/// The relay's persisted signing key. This is the *relay* identity (it signs
/// group metadata), NOT the user's nsec — a lower-stakes key whose compromise
/// would only let someone forge this relay's group-state events. Stored in the
/// **OS keychain** (via the same secret store as NIP-46/NWC), with a one-time
/// migration of any pre-existing plaintext `identity.key` file.
fn load_or_create_identity(dir: &Path) -> Result<String, String> {
    // 1. Keychain (preferred).
    if let Ok(Some(existing)) =
        crate::keystore::keystore_get_secret(RELAY_IDENTITY_SECRET.to_string())
    {
        if is_valid_hex_key(&existing) {
            return Ok(existing.trim().to_string());
        }
    }
    // 2. Migrate a legacy plaintext file into the keychain — but ONLY delete the
    //    plaintext copy after we confirm the key reads back from the keystore.
    //    (If keychain storage is flaky, deleting first would lose the key and
    //    rotate the relay's identity on every restart.)
    let key_path = dir.join("identity.key");
    if let Ok(file) = std::fs::read_to_string(&key_path) {
        if is_valid_hex_key(&file) {
            let key = file.trim().to_string();
            let _ = crate::keystore::keystore_set_secret(
                RELAY_IDENTITY_SECRET.to_string(),
                key.clone(),
            );
            let persisted = match crate::keystore::keystore_get_secret(
                RELAY_IDENTITY_SECRET.to_string(),
            ) {
                Ok(Some(rb)) => rb.trim() == key.as_str(),
                _ => false,
            };
            if persisted {
                let _ = std::fs::remove_file(&key_path);
            }
            return Ok(key);
        }
    }
    // 3. Generate fresh.
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex_key = hex::encode(bytes);
    crate::keystore::keystore_set_secret(RELAY_IDENTITY_SECRET.to_string(), hex_key.clone())
        .map_err(|e| format!("store relay identity: {e}"))?;
    Ok(hex_key)
}

/// Start the embedded relay (idempotent — returns the current status if already
/// running). Binds `127.0.0.1` on an OS-assigned port; the SQLite db and signing
/// key live under `<app_local_data_dir>/embedded_relay/`.
///
/// `owner_pubkey` (the logged-in user) is the only identity allowed to create
/// groups on this relay — so when it's publicly tunneled, a stranger can't spam
/// groups or store arbitrary events.
#[tauri::command]
pub async fn relay_start(
    app: AppHandle,
    state: State<'_, EmbeddedRelayState>,
    owner_pubkey: Option<String>,
    lan: Option<bool>,
) -> Result<RelayStatus, String> {
    let mut guard = state.0.lock().await;
    if let Some(relay) = guard.as_ref() {
        return Ok(RelayStatus::from_relay(relay));
    }

    let base = base_dir(&app)?;
    let secret_key = load_or_create_identity(&base).map_err(|e| format!("relay identity: {e}"))?;

    let db_path = db_file(&base);
    let db_path_str = db_path.to_string_lossy().to_string();
    let pool = sqlite::connect(&db_path_str)
        .await
        .map_err(|e| format!("open sqlite db: {e}"))?;

    let relay = run_embedded(
        Db::Sqlite(pool),
        embedded_relay_port(),
        "The Wired (self-hosted)".to_string(),
        Some(secret_key),
        owner_pubkey,
        lan.unwrap_or(false),
    )
    .await
    .map_err(|e| format!("start embedded relay: {e}"))?;

    let status = RelayStatus::from_relay(&relay);
    *guard = Some(relay);
    log::info!("Embedded relay started at {:?}", status.ws_url);
    Ok(status)
}

/// Stop the embedded relay if running (idempotent).
#[tauri::command]
pub async fn relay_stop(state: State<'_, EmbeddedRelayState>) -> Result<RelayStatus, String> {
    let relay = state.0.lock().await.take();
    if let Some(relay) = relay {
        relay.stop().await;
        log::info!("Embedded relay stopped");
    }
    Ok(RelayStatus::stopped())
}

/// Report whether the embedded relay is running and how to reach it.
#[tauri::command]
pub async fn relay_status(state: State<'_, EmbeddedRelayState>) -> Result<RelayStatus, String> {
    let guard = state.0.lock().await;
    let mut status = match guard.as_ref() {
        Some(relay) => RelayStatus::from_relay(relay),
        None => RelayStatus::stopped(),
    };
    // Report the relay's pubkey even when stopped, so the UI can identify
    // spaces hosted on this relay regardless of run state.
    if status.pubkey.is_none() {
        status.pubkey = persisted_relay_pubkey();
    }
    Ok(status)
}

/// Host-management stats: where the data lives, how big it is, and how much it
/// holds. Readable whether or not the relay is currently running (SQLite WAL
/// allows a concurrent reader).
#[derive(serde::Serialize, Clone)]
pub struct RelayStats {
    pub status: RelayStatus,
    /// Absolute path to the relay's data directory (for transparency / backup).
    pub data_dir: String,
    /// On-disk size in bytes (db + WAL + shared-memory files).
    pub db_size_bytes: u64,
    pub event_count: i64,
    pub group_count: i64,
}

#[tauri::command]
pub async fn relay_stats(
    app: AppHandle,
    state: State<'_, EmbeddedRelayState>,
) -> Result<RelayStats, String> {
    let status = {
        let guard = state.0.lock().await;
        guard.as_ref().map(RelayStatus::from_relay).unwrap_or_else(RelayStatus::stopped)
    };

    let base = base_dir(&app)?;
    let db_path = db_file(&base);

    // Sum the main db file plus its WAL / shared-memory sidecars.
    let mut db_size_bytes = 0u64;
    for suffix in ["", "-wal", "-shm"] {
        let p = if suffix.is_empty() {
            db_path.clone()
        } else {
            PathBuf::from(format!("{}{suffix}", db_path.to_string_lossy()))
        };
        if let Ok(meta) = std::fs::metadata(&p) {
            db_size_bytes += meta.len();
        }
    }

    // Counts: only if the db file exists (don't create it just to count).
    let (event_count, group_count) = if db_path.is_file() {
        let pool = sqlite::connect(&db_path.to_string_lossy())
            .await
            .map_err(|e| format!("open sqlite db: {e}"))?;
        let events = sqlite::count_events(&pool).await.map_err(|e| e.to_string())?;
        let groups = sqlite::count_groups(&pool).await.map_err(|e| e.to_string())?;
        pool.close().await;
        (events, groups)
    } else {
        (0, 0)
    };

    Ok(RelayStats {
        status,
        data_dir: base.to_string_lossy().to_string(),
        db_size_bytes,
        event_count,
        group_count,
    })
}

/// Tear down the host: stop the relay (if running) and delete its stored data.
/// With `wipe_identity = true` the relay's signing key is also removed — note
/// this gives the relay a NEW pubkey next start, so any groups it hosts get a
/// new authority key and existing members must re-trust it. Idempotent.
#[tauri::command]
pub async fn relay_reset(
    app: AppHandle,
    state: State<'_, EmbeddedRelayState>,
    wipe_identity: bool,
) -> Result<RelayStatus, String> {
    // Stop first so the db files aren't held open.
    if let Some(relay) = state.0.lock().await.take() {
        relay.stop().await;
    }

    let base = base_dir(&app)?;
    let db_path = db_file(&base);
    for suffix in ["", "-wal", "-shm"] {
        let p = if suffix.is_empty() {
            db_path.clone()
        } else {
            PathBuf::from(format!("{}{suffix}", db_path.to_string_lossy()))
        };
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| format!("delete {}: {e}", p.display()))?;
        }
    }

    if wipe_identity {
        let _ = crate::keystore::keystore_delete_secret(RELAY_IDENTITY_SECRET.to_string());
        // Also remove any legacy plaintext file.
        let key_path = base.join("identity.key");
        if key_path.exists() {
            let _ = std::fs::remove_file(&key_path);
        }
    }

    log::info!("Embedded relay data reset (wipe_identity={wipe_identity})");
    Ok(RelayStatus::stopped())
}
