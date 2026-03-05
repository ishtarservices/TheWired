use axum::{
    extract::{connect_info::ConnectInfo, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use sqlx::PgPool;
use std::net::SocketAddr;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use tokio::sync::broadcast;

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
}

pub async fn run(config: Config, pool: PgPool) -> anyhow::Result<()> {
    let port = config.port;

    let (broadcast_tx, _) = broadcast::channel::<Event>(4096);

    let relay_identity = RelayIdentity::new(config.relay_secret_key.clone());

    let state = Arc::new(AppState {
        pool,
        config,
        broadcast_tx,
        relay_identity,
        active_connections: AtomicUsize::new(0),
    });

    let app = Router::new()
        .route("/", get(ws_handler))
        .route("/health", get(health))
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

async fn ws_handler(
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let broadcast_rx = state.broadcast_tx.subscribe();
    tracing::debug!(remote = %addr, "WebSocket upgrade");
    ws.on_upgrade(move |socket| connection::handle_connection(socket, state, broadcast_rx, addr))
}

async fn health() -> &'static str {
    "OK"
}
