//! Public tunneling for the embedded relay (Decentralized Spaces M7).
//!
//! The embedded relay ([`crate::relay`]) binds loopback only, so it's reachable
//! just from this machine. To let other members of a space connect, we run a
//! `cloudflared` tunnel that exposes the local relay port at a public URL.
//!
//! **This v1 implements the zero-config "quick tunnel"** (`*.trycloudflare.com`):
//! we spawn an already-installed `cloudflared`, point it at the relay port, and
//! parse the assigned public URL from its output. We do NOT bundle or
//! auto-download the binary, and we do NOT yet provision the branded
//! `<id>.relay.thewired.app` named tunnel (that needs the backend CNAME API +
//! Cloudflare account and is a follow-up). If `cloudflared` isn't found, we
//! return an actionable error.
//!
//! Reachability is best-effort and lasts only while this app + tunnel run; the
//! platform relay remains the durable fallback.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;
use tokio::time::timeout;

use crate::relay::EmbeddedRelayState;

/// Keychain id for the cloudflared connector secret. Generated on-device the
/// first time a named tunnel is provisioned and never persisted server-side.
const TUNNEL_SECRET_ID: &str = "embedded_relay_tunnel_secret";

/// Managed Tauri state holding the running tunnel (if any).
#[derive(Default)]
pub struct TunnelState(pub Arc<Mutex<Option<RunningTunnel>>>);

pub struct RunningTunnel {
    /// The cloudflared process for quick/named tunnels. `None` for a
    /// user-supplied custom URL (their own external tunnel — we run no process,
    /// just record the public address).
    child: Option<Child>,
    url: String,
    /// Credentials file written for a *named* tunnel (removed on stop). `None`
    /// for quick/custom tunnels, which need no on-disk secret.
    creds_path: Option<PathBuf>,
}

/// Provisioning data returned by the backend's `/relays/tunnel/provision` for a
/// branded `<id>.relay.thewired.app` tunnel. Field names are snake_case to match
/// the JSON the JS layer forwards.
#[derive(serde::Deserialize)]
pub struct NamedTunnelConfig {
    pub tunnel_id: String,
    pub hostname: String,
    pub account_tag: String,
}

/// The device-held connector secret, surfaced to the JS layer so it can be sent
/// to the backend (which creates the Cloudflare tunnel with the same secret).
#[derive(serde::Serialize)]
pub struct NamedIdentity {
    pub tunnel_secret: String,
}

#[derive(serde::Serialize, Clone)]
pub struct TunnelStatus {
    pub running: bool,
    /// The public `https://…` URL (clients connect via the `wss://` form).
    pub url: Option<String>,
}

impl TunnelStatus {
    fn stopped() -> Self {
        TunnelStatus { running: false, url: None }
    }
}

