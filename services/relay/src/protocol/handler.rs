use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use crate::db::event_store;
use crate::db::space_membership;
use crate::nostr::event::Event;
use crate::nostr::filter::Filter;
use crate::nostr::verify::verify_event;
use crate::protocol::subscription::SubscriptionManager;
use crate::server::AppState;

/// Route incoming client messages to appropriate handlers
pub async fn handle_message(
    text: &str,
    state: &Arc<AppState>,
    subscriptions: &Arc<Mutex<SubscriptionManager>>,
    authed_pubkey: &mut Option<String>,
    space_memberships: &mut HashSet<String>,
    auth_challenge: &str,
    broadcast_tx: &broadcast::Sender<Event>,
) -> Vec<String> {
    let msg: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return vec![r#"["NOTICE","invalid JSON"]"#.to_string()],
    };

    let msg_type = msg.get(0).and_then(|v| v.as_str()).unwrap_or("");

    tracing::debug!(msg_type, "Received");

    match msg_type {
        "EVENT" => handle_event(msg, state, broadcast_tx).await,
        "REQ" => handle_req(msg, state, subscriptions, authed_pubkey).await,
        "CLOSE" => handle_close(msg, subscriptions).await,
        "AUTH" => handle_auth(msg, state, authed_pubkey, space_memberships, auth_challenge).await,
        _ => {
            tracing::debug!(msg_type, "Unknown message type");
            vec![format!(r#"["NOTICE","unknown message type: {msg_type}"]"#)]
        }
    }
}

async fn handle_event(
    msg: serde_json::Value,
    state: &Arc<AppState>,
    broadcast_tx: &broadcast::Sender<Event>,
) -> Vec<String> {
    let event: Event = match serde_json::from_value(msg.get(1).cloned().unwrap_or_default()) {
        Ok(e) => e,
        Err(_) => return vec![r#"["NOTICE","invalid event"]"#.to_string()],
    };

    // Verify signature
    if !verify_event(&event) {
        tracing::debug!(
            event_id = &event.id[..12],
            pubkey = &event.pubkey[..12],
            "Rejected: invalid signature"
        );
        return vec![format!(
            r#"["OK","{}",false,"invalid: signature verification failed"]"#,
            event.id
        )];
    }

    // Handle NIP-29 moderation events
    match event.kind {
        9000 => {
            let result = crate::nostr::nip29::moderation::handle_put_user(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            // Also store and broadcast NIP-29 events
            if let Ok(true) = event_store::store_event(&state.pool, &event).await {
                let _ = broadcast_tx.send(event);
            }
            return result;
        }
        9001 => {
            let result =
                crate::nostr::nip29::moderation::handle_remove_user(&state.pool, &event)
                    .await
                    .unwrap_or_else(|e| {
                        vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]
                    });
            if let Ok(true) = event_store::store_event(&state.pool, &event).await {
                let _ = broadcast_tx.send(event);
            }
            return result;
        }
        9007 => {
            let result = crate::nostr::nip29::groups::handle_create_group(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            if let Ok(true) = event_store::store_event(&state.pool, &event).await {
                let _ = broadcast_tx.send(event);
            }
            return result;
        }
        9008 => {
            let result = crate::nostr::nip29::groups::handle_delete_group(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            if let Ok(true) = event_store::store_event(&state.pool, &event).await {
                let _ = broadcast_tx.send(event);
            }
            return result;
        }
        5 => {
            let result = crate::nostr::nip29::moderation::handle_deletion(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            // Store the deletion event itself for history
            if let Ok(true) = event_store::store_event(&state.pool, &event).await {
                let _ = broadcast_tx.send(event);
            }
            return result;
        }
        9005 => {
            let result =
                crate::nostr::nip29::moderation::handle_delete_event(&state.pool, &event)
                    .await
                    .unwrap_or_else(|e| {
                        vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]
                    });
            if let Ok(true) = event_store::store_event(&state.pool, &event).await {
                let _ = broadcast_tx.send(event);
            }
            return result;
        }
        9021 => {
            let result =
                crate::nostr::nip29::membership::handle_join_request(&state.pool, &event)
                    .await
                    .unwrap_or_else(|e| {
                        vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]
                    });
            if let Ok(true) = event_store::store_event(&state.pool, &event).await {
                let _ = broadcast_tx.send(event);
            }
            return result;
        }
        9022 => {
            let result = crate::nostr::nip29::membership::handle_leave(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            if let Ok(true) = event_store::store_event(&state.pool, &event).await {
                let _ = broadcast_tx.send(event);
            }
            return result;
        }
        _ => {}
    }

    // Store regular events
    match event_store::store_event(&state.pool, &event).await {
        Ok(true) => {
            tracing::debug!(
                event_id = &event.id[..12],
                kind = event.kind,
                pubkey = &event.pubkey[..12],
                "Event stored"
            );
            let _ = broadcast_tx.send(event.clone());
            vec![format!(r#"["OK","{}",true,""]"#, event.id)]
        }
        Ok(false) => {
            tracing::trace!(event_id = &event.id[..12], "Duplicate event");
            vec![format!(r#"["OK","{}",true,"duplicate:"]"#, event.id)]
        }
        Err(e) => {
            tracing::error!(
                event_id = &event.id[..12],
                kind = event.kind,
                error = %e,
                "Failed to store event"
            );
            vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]
        }
    }
}

async fn handle_req(
    msg: serde_json::Value,
    state: &Arc<AppState>,
    subscriptions: &Arc<Mutex<SubscriptionManager>>,
    authed_pubkey: &Option<String>,
) -> Vec<String> {
    let sub_id = match msg.get(1).and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return vec![r#"["NOTICE","missing subscription ID"]"#.to_string()],
    };

    let filter: Filter = match serde_json::from_value(msg.get(2).cloned().unwrap_or_default()) {
        Ok(f) => f,
        Err(_) => return vec![r#"["NOTICE","invalid filter"]"#.to_string()],
    };

    // Query stored events, filtered by visibility based on auth status
    let events = event_store::query_events(
        &state.pool,
        &filter,
        authed_pubkey.as_deref(),
    )
    .await
    .unwrap_or_default();

    tracing::debug!(
        sub_id,
        results = events.len(),
        kinds = ?filter.kinds,
        "REQ"
    );

    // Register subscription for live events (separate parse since Filter doesn't impl Clone)
    {
        let live_filter: Filter =
            serde_json::from_value(msg.get(2).cloned().unwrap_or_default()).unwrap_or_default();
        let mut subs = subscriptions.lock().await;
        if let Err(msg) = subs.add(sub_id.clone(), live_filter) {
            return vec![format!(r#"["CLOSED","{}","error: {}"]"#, sub_id, msg)];
        }
    }

    let mut responses: Vec<String> = events
        .into_iter()
        .map(|e| {
            format!(
                r#"["EVENT","{}",{}]"#,
                sub_id,
                serde_json::to_string(&e).unwrap_or_default()
            )
        })
        .collect();

    responses.push(format!(r#"["EOSE","{}"]"#, sub_id));
    responses
}

async fn handle_close(
    msg: serde_json::Value,
    subscriptions: &Arc<Mutex<SubscriptionManager>>,
) -> Vec<String> {
    if let Some(sub_id) = msg.get(1).and_then(|v| v.as_str()) {
        tracing::debug!(sub_id, "CLOSE");
        let mut subs = subscriptions.lock().await;
        subs.remove(sub_id);
        vec![format!(r#"["CLOSED","{}",""]"#, sub_id)]
    } else {
        vec![r#"["NOTICE","missing subscription ID"]"#.to_string()]
    }
}

/// Handle NIP-42 AUTH message: verify kind:22242 event, set authenticated pubkey,
/// and warm the per-connection space membership cache used by the broadcast filter.
async fn handle_auth(
    msg: serde_json::Value,
    state: &Arc<AppState>,
    authed_pubkey: &mut Option<String>,
    space_memberships: &mut HashSet<String>,
    challenge: &str,
) -> Vec<String> {
    let event: Event = match serde_json::from_value(msg.get(1).cloned().unwrap_or_default()) {
        Ok(e) => e,
        Err(_) => return vec![r#"["NOTICE","invalid AUTH event"]"#.to_string()],
    };

    let relay_url = &state.relay_url;

    if !crate::protocol::nip42::verify_auth_event(&event, challenge, relay_url) {
        tracing::debug!(
            event_id = &event.id[..12],
            "AUTH failed: invalid challenge/relay/signature"
        );
        return vec![format!(
            r#"["OK","{}",false,"auth-required: verification failed"]"#,
            event.id
        )];
    }

    tracing::info!(
        pubkey = &event.pubkey[..12],
        "Client authenticated (NIP-42)"
    );
    *authed_pubkey = Some(event.pubkey.clone());

    // Populate the broadcast-path membership cache from `app.space_members`.
    // Failures are logged but non-fatal — the cache stays empty and h-tagged
    // broadcasts will be hidden, which is the safe default. Initial REQs still
    // honour membership via the SQL filter in event_store.
    match space_membership::query_for_pubkey(&state.pool, &event.pubkey).await {
        Ok(set) => {
            tracing::debug!(
                pubkey = &event.pubkey[..12],
                space_count = set.len(),
                "Loaded space memberships for broadcast filter"
            );
            *space_memberships = set;
        }
        Err(e) => {
            tracing::warn!(
                pubkey = &event.pubkey[..12],
                error = %e,
                "Failed to load space memberships (h-tagged broadcasts will be hidden until reconnect)"
            );
        }
    }

    vec![format!(r#"["OK","{}",true,""]"#, event.id)]
}
