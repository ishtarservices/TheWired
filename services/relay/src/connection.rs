use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::collections::HashSet;
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

/// Visibility check for broadcast events (no per-broadcast DB query).
/// Order:
///   1. Public events (no visibility, no h-tag) → visible to everyone.
///   2. Unauthenticated clients → never see protected events.
///   3. Author always sees own events.
///   4. Explicit p-tagged collaborators always see the event.
///   5. h-tagged (space-scoped) events: visible if the authed pubkey is a
///      member of that space, per the cached set populated on AUTH from
///      `app.space_members`. Without this, members of a space never receive
///      live broadcasts of kind:9 from other members — only history via
///      REQ — so chat appears frozen until you switch and re-enter.
fn is_event_visible_to(
    event: &Event,
    authed_pubkey: &Option<String>,
    space_memberships: &HashSet<String>,
) -> bool {
    let visibility = event.get_tag_value("visibility");
    let h_tag = event.get_tag_value("h");

    // Public events: always visible
    if visibility.is_none() && h_tag.is_none() {
        return true;
    }

    // Protected event — must be authenticated
    let pk = match authed_pubkey {
        Some(pk) => pk,
        None => return false,
    };

    // Author always sees own events
    if event.pubkey == *pk {
        return true;
    }

    // p-tag: collaborator access
    let p_tagged = event.tags.iter().any(|t| {
        t.first().is_some_and(|k| k == "p") && t.get(1).is_some_and(|v| v == pk)
    });
    if p_tagged {
        return true;
    }

    // h-tag: space membership
    if let Some(h) = h_tag {
        if space_memberships.contains(&h) {
            return true;
        }
    }

    false
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
    let mut space_memberships: HashSet<String> = HashSet::new();
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
                            &mut space_memberships,
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
                        if !is_event_visible_to(&event, &authed_pubkey, &space_memberships) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn event_with(kind: i32, pubkey: &str, tags: Vec<Vec<String>>) -> Event {
        Event {
            id: "test_id".to_string(),
            pubkey: pubkey.to_string(),
            created_at: 1_000_000,
            kind,
            tags,
            content: String::new(),
            sig: "test_sig".to_string(),
        }
    }

    fn empty_set() -> HashSet<String> {
        HashSet::new()
    }

    fn set_with(spaces: &[&str]) -> HashSet<String> {
        spaces.iter().map(|s| s.to_string()).collect()
    }

    /// Public events (no visibility tag, no h-tag) are always visible,
    /// even to anonymous clients.
    #[test]
    fn public_events_visible_to_anonymous() {
        let evt = event_with(1, "alice", vec![]);
        assert!(is_event_visible_to(&evt, &None, &empty_set()));
    }

    /// Anonymous clients never see protected events (h-tagged or visibility-tagged).
    #[test]
    fn anonymous_blocked_from_protected_events() {
        let h_tagged = event_with(9, "alice", vec![vec!["h".into(), "space_x".into()]]);
        let visibility_tagged = event_with(
            1,
            "alice",
            vec![vec!["visibility".into(), "private".into()]],
        );
        assert!(!is_event_visible_to(&h_tagged, &None, &empty_set()));
        assert!(!is_event_visible_to(&visibility_tagged, &None, &empty_set()));
    }

    /// Authors always see their own protected events even if not space-members.
    #[test]
    fn author_always_sees_own_event() {
        let evt = event_with(9, "alice", vec![vec!["h".into(), "space_x".into()]]);
        assert!(is_event_visible_to(
            &evt,
            &Some("alice".into()),
            &empty_set()
        ));
    }

    /// p-tagged collaborators see protected events even if not space-members.
    #[test]
    fn p_tagged_sees_event() {
        let evt = event_with(
            9,
            "alice",
            vec![
                vec!["h".into(), "space_x".into()],
                vec!["p".into(), "bob".into()],
            ],
        );
        assert!(is_event_visible_to(&evt, &Some("bob".into()), &empty_set()));
    }

    /// THE PHASE 2 FIX: h-tagged events reach members of the space via broadcast.
    /// Before this fix, only authors and p-tagged users received broadcasts —
    /// space members never saw live messages from other members.
    #[test]
    fn space_member_sees_h_tagged_broadcast() {
        let evt = event_with(9, "alice", vec![vec!["h".into(), "space_x".into()]]);
        let memberships = set_with(&["space_x"]);
        assert!(is_event_visible_to(
            &evt,
            &Some("bob".into()),
            &memberships
        ));
    }

    /// Non-members of a space do NOT receive its broadcasts.
    #[test]
    fn non_member_blocked_from_h_tagged_broadcast() {
        let evt = event_with(9, "alice", vec![vec!["h".into(), "space_x".into()]]);
        let memberships = set_with(&["space_y"]); // bob is in space_y, not space_x
        assert!(!is_event_visible_to(
            &evt,
            &Some("bob".into()),
            &memberships
        ));
    }

    /// Empty membership set → h-tagged events from others are hidden.
    /// Guards against the cache failing to populate (e.g., DB error on AUTH).
    #[test]
    fn empty_memberships_blocks_other_authors_h_tagged() {
        let evt = event_with(9, "alice", vec![vec!["h".into(), "space_x".into()]]);
        assert!(!is_event_visible_to(
            &evt,
            &Some("bob".into()),
            &empty_set()
        ));
    }

    /// Visibility-tagged events without an h-tag still respect author / p-tag.
    /// Membership cache doesn't apply when there's no h-tag.
    #[test]
    fn visibility_tagged_uses_author_and_p_tag_only() {
        let evt = event_with(
            1,
            "alice",
            vec![
                vec!["visibility".into(), "private".into()],
                vec!["p".into(), "bob".into()],
            ],
        );
        // Bob is p-tagged → visible
        assert!(is_event_visible_to(&evt, &Some("bob".into()), &empty_set()));
        // Carol is not author, not p-tagged, no h-tag to fall back to → hidden
        assert!(!is_event_visible_to(
            &evt,
            &Some("carol".into()),
            &set_with(&["any_space"])
        ));
    }
}
