use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use crate::db::event_store;
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
    _authed_pubkey: &mut Option<String>,
    broadcast_tx: &broadcast::Sender<Event>,
) -> Vec<String> {
    let msg: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return vec![r#"["NOTICE","invalid JSON"]"#.to_string()],
    };

    let msg_type = msg.get(0).and_then(|v| v.as_str()).unwrap_or("");

    match msg_type {
        "EVENT" => handle_event(msg, state, broadcast_tx).await,
        "REQ" => handle_req(msg, state, subscriptions).await,
        "CLOSE" => handle_close(msg, subscriptions).await,
        _ => vec![format!(r#"["NOTICE","unknown message type: {msg_type}"]"#)],
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
            let _ = broadcast_tx.send(event.clone());
            vec![format!(r#"["OK","{}",true,""]"#, event.id)]
        }
        Ok(false) => vec![format!(r#"["OK","{}",true,"duplicate:"]"#, event.id)],
        Err(e) => vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)],
    }
}

async fn handle_req(
    msg: serde_json::Value,
    state: &Arc<AppState>,
    subscriptions: &Arc<Mutex<SubscriptionManager>>,
) -> Vec<String> {
    let sub_id = match msg.get(1).and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return vec![r#"["NOTICE","missing subscription ID"]"#.to_string()],
    };

    let filter: Filter = match serde_json::from_value(msg.get(2).cloned().unwrap_or_default()) {
        Ok(f) => f,
        Err(_) => return vec![r#"["NOTICE","invalid filter"]"#.to_string()],
    };

    // Register subscription for live events
    let sub_filter: Filter =
        serde_json::from_value(msg.get(2).cloned().unwrap_or_default()).unwrap_or_default();
    {
        let mut subs = subscriptions.lock().await;
        subs.add(sub_id.clone(), filter);
    }

    // Query stored events
    let events = event_store::query_events(&state.pool, &sub_filter)
        .await
        .unwrap_or_default();

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
        let mut subs = subscriptions.lock().await;
        subs.remove(sub_id);
        vec![format!(r#"["CLOSED","{}",""]"#, sub_id)]
    } else {
        vec![r#"["NOTICE","missing subscription ID"]"#.to_string()]
    }
}