/// Scan `PATH` for an executable.
fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Resolve a usable `cloudflared`: the managed (downloaded) copy, then a
/// user-installed one (`~/.local/bin`, `PATH`), and finally download-on-enable
/// if none is present. So users never have to install it themselves.
async fn resolve_cloudflared(app: &AppHandle) -> Result<PathBuf, String> {
    let base = crate::relay::base_dir(app)?;
    let bin_name = if cfg!(windows) { "cloudflared.exe" } else { "cloudflared" };

    let managed = crate::cloudflared::binary_path(&base);
    if managed.is_file() {
        return Ok(managed);
    }
    if let Some(home) = std::env::var_os("HOME") {
        let p = PathBuf::from(home).join(".local").join("bin").join(bin_name);
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Some(p) = find_on_path(bin_name) {
        return Ok(p);
    }
    // Not installed anywhere — fetch it (Cloudflare-signed; see cloudflared.rs).
    crate::cloudflared::ensure(&base).await
}

/// Extract a `https://<sub>.trycloudflare.com` URL from a cloudflared log line.
fn extract_trycloudflare(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let rest = &line[start..];
    // The URL ends at the first whitespace or control char.
    let end = rest
        .find(|c: char| c.is_whitespace())
        .unwrap_or(rest.len());
    let candidate = &rest[..end];
    if candidate.contains(".trycloudflare.com") {
        Some(candidate.trim_end_matches(['/', '|', ' ']).to_string())
    } else {
        None
    }
}

/// Restrict a file to owner read/write (the credentials file holds the tunnel
/// secret). No-op on non-unix.
#[cfg(unix)]
fn set_owner_only(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn set_owner_only(_path: &Path) {}

fn is_valid_b64_32(s: &str) -> bool {
    BASE64.decode(s.trim()).map(|b| b.len() == 32).unwrap_or(false)
}

/// Load (or first-time generate) the cloudflared connector secret from the OS
/// keychain. This device-held secret authorizes the named tunnel; it is sent to
/// the backend only at create time (so Cloudflare provisions the tunnel with it)
/// and is never persisted server-side.
fn load_or_create_tunnel_secret() -> Result<String, String> {
    if let Ok(Some(existing)) = crate::keystore::keystore_get_secret(TUNNEL_SECRET_ID.to_string()) {
        if is_valid_b64_32(&existing) {
            return Ok(existing.trim().to_string());
        }
    }
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let secret = BASE64.encode(bytes);
    crate::keystore::keystore_set_secret(TUNNEL_SECRET_ID.to_string(), secret.clone())
        .map_err(|e| format!("store tunnel secret: {e}"))?;
    Ok(secret)
}

/// Return the device-held connector secret (creating it on first call). The JS
/// layer forwards this to the backend's provisioning endpoint so Cloudflare
/// creates the tunnel with the same secret the local connector will use.
#[tauri::command]
pub async fn tunnel_named_identity() -> Result<NamedIdentity, String> {
    let tunnel_secret = load_or_create_tunnel_secret()?;
    Ok(NamedIdentity { tunnel_secret })
}

/// Bring up a branded named tunnel from server-provided provisioning data. Writes
/// a cloudflared credentials file + a config that routes `hostname` at the
/// relay's *live* loopback port (rewritten each start, so the dynamic port is
/// always correct), then runs the connector and waits for it to register.
async fn start_named_tunnel(
    app: &AppHandle,
    port: u16,
    cfg: NamedTunnelConfig,
) -> Result<RunningTunnel, String> {
    let secret = load_or_create_tunnel_secret()?;
    let base = crate::relay::base_dir(app)?;
    let tunnel_dir = base.join("tunnel");
    std::fs::create_dir_all(&tunnel_dir).map_err(|e| format!("create tunnel dir: {e}"))?;

    // Credentials file: the device secret + the ids the server assigned.
    let creds_path = tunnel_dir.join(format!("{}.json", cfg.tunnel_id));
    let creds = serde_json::json!({
        "AccountTag": cfg.account_tag,
        "TunnelID": cfg.tunnel_id,
        "TunnelSecret": secret,
    });
    std::fs::write(
        &creds_path,
        serde_json::to_vec(&creds).map_err(|e| format!("serialize credentials: {e}"))?,
    )
    .map_err(|e| format!("write tunnel credentials: {e}"))?;
    set_owner_only(&creds_path);

    let config_path = tunnel_dir.join("config.yml");
    let config_yaml = format!(
        "tunnel: {id}\ncredentials-file: {creds}\ningress:\n  - hostname: {host}\n    service: http://127.0.0.1:{port}\n  - service: http_status:404\n",
        id = cfg.tunnel_id,
        creds = creds_path.display(),
        host = cfg.hostname,
        port = port,
    );
    std::fs::write(&config_path, config_yaml).map_err(|e| format!("write tunnel config: {e}"))?;

    let bin = resolve_cloudflared(app).await?;
    let mut child = Command::new(&bin)
        .args(["tunnel", "--config", &config_path.to_string_lossy(), "--no-autoupdate", "run"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("could not launch cloudflared ({}): {e}", bin.display()))?;

    // Wait for the connector to register with Cloudflare's edge (`true`), or
    // detect that it exited first (`false`).
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture cloudflared output".to_string())?;
    let (tx, rx) = oneshot::channel::<bool>();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut tx = Some(tx);
        while let Ok(Some(line)) = lines.next_line().await {
            if line.contains("Registered tunnel connection") {
                if let Some(t) = tx.take() {
                    let _ = t.send(true);
                }
            }
            // Keep draining after capture so the child's pipe never blocks.
        }
        // Stream ended without registering → the connector exited.
        if let Some(t) = tx.take() {
            let _ = t.send(false);
        }
    });

    match timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(true)) => {}
        Ok(Ok(false)) | Ok(Err(_)) => {
            let _ = child.kill().await;
            let _ = std::fs::remove_file(&creds_path);
            return Err(
                "cloudflared exited before the named tunnel registered — make sure the relay \
                 is running, then try again"
                    .to_string(),
            );
        }
        Err(_) => {
            // Registration not confirmed in time, but the connector is still
            // running; keep it (edge/DNS propagation can lag) rather than kill a
            // possibly-good tunnel.
            log::warn!("named tunnel registration not confirmed within 30s; continuing");
        }
    }

    let url = format!("https://{}", cfg.hostname);
    log::info!("Named tunnel established: {url}");
    Ok(RunningTunnel { child: Some(child), url, creds_path: Some(creds_path) })
}

