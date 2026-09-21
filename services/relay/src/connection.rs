use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use crate::nostr::event::Event;
use crate::nostr::wrap_gate::{self, ReadCtx, WrapAuthGate};
use crate::protocol::handler;
use crate::protocol::nip42;
use crate::server::AppState;

/// How long the per-connection membership cache is trusted before we re-query
/// `app.space_members`. The publish-side gate (handler.rs) enforces membership
/// authoritatively per-EVENT, so this cache only governs *receiving*. A 30 s
/// staleness window means a kicked user keeps reading their old channels for
/// at most 30 s before they're cut off, even if they hold an open WebSocket.
/// Refresh is *lazy* — only triggered when an h-tagged event is about to be
/// forwarded — so idle connections do not poll the DB.
const MEMBERSHIP_TTL: Duration = Duration::from_secs(30);

/// If `last_refresh` is older than [`MEMBERSHIP_TTL`], re-query the membership
/// set from `app.space_members`. Failures are logged and leave the cache
/// untouched (and the timestamp un-bumped, so we'll retry on the next call).
/// Returns `true` if a refresh happened.
async fn maybe_refresh_memberships(
    state: &Arc<AppState>,
    authed_pubkey: &Option<String>,
    space_memberships: &mut HashSet<String>,
    last_refresh: &mut Instant,
) -> bool {
    let pk = match authed_pubkey {
        Some(pk) => pk,
        None => return false,
    };
    if last_refresh.elapsed() < MEMBERSHIP_TTL {
        return false;
    }
    match state.pool.members_of(pk).await {
        Ok(set) => {
            *space_memberships = set;
            *last_refresh = Instant::now();
            true
        }
        Err(e) => {
            tracing::warn!(
                pubkey = &pk[..12.min(pk.len())],
                error = %e,
                "Membership refresh failed; keeping stale cache"
            );
            false
        }
    }
}

/// Maximum incoming WebSocket message size (128 KiB)
const MAX_MESSAGE_SIZE: usize = 128 * 1024;

/// Visibility check for broadcast events (no per-broadcast DB query), with
/// the DM wire contract's gift-wrap gate and NIP-40 expiration applied:
///   0. Expired events are never forwarded; a kind-1059 wrap goes only to
///      its authenticated recipient (or the ingest role / non-enforcing gate).
/// Then the ordinary rules:
/// Order:
///   1. Public events (no visibility, no h-tag) → visible to everyone.
///   2. Unauthenticated clients → never see protected events.
///   3. Author always sees own events.
///   4. Explicit p-tagged collaborators always see the event.
///   5. h-tagged (space-scoped) events: visible if the authed pubkey is a
///      member of ANY listed space, per the cached set populated on AUTH from
///      `app.space_members`. Without this, members of a space never receive
///      live broadcasts of kind:9 from other members — only history via
///      REQ — so chat appears frozen until you switch and re-enter.
#[cfg(test)]
fn is_event_visible_to(
    event: &Event,
    authed_pubkey: &Option<String>,
    space_memberships: &HashSet<String>,
) -> bool {
    let ctx = ReadCtx::plain(authed_pubkey.as_deref());
    is_event_visible_to_ctx(event, &ctx, space_memberships)
}

