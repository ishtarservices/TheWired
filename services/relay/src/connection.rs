use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use crate::nostr::event::Event;
use crate::protocol::handler;
use crate::protocol::nip42;
use crate::server::AppState;

/// Maximum incoming WebSocket message size (128 KiB)
const MAX_MESSAGE_SIZE: usize = 128 * 1024;

/// Lightweight visibility check for broadcast events (no DB query).
/// Checks if the event is protected and whether the client is the author
/// or a p-tagged collaborator. Space membership is NOT checked here
/// (would require async DB query per broadcast per connection — too expensive).
/// Space-scoped events will be filtered by the initial REQ query;
/// broadcast leaks are a lower-priority gap covered by h-tag matching
/// in the subscription filter.
fn is_event_visible_to(event: &Event, authed_pubkey: &Option<String>) -> bool {
    let visibility = event.get_tag_value("visibility");

    // Public events (no visibility tag): always visible
    if visibility.is_none() && event.get_tag_value("h").is_none() {
        return true;
    }

    // Protected event — check if client is authenticated
    let pk = match authed_pubkey {
        Some(pk) => pk,
        None => return false, // Unauthenticated: hide all protected events
    };

    // Author always sees own events
    if event.pubkey == *pk {
        return true;
    }

    // Check p-tag for collaborator access
    event.tags.iter().any(|t| {
        t.first().is_some_and(|k| k == "p") && t.get(1).is_some_and(|v| v == pk)
    })
}

/// Per-client WebSocket connection handler
pub async fn handle_connection(
    socket: WebSocket,
    state: Arc<AppState>,
    mut broadcast_rx: broadcast::Receiver<Event>,
    addr: SocketAddr,
) {
    let conn_count = state.active_connections.fetch_add(1, Ordering::Relaxed) + 1;
    let connected_at = std::time::Instant::now();
    let mut events_received: u64 = 0;
    let mut events_sent: u64 = 0;

    tracing::info!(
        remote = %addr,
        connections = conn_count,
        "Client connected"
    );

    let (mut sender, mut receiver) = socket.split();
    let subscriptions = Arc::new(Mutex::new(
        crate::protocol::subscription::SubscriptionManager::new(),
    ));
    let mut authed_pubkey: Option<String> = None;
    let auth_challenge = nip42::generate_challenge();

    // Send NIP-42 AUTH challenge on connect
    let auth_msg = format!(r#"["AUTH","{}"]"#, auth_challenge);
    let _ = sender.send(Message::Text(auth_msg.into())).await;

    loop {
        tokio::select! {
            // Handle incoming WebSocket messages from the client
            ws_msg = receiver.next() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        if text.len() > MAX_MESSAGE_SIZE {
                            let notice = format!(
                                r#"["NOTICE","message too large: {} bytes (max {})"]"#,
                                text.len(), MAX_MESSAGE_SIZE
                            );
                            let _ = sender.send(Message::Text(notice.into())).await;
                            continue;
                        }
                        events_received += 1;
                        let responses = handler::handle_message(
                            &text,
                            &state,
                            &subscriptions,
                            &mut authed_pubkey,
                            &auth_challenge,
                            &state.broadcast_tx,
                        )
                        .await;

                        for response in responses {
                            if sender.send(Message::Text(response.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }

            // Handle broadcast events from other connections
            broadcast_result = broadcast_rx.recv() => {
                match broadcast_result {
                    Ok(event) => {
                        // Visibility check: don't send protected events to unauthorized clients
                        if !is_event_visible_to(&event, &authed_pubkey) {
                            continue;
                        }

                        let subs = subscriptions.lock().await;
                        let matching = subs.matching_subs(&event);
                        drop(subs);

                        for sub_id in matching {
                            let event_json = serde_json::to_string(&event).unwrap_or_default();
                            let msg = format!(r#"["EVENT","{sub_id}",{event_json}]"#);
                            events_sent += 1;
                            if sender.send(Message::Text(msg.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(remote = %addr, skipped = n, "Broadcast receiver lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
        }
    }

    state.active_connections.fetch_sub(1, Ordering::Relaxed);
    tracing::info!(
        remote = %addr,
        duration_secs = connected_at.elapsed().as_secs(),
        events_received,
        events_sent,
        "Client disconnected"
    );
}