/// Start a public tunnel to the running embedded relay (idempotent). Requires
/// the embedded relay to be running first.
///
/// `mode`:
///   - `"quick"` (default) — zero-config Cloudflare quick tunnel; a random
///     `*.trycloudflare.com` URL that changes every restart.
///   - `"named"` — the branded, stable `<id>.relay.thewired.app`. The JS layer
///     first calls the backend's `/relays/tunnel/provision` (NIP-98-authed) and
///     passes the result in `named`; we run a locally-configured connector.
#[tauri::command]
pub async fn tunnel_start(
    app: AppHandle,
    relay_state: State<'_, EmbeddedRelayState>,
    tunnel_state: State<'_, TunnelState>,
    mode: Option<String>,
    named: Option<NamedTunnelConfig>,
) -> Result<TunnelStatus, String> {
    {
        let guard = tunnel_state.0.lock().await;
        if let Some(t) = guard.as_ref() {
            return Ok(TunnelStatus { running: true, url: Some(t.url.clone()) });
        }
    }

    // The relay must be up so we know which loopback port to expose.
    let port = {
        let relay = relay_state.0.lock().await;
        relay
            .as_ref()
            .ok_or_else(|| "embedded relay is not running; start it first".to_string())?
            .addr
            .port()
    };

    // Branded named tunnel: the backend has already provisioned the tunnel + DNS
    // and handed us the ids via `named`; run a locally-configured connector.
    if mode.as_deref() == Some("named") {
        let cfg = named
            .ok_or_else(|| "named tunnel requires provisioning data from the server".to_string())?;
        let relay = start_named_tunnel(&app, port, cfg).await?;
        let status = TunnelStatus { running: true, url: Some(relay.url.clone()) };
        *tunnel_state.0.lock().await = Some(relay);
        return Ok(status);
    }

    let bin = resolve_cloudflared(&app).await?;
    let mut child = Command::new(&bin)
        .args([
            "tunnel",
            "--url",
            &format!("http://127.0.0.1:{port}"),
            "--no-autoupdate",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            format!(
                "could not launch cloudflared ({}): {e}. Install it from \
                 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
                bin.display()
            )
        })?;

    // Drain stderr in the background, forwarding the first quick-tunnel URL.
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture cloudflared output".to_string())?;
    let (url_tx, url_rx) = oneshot::channel::<String>();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut tx = Some(url_tx);
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(t) = tx.take() {
                if let Some(url) = extract_trycloudflare(&line) {
                    let _ = t.send(url);
                } else {
                    tx = Some(t); // keep waiting
                }
            }
            // Keep draining after capture so the child's pipe never blocks.
        }
    });

    let url = match timeout(Duration::from_secs(30), url_rx).await {
        Ok(Ok(url)) => url,
        _ => {
            let _ = child.kill().await;
            return Err("timed out waiting for cloudflared to report a public URL".to_string());
        }
    };

    log::info!("Tunnel established: {url}");
    let status = TunnelStatus { running: true, url: Some(url.clone()) };
    *tunnel_state.0.lock().await = Some(RunningTunnel { child: Some(child), url, creds_path: None });
    Ok(status)
}