fn is_event_visible_to_ctx(
    event: &Event,
    ctx: &ReadCtx<'_>,
    space_memberships: &HashSet<String>,
) -> bool {
    if wrap_gate::is_expired(event, ctx.now) {
        return false;
    }
    if !wrap_gate::wrap_visible(event, ctx) {
        return false;
    }
    let authed_owned: Option<String> = ctx.authed.map(str::to_string);
    let authed_pubkey = &authed_owned;
    let visibility = event.get_tag_value("visibility");
    let h_tags = event.get_tag_values("h");

    // Public events: always visible
    if visibility.is_none() && h_tags.is_empty() {
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

    // h-tag: membership of any listed space
    h_tags.iter().any(|h| space_memberships.contains(h))
}

/// Per-client WebSocket connection handler
pub async fn handle_connection(
    socket: WebSocket,
    state: Arc<AppState>,
    mut broadcast_rx: broadcast::Receiver<Event>,
    addr: SocketAddr,
    client_ip: std::net::IpAddr,
) {
    // Per-IP connection cap (docs/DM_WIRE_CONTRACT.md §7.6). Counted on the
    // proxy-resolved client IP; released on disconnect below.
    let ip_cap = state.config.max_conns_per_ip;
    if ip_cap > 0 {
        let over = {
            let mut m = state.ip_conns.lock().unwrap_or_else(|e| e.into_inner());
            let n = m.entry(client_ip).or_insert(0);
            if *n >= ip_cap {
                true
            } else {
                *n += 1;
                false
            }
        };
        if over {
            tracing::warn!(remote = %addr, client = %client_ip, "Connection cap reached for IP");
            let (mut sender, _) = socket.split();
            let _ = sender
                .send(Message::Text(
                    r#"["NOTICE","rate limited: too many connections from your address"]"#.into(),
                ))
                .await;
            let _ = sender.close().await;
            return;
        }
    }

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
    // Last time `space_memberships` was refreshed from the DB. AUTH populates
    // the cache and stamps this; lazy refresh in the broadcast path bumps it.
    let mut memberships_refreshed_at: Instant = Instant::now();
    // Per-connection rate window — always on; nothing else limits WebSocket
    // traffic (the Caddy proxy routes the relay around the gateway).
    let rate_window = Duration::from_secs(state.config.rate_window_secs.max(1));
    let rate_max_msgs = state.config.rate_max_msgs;
    let mut rate_window_start: Instant = Instant::now();
    let mut msgs_in_window: u32 = 0;
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
                        // Rate limit. Drop over-limit messages; warn once per window.
                        if rate_max_msgs > 0 {
                            if rate_window_start.elapsed() >= rate_window {
                                rate_window_start = Instant::now();
                                msgs_in_window = 0;
                            }
                            msgs_in_window += 1;
                            if msgs_in_window > rate_max_msgs {
                                if msgs_in_window == rate_max_msgs + 1 {
                                    let _ = sender
                                        .send(Message::Text(
                                            r#"["NOTICE","rate limited: slow down"]"#.into(),
                                        ))
                                        .await;
                                }
                                continue;
                            }
                        }
                        events_received += 1;
                        let was_authed = authed_pubkey.is_some();
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
                        // AUTH success transitions None → Some(pubkey) AND
                        // populates `space_memberships` from the DB. Bump the
                        // refresh timestamp so the lazy refresh logic doesn't
                        // immediately re-query the row we just fetched.
                        if !was_authed && authed_pubkey.is_some() {
                            memberships_refreshed_at = Instant::now();
                        }

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
                        // For h-tagged (space-scoped) events, lazily refresh the
                        // membership cache if it's older than MEMBERSHIP_TTL —
                        // otherwise a kicked user holding this socket keeps
                        // receiving the channel until they reconnect.
                        if event.get_tag_value("h").is_some() {
                            maybe_refresh_memberships(
                                &state,
                                &authed_pubkey,
                                &mut space_memberships,
                                &mut memberships_refreshed_at,
                            ).await;
                        }

                        // Visibility check: don't send protected events to unauthorized clients
                        let ctx = handler::read_ctx(&state, &authed_pubkey);
                        if !is_event_visible_to_ctx(&event, &ctx, &space_memberships) {
                            continue;
                        }
                        // Gate in `warn` mode: the wrap is being served to a
                        // non-recipient; count it so we know when to enforce.
                        if event.kind == wrap_gate::KIND_GIFT_WRAP
                            && state.config.wrap_auth_gate == WrapAuthGate::Warn
                            && !wrap_gate::wrap_visible(&event, &ReadCtx { serve_all_wraps: false, ..ctx })
                        {
                            tracing::info!(remote = %addr, "wrap gate (warn): live wrap would be denied");
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
    if ip_cap > 0 {
        let mut m = state.ip_conns.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(n) = m.get_mut(&client_ip) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                m.remove(&client_ip);
            }
        }
    }
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

    /// Multi-space events: a member of ANY listed space receives the broadcast,
    /// including when their space is the second h tag.
    #[test]
    fn multi_h_member_of_second_space_sees_broadcast() {
        let evt = event_with(
            31683,
            "alice",
            vec![
                vec!["h".into(), "space_x".into()],
                vec!["h".into(), "space_y".into()],
            ],
        );
        assert!(is_event_visible_to(&evt, &Some("bob".into()), &set_with(&["space_y"])));
        assert!(is_event_visible_to(&evt, &Some("bob".into()), &set_with(&["space_x"])));
    }

    /// Multi-space events stay hidden from a member of none of the listed spaces.
    #[test]
    fn multi_h_non_member_of_all_blocked() {
        let evt = event_with(
            31683,
            "alice",
            vec![
                vec!["h".into(), "space_x".into()],
                vec!["h".into(), "space_y".into()],
            ],
        );
        assert!(!is_event_visible_to(&evt, &Some("bob".into()), &set_with(&["space_z"])));
        assert!(!is_event_visible_to(&evt, &Some("bob".into()), &empty_set()));
    }

    /// Multi-space events are never public: anonymous clients are blocked.
    #[test]
    fn multi_h_anonymous_blocked() {
        let evt = event_with(
            31683,
            "alice",
            vec![
                vec!["h".into(), "space_x".into()],
                vec!["h".into(), "space_y".into()],
            ],
        );
        assert!(!is_event_visible_to(&evt, &None, &set_with(&["space_x", "space_y"])));
    }

    /// TTL guard: the lazy refresh should only fire when the cache exceeds
    /// `MEMBERSHIP_TTL`. We can't drive the actual `maybe_refresh_memberships`
    /// here without a DB, but we can sanity-check the arithmetic that decides
    /// whether to skip vs. refresh.
    #[test]
    fn ttl_guard_skips_recent_refresh() {
        let recent = Instant::now();
        assert!(
            recent.elapsed() < MEMBERSHIP_TTL,
            "a just-stamped Instant must be considered fresh — \
             otherwise we'd refresh on every broadcast event after AUTH"
        );
    }

    /// DM wire contract §7.1: a gift wrap reaches only its authenticated
    /// recipient — never anonymous sockets, never other authed users — unless
    /// the connection holds the ingest role.
    #[test]
    fn gift_wrap_only_to_recipient_or_ingest() {
        let evt = event_with(1059, "ephemeral", vec![vec!["p".into(), "bob".into()]]);
        assert!(!is_event_visible_to(&evt, &None, &empty_set()));
        assert!(is_event_visible_to(&evt, &Some("bob".into()), &empty_set()));
        assert!(!is_event_visible_to(&evt, &Some("carol".into()), &empty_set()));
        let ingest = ReadCtx { authed: Some("backend"), serve_all_wraps: true, now: 0 };
        assert!(is_event_visible_to_ctx(&evt, &ingest, &empty_set()));
    }

    /// NIP-40: an expired event is never forwarded, even a public one.
    #[test]
    fn expired_events_are_never_broadcast() {
        let evt = event_with(1, "alice", vec![vec!["expiration".into(), "100".into()]]);
        let live = ReadCtx { authed: None, serve_all_wraps: false, now: 99 };
        let dead = ReadCtx { authed: None, serve_all_wraps: false, now: 100 };
        assert!(is_event_visible_to_ctx(&evt, &live, &empty_set()));
        assert!(!is_event_visible_to_ctx(&evt, &dead, &empty_set()));
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
