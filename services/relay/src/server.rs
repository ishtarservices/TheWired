use axum::{
    extract::{connect_info::ConnectInfo, FromRequest, Request, State, WebSocketUpgrade},
    http::{header, Method},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use sqlx::PgPool;
use std::net::SocketAddr;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::config::Config;
use crate::connection;
use crate::nostr::event::Event;
use crate::relay_identity::RelayIdentity;

pub struct AppState {
    pub pool: PgPool,
    pub config: Config,
    pub broadcast_tx: broadcast::Sender<Event>,
    pub relay_identity: RelayIdentity,
    pub active_connections: AtomicUsize,
    /// Relay WebSocket URL used for NIP-42 AUTH challenge verification
    pub relay_url: String,
}

pub async fn run(config: Config, pool: PgPool) -> anyhow::Result<()> {
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
    });

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::any())
        .allow_methods([Method::GET, Method::OPTIONS])
        .allow_headers([header::ACCEPT, header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/", get(root_handler))
        .route("/health", get(health))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    tracing::info!("Relay listening on 0.0.0.0:{}", port);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
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
        "supported_nips": [1, 2, 9, 11, 29, 42, 50],
        "software": "thewired-relay",
        "version": env!("CARGO_PKG_VERSION"),
        "limitation": {
            "max_subscriptions": 20,
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
