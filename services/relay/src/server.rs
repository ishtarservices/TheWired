use axum::{
    extract::{connect_info::ConnectInfo, FromRequest, Request, State, WebSocketUpgrade},
    http::{header, Method},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use std::net::SocketAddr;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::config::Config;
use crate::connection;
use crate::db::Db;
use crate::nostr::event::Event;
use crate::relay_identity::RelayIdentity;

pub struct AppState {
    pub pool: Db,
    pub config: Config,
    pub broadcast_tx: broadcast::Sender<Event>,
    pub relay_identity: RelayIdentity,
    pub active_connections: AtomicUsize,
    /// Relay WebSocket URL used for NIP-42 AUTH challenge verification
    pub relay_url: String,
    /// SECURITY: when true (the embedded relay, which can be publicly tunneled),
    /// only accept events destined for groups this relay actually hosts, and
    /// only let `owner_pubkey` create groups — so a stranger can't turn a
    /// personal relay into an open relay (disk-fill / spam DoS). The production
    /// relay (behind the rate-limiting gateway) leaves this false.
    pub hosted_only: bool,
    /// In `hosted_only` mode, the only pubkey allowed to create groups (9007).
    pub owner_pubkey: Option<String>,
}

pub async fn run(config: Config, pool: Db) -> anyhow::Result<()> {
    let port = config.port;

    let (broadcast_tx, _) = broadcast::channel::<Event>(4096);

    let relay_identity = RelayIdentity::new(config.relay_secret_key.clone(), &config.rust_env);

    let relay_url = std::env::var("RELAY_URL")
        .unwrap_or_else(|_| format!("ws://localhost:{}", port));

    let state = Arc::new(AppState {
        pool,
        config,
        broadcast_tx,
        relay_identity,
        active_connections: AtomicUsize::new(0),
        relay_url,
        // Production is a multi-tenant relay behind the rate-limiting gateway.
        hosted_only: false,
        owner_pubkey: None,
    });

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    tracing::info!("Relay listening on 0.0.0.0:{}", port);
    axum::serve(
        listener,
        build_app(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

/// Build the axum router (NIP-11 / WebSocket / health) for a given state.
/// Shared by the production server ([`run`]) and the embedded relay
/// ([`run_embedded`]).
fn build_app(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::any())
        .allow_methods([Method::GET, Method::OPTIONS])
        .allow_headers([header::ACCEPT, header::CONTENT_TYPE]);

    Router::new()
        .route("/", get(root_handler))
        .route("/health", get(health))
        .layer(cors)
        .with_state(state)
}

/// A running embedded relay (Decentralized Spaces M6) — an in-process axum
/// server bound to loopback, backed by SQLite. Lives inside the Tauri client so
/// a user can host their own space relay. Call [`EmbeddedRelay::stop`] to shut
/// it down gracefully.
#[cfg(feature = "embedded")]
pub struct EmbeddedRelay {
    /// The actual bound address (read this when `port = 0` was requested).
    pub addr: SocketAddr,
    /// The relay's NIP-29 signing pubkey (clients pin it as the 39xxx author).
    pub pubkey: String,
    /// `ws://<lan-ip>:<port>` when bound to the LAN (`0.0.0.0`), else None.
    pub lan_url: Option<String>,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    join: tokio::task::JoinHandle<()>,
}

#[cfg(feature = "embedded")]
impl EmbeddedRelay {
    /// The `ws://` URL a local client uses to connect. When the relay is bound to
    /// `0.0.0.0`/`::` (LAN mode), the unspecified bind address isn't a connectable
    /// target — report loopback for local clients; the LAN address is surfaced
    /// separately via `lan_url`.
    pub fn ws_url(&self) -> String {
        let ip = if self.addr.ip().is_unspecified() {
            std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
        } else {
            self.addr.ip()
        };
        format!("ws://{}", std::net::SocketAddr::new(ip, self.addr.port()))
    }

    /// Signal graceful shutdown and await the server task.
    pub async fn stop(mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        let _ = self.join.await;
    }
}

/// Start an embedded relay bound to **loopback only** (`127.0.0.1`), backed by
/// `db` (a `Db::Sqlite`). `port = 0` lets the OS choose a free port — read it
/// back from [`EmbeddedRelay::addr`]. `relay_secret_key` should be a persisted
/// 32-byte hex key so the relay's 39xxx signatures stay stable across restarts;
/// `None` generates an ephemeral key (fine for tests / first run).
///
/// Returns once the listener is bound, so the caller can immediately hand out
/// the `ws_url()`.
#[cfg(feature = "embedded")]
pub async fn run_embedded(
    db: Db,
    port: u16,
    relay_name: String,
    relay_secret_key: Option<String>,
    owner_pubkey: Option<String>,
    bind_lan: bool,
) -> anyhow::Result<EmbeddedRelay> {
    let (broadcast_tx, _) = broadcast::channel::<Event>(4096);
    let relay_identity = RelayIdentity::new(relay_secret_key, "development");
    let pubkey = relay_identity.pubkey.clone();

    // Loopback by default; `bind_lan` exposes the relay on the local network
    // (`0.0.0.0`) for same-network testing/hosting. Writes are still locked to
    // hosted groups + the owner (`hosted_only`), so LAN exposure is bounded.
    let bind_ip = if bind_lan {
        std::net::Ipv4Addr::UNSPECIFIED
    } else {
        std::net::Ipv4Addr::LOCALHOST
    };
    // Prefer the requested (stable) port; if it's already taken, fall back to an
    // OS-assigned one so the relay still starts rather than failing outright.
    let listener = match tokio::net::TcpListener::bind((bind_ip, port)).await {
        Ok(l) => l,
        Err(_) if port != 0 => {
            tracing::warn!(port, "embedded relay port in use; falling back to an ephemeral port");
            tokio::net::TcpListener::bind((bind_ip, 0)).await?
        }
        Err(e) => return Err(e.into()),
    };
    let addr = listener.local_addr()?;
    let relay_url = format!("ws://{}", addr);
    let lan_url = if bind_lan {
        local_lan_ip().map(|ip| format!("ws://{}:{}", ip, addr.port()))
    } else {
        None
    };

    let config = Config {
        database_url: String::new(),
        port: addr.port(),
        relay_name,
        relay_description: "Embedded NIP-29 relay".to_string(),
        relay_secret_key: None,
        rust_env: "development".to_string(),
    };

    let state = Arc::new(AppState {
        pool: db,
        config,
        broadcast_tx,
        relay_identity,
        active_connections: AtomicUsize::new(0),
        relay_url,
        // Personal relay (possibly publicly tunneled): only host its own groups,
        // and only the owner may create them.
        hosted_only: true,
        owner_pubkey,
    });

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let join = tokio::spawn(async move {
        let server = axum::serve(
            listener,
            build_app(state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });
        if let Err(e) = server.await {
            tracing::error!(error = %e, "Embedded relay server error");
        }
    });

    tracing::info!(%addr, lan = bind_lan, "Embedded relay listening");
    Ok(EmbeddedRelay {
        addr,
        pubkey,
        lan_url,
        shutdown: Some(shutdown_tx),
        join,
    })
}

/// Best-effort local LAN IPv4 for the invite address.
///
/// We enumerate interfaces and prefer a **physical-LAN** private address
/// (Wi-Fi/Ethernet — `en*`/`eth*`/`wl*`) over a **tunnel** interface
/// (`utun*`/`tun*`/`wg*`/`ppp*`). The naive "connect a UDP socket to 8.8.8.8 and
/// read the source IP" trick returns whatever owns the *default route* — which,
/// under a full-tunnel VPN, is the VPN's address (e.g. `10.150.x.x`), unreachable
/// by other devices on the actual Wi-Fi. A tunnel address is used only as a
/// fallback (e.g. Tailscale/WireGuard used *as* the LAN, when no physical LAN
/// exists).
#[cfg(feature = "embedded")]
fn local_lan_ip() -> Option<std::net::IpAddr> {
    let ifaces = if_addrs::get_if_addrs().ok()?;
    pick_lan_ipv4(
        ifaces
            .into_iter()
            .filter(|i| !i.is_loopback())
            .map(|i| {
                let ip = i.ip();
                (i.name, ip)
            }),
    )
}

/// Choose the best LAN IPv4 from `(iface_name, ip)` pairs: prefer a physical-LAN
/// private address over a tunnel/VPN one; ignore public, non-IPv4, and
/// non-private addresses. Pure (no syscalls) so the heuristic is unit-tested.
#[cfg(feature = "embedded")]
fn pick_lan_ipv4(
    ifaces: impl Iterator<Item = (String, std::net::IpAddr)>,
) -> Option<std::net::IpAddr> {
    use std::net::{IpAddr, Ipv4Addr};

    fn is_lan_v4(ip: Ipv4Addr) -> bool {
        let [a, b, ..] = ip.octets();
        // RFC1918 private + RFC6598 CGNAT (100.64/10, used by Tailscale).
        // Excludes loopback, link-local (169.254), and public addresses.
        ip.is_private() || (a == 100 && (64..=127).contains(&b))
    }
    fn is_tunnel_iface(name: &str) -> bool {
        let n = name.to_lowercase();
        ["utun", "tun", "tap", "wg", "ppp", "ipsec"].iter().any(|p| n.starts_with(p))
    }

    let mut physical: Option<IpAddr> = None;
    let mut tunnel: Option<IpAddr> = None;
    for (name, ip) in ifaces {
        let IpAddr::V4(v4) = ip else { continue }; // IPv4 only for LAN sharing
        if !is_lan_v4(v4) {
            continue;
        }
        if is_tunnel_iface(&name) {
            tunnel.get_or_insert(IpAddr::V4(v4));
        } else {
            physical.get_or_insert(IpAddr::V4(v4));
        }
    }
    physical.or(tunnel)
}

#[cfg(all(test, feature = "embedded"))]
mod lan_pick_tests {
    use super::pick_lan_ipv4;
    use std::net::IpAddr;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn prefers_physical_lan_over_vpn_tunnel() {
        // The reported bug: en0 = Wi-Fi (192.168.x), utun0 = VPN (10.150.x).
        let got = pick_lan_ipv4(
            [
                ("utun0".to_string(), ip("10.150.208.12")),
                ("en0".to_string(), ip("192.168.86.202")),
            ]
            .into_iter(),
        );
        assert_eq!(got, Some(ip("192.168.86.202")));
    }

    #[test]
    fn falls_back_to_tunnel_when_no_physical_lan() {
        // Tailscale-as-LAN: only a CGNAT address on a tunnel interface.
        let got = pick_lan_ipv4([("utun3".to_string(), ip("100.96.1.2"))].into_iter());
        assert_eq!(got, Some(ip("100.96.1.2")));
    }

    #[test]
    fn ignores_public_and_link_local() {
        let got = pick_lan_ipv4(
            [
                ("en0".to_string(), ip("8.8.8.8")),     // public
                ("en1".to_string(), ip("169.254.1.1")), // link-local, not a real LAN
            ]
            .into_iter(),
        );
        assert_eq!(got, None);
    }
}

/// Handles GET / — serves NIP-11 relay info for plain HTTP requests,
/// upgrades to WebSocket for relay protocol connections.
async fn root_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
) -> impl IntoResponse {
    // NIP-11: if the client sends Accept: application/nostr+json, return relay info
    let is_nip11 = req
        .headers()
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("application/nostr+json"));

    if is_nip11 {
        return nip11_response(&state).into_response();
    }

    // Otherwise, attempt WebSocket upgrade
    match WebSocketUpgrade::from_request(req, &*state).await {
        Ok(ws) => {
            let broadcast_rx = state.broadcast_tx.subscribe();
            tracing::debug!(remote = %addr, "WebSocket upgrade");
            let resp: Response = ws
                .on_upgrade(move |socket| {
                    connection::handle_connection(socket, state, broadcast_rx, addr)
                })
                .into_response();
            resp
        }
        Err(_) => nip11_response(&state).into_response(),
    }
}

fn nip11_response(state: &AppState) -> impl IntoResponse {
    let info = serde_json::json!({
        "name": state.config.relay_name,
        "description": state.config.relay_description,
        // The relay's master key that signs NIP-29 group state (39000/39001/39002).
        // Clients MUST pin this as the expected author when reading group metadata,
        // otherwise any pubkey can forge a group's admin/member lists.
        "pubkey": state.relay_identity.pubkey,
        "supported_nips": [1, 2, 9, 11, 29, 42, 50],
        "software": "thewired-relay",
        "version": env!("CARGO_PKG_VERSION"),
        "limitation": {
            "max_subscriptions": 100,
            "max_filters": 10,
            "max_event_tags": 2500,
            "max_content_length": 102400
        }
    });
    (
        [(header::CONTENT_TYPE, "application/nostr+json")],
        Json(info),
    )
}

async fn health() -> &'static str {
    "OK"
}