/// Record a user-supplied **custom public URL** for the relay (their own
/// external tunnel / reverse proxy). We run no process — this just stores the
/// address so the rest of the app treats it as the relay's public endpoint,
/// exactly like a cloudflared tunnel's URL. Replaces any running tunnel.
/// Validate + normalize a user-supplied public relay URL (ws(s):// only, bounded
/// length, no trailing slash).
fn validate_custom_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("wss://") || trimmed.starts_with("ws://")) {
        return Err("Custom relay URL must start with wss:// (or ws://)".to_string());
    }
    if trimmed.len() > 512 {
        return Err("Custom relay URL is too long".to_string());
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

#[tauri::command]
pub async fn tunnel_set_custom(
    tunnel_state: State<'_, TunnelState>,
    url: String,
) -> Result<TunnelStatus, String> {
    let url = validate_custom_url(&url)?;

    // Tear down any cloudflared process first (custom URL is mutually exclusive).
    if let Some(mut prev) = tunnel_state.0.lock().await.take() {
        if let Some(mut child) = prev.child.take() {
            let _ = child.kill().await;
        }
        if let Some(p) = prev.creds_path.take() {
            let _ = std::fs::remove_file(p);
        }
    }

    let status = TunnelStatus { running: true, url: Some(url.clone()) };
    *tunnel_state.0.lock().await = Some(RunningTunnel { child: None, url, creds_path: None });
    log::info!("Custom relay URL set");
    Ok(status)
}

/// Stop the tunnel if running (idempotent).
#[tauri::command]
pub async fn tunnel_stop(tunnel_state: State<'_, TunnelState>) -> Result<TunnelStatus, String> {
    let tunnel = tunnel_state.0.lock().await.take();
    if let Some(mut t) = tunnel {
        // Custom URLs have no process; quick/named do.
        if let Some(mut child) = t.child.take() {
            let _ = child.kill().await;
        }
        // A named tunnel's credentials file held the connector secret; remove it
        // (the canonical copy stays in the keychain).
        if let Some(p) = t.creds_path.take() {
            let _ = std::fs::remove_file(p);
        }
        log::info!("Tunnel stopped");
    }
    Ok(TunnelStatus::stopped())
}

/// Report whether a tunnel is running and its public URL.
#[tauri::command]
pub async fn tunnel_status(tunnel_state: State<'_, TunnelState>) -> Result<TunnelStatus, String> {
    let guard = tunnel_state.0.lock().await;
    Ok(match guard.as_ref() {
        Some(t) => TunnelStatus { running: true, url: Some(t.url.clone()) },
        None => TunnelStatus::stopped(),
    })
}

#[cfg(test)]
mod tests {
    use super::{extract_trycloudflare, is_valid_b64_32, BASE64};
    use base64::Engine;

    #[test]
    fn validates_a_32_byte_base64_secret() {
        let good = BASE64.encode([7u8; 32]);
        assert!(is_valid_b64_32(&good));
        // Trailing whitespace is tolerated (keychain round-trips can add it).
        assert!(is_valid_b64_32(&format!("{good}\n")));
    }

    #[test]
    fn rejects_wrong_length_or_malformed_secrets() {
        assert!(!is_valid_b64_32(&BASE64.encode([7u8; 16]))); // too short
        assert!(!is_valid_b64_32(&BASE64.encode([7u8; 31]))); // off-by-one
        assert!(!is_valid_b64_32("not base64 !!"));
        assert!(!is_valid_b64_32(""));
    }

    #[test]
    fn validates_and_normalizes_custom_url() {
        use super::validate_custom_url;
        assert_eq!(validate_custom_url("wss://r.example.com/").unwrap(), "wss://r.example.com");
        assert_eq!(validate_custom_url("  ws://host:7777 ").unwrap(), "ws://host:7777");
        assert!(validate_custom_url("https://r.example.com").is_err()); // wrong scheme
        assert!(validate_custom_url("relay.example.com").is_err()); // no scheme
    }

    #[test]
    fn parses_quick_tunnel_url() {
        let line = "2024-01-01T00:00:00Z INF +-----------+ https://happy-cat-1234.trycloudflare.com +-----------+";
        assert_eq!(
            extract_trycloudflare(line).as_deref(),
            Some("https://happy-cat-1234.trycloudflare.com")
        );
    }

    #[test]
    fn ignores_non_tunnel_urls() {
        assert_eq!(
            extract_trycloudflare("visit https://developers.cloudflare.com for docs"),
            None
        );
        assert_eq!(extract_trycloudflare("no url here"), None);
    }
}
