use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;
use crate::nostr::membership_gate::{evaluate_publish_gate, PublishVerdict};
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

/// Did a NIP-29 management handler report success? Its OK frame looks like
/// `["OK","<id>",true,""]`; a failure has `,false,`. Used to decide whether to
/// republish group metadata (we don't want to re-emit 39000-2 on a rejected op).
fn op_succeeded(result: &[String]) -> bool {
    result.iter().any(|r| r.contains(",true,"))
}

/// After a successful state-changing NIP-29 op, regenerate + sign + broadcast
/// the group's 39000/39001/39002 events so every client can re-render it.
async fn republish_metadata_if_ok(
    state: &Arc<AppState>,
    broadcast_tx: &broadcast::Sender<Event>,
    result: &[String],
    group_id: Option<String>,
) {
    if !op_succeeded(result) {
        return;
    }
    if let Some(group_id) = group_id {
        crate::nostr::nip29::metadata::publish_group_metadata(
            &state.pool,
            &state.relay_identity,
            broadcast_tx,
            &group_id,
        )
        .await;
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

    // Verify signature off the async runtime — schnorr verify + SHA-256 is
    // CPU-bound and would otherwise block the Tokio event loop (RELAY_OPTIMIZATIONS §3).
    let event_for_verify = event.clone();
    let valid = tokio::task::spawn_blocking(move || verify_event(&event_for_verify))
        .await
        .unwrap_or(false);
    if !valid {
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
            let group_id = event.get_tag_value("h");
            let result = crate::nostr::nip29::moderation::handle_put_user(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            // Also store and broadcast NIP-29 events
            if let Ok(true) = state.pool.store_event(&event).await {
                let _ = broadcast_tx.send(event);
            }
            republish_metadata_if_ok(state, broadcast_tx, &result, group_id).await;
            return result;
        }
        9001 => {
            let group_id = event.get_tag_value("h");
            let result =
                crate::nostr::nip29::moderation::handle_remove_user(&state.pool, &event)
                    .await
                    .unwrap_or_else(|e| {
                        vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]
                    });
            if let Ok(true) = state.pool.store_event(&event).await {
                let _ = broadcast_tx.send(event);
            }
            republish_metadata_if_ok(state, broadcast_tx, &result, group_id).await;
            return result;
        }
        9002 => {
            let group_id = event.get_tag_value("h");
            let result = crate::nostr::nip29::groups::handle_edit_metadata(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            if let Ok(true) = state.pool.store_event(&event).await {
                let _ = broadcast_tx.send(event);
            }
            republish_metadata_if_ok(state, broadcast_tx, &result, group_id).await;
            return result;
        }
        9007 => {
            // SECURITY: on a restricted (embedded/personal) relay, only the
            // owner may create groups — otherwise a stranger could spam groups
            // and fill the host's disk.
            if state.hosted_only
                && state.owner_pubkey.as_deref() != Some(event.pubkey.as_str())
            {
                return vec![format!(
                    r#"["OK","{}",false,"restricted: only the relay owner can create groups"]"#,
                    event.id
                )];
            }
            let group_id = event.get_tag_value("h");
            let result = crate::nostr::nip29::groups::handle_create_group(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            if let Ok(true) = state.pool.store_event(&event).await {
                let _ = broadcast_tx.send(event);
            }
            republish_metadata_if_ok(state, broadcast_tx, &result, group_id).await;
            return result;
        }
        9008 => {
            let result = crate::nostr::nip29::groups::handle_delete_group(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            if let Ok(true) = state.pool.store_event(&event).await {
                let _ = broadcast_tx.send(event);
            }
            return result;
        }
        5 => {
            let result = crate::nostr::nip29::moderation::handle_deletion(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            // Store the deletion event itself for history
            if let Ok(true) = state.pool.store_event(&event).await {
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
            if let Ok(true) = state.pool.store_event(&event).await {
                let _ = broadcast_tx.send(event);
            }
            return result;
        }
        9021 => {
            let group_id = event.get_tag_value("h");
            let result =
                crate::nostr::nip29::membership::handle_join_request(&state.pool, &event)
                    .await
                    .unwrap_or_else(|e| {
                        vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]
                    });
            if let Ok(true) = state.pool.store_event(&event).await {
                let _ = broadcast_tx.send(event);
            }
            republish_metadata_if_ok(state, broadcast_tx, &result, group_id).await;
            return result;
        }
        9022 => {
            let group_id = event.get_tag_value("h");
            let result = crate::nostr::nip29::membership::handle_leave(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            if let Ok(true) = state.pool.store_event(&event).await {
                let _ = broadcast_tx.send(event);
            }
            republish_metadata_if_ok(state, broadcast_tx, &result, group_id).await;
            return result;
        }
        _ => {}
    }

    // SECURITY: a restricted relay (embedded/personal, possibly publicly
    // tunneled) is NOT a general-purpose relay — it only stores content for the
    // NIP-29 groups it hosts. Reject any regular event that isn't h-tagged to an
    // existing group, so a stranger can't fill the host's disk with arbitrary
    // events (open-relay abuse).
    if state.hosted_only {
        let hosts_group = match event.get_tag_value("h") {
            Some(h) => state.pool.group_exists(&h).await.unwrap_or(false),
            None => false,
        };
        if !hosts_group {
            return vec![format!(
                r#"["OK","{}",false,"restricted: this relay only accepts events for groups it hosts"]"#,
                event.id
            )];
        }
    }

    // Publish-side membership gate. NIP-29 management kinds matched above and
    // returned early; everything reaching here is regular content. If it's
    // h-tagged (space-scoped) and the kind is subject to the gate, we must
    // verify the author is a current member of `app.space_members` — otherwise
    // a kicked user keeps posting via the same WebSocket (the per-connection
    // membership cache is read-side only and stale post-kick).
    if let Some(h) = event.get_tag_value("h") {
        if crate::nostr::membership_gate::requires_h_membership_check(event.kind) {
            // Union check: members of EITHER the backend space (app.space_members)
            // OR the relay-native group (relay.group_members) may publish.
            let is_member = state.pool.is_member(&h, &event.pubkey)
                .await
                .unwrap_or_else(|e| {
                    // Fail closed: a DB error during the gate check rejects
                    // the publish rather than leaking it past the kick.
                    tracing::error!(
                        error = %e,
                        space_id = %h,
                        pubkey = &event.pubkey[..12],
                        "Membership lookup failed; rejecting publish",
                    );
                    false
                });
            if let PublishVerdict::Reject(reason) = evaluate_publish_gate(&event, is_member) {
                tracing::info!(
                    pubkey = &event.pubkey[..12],
                    space_id = %h,
                    kind = event.kind,
                    "Rejected publish: not a member of group",
                );
                return vec![format!(
                    r#"["OK","{}",false,"{}"]"#,
                    event.id, reason
                )];
            }
        }
    }

    // Store regular events
    match state.pool.store_event(&event).await {
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

    // NIP-42: an anonymous client REQ-ing a private group gets an explicit
    // `auth-required` CLOSED so it knows to AUTH and retry (rather than a silent
    // empty EOSE). Members / public groups are unaffected.
    if authed_pubkey.is_none()
        && !filter.h_tags.is_empty()
        && state.pool.any_private(&filter.h_tags)
            .await
            .unwrap_or(false)
    {
        return vec![format!(
            r#"["CLOSED","{}","auth-required: this group requires authentication"]"#,
            sub_id
        )];
    }

    // Query stored events, filtered by visibility based on auth status
    let events = state.pool
        .query_events(&filter, authed_pubkey.as_deref())
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

    // A personal (hosted_only) relay is reachable via several addresses
    // (loopback/LAN/tunnel), so the AUTH `relay` tag can't match one canonical
    // URL — relax the URL check there (the random challenge stays the binding).
    let strict_relay_url = !state.hosted_only;
    if !crate::protocol::nip42::verify_auth_event(&event, challenge, relay_url, strict_relay_url) {
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

    // Populate the broadcast-path membership cache from BOTH membership worlds
    // (app.space_members ∪ relay.group_members). Failures are logged but
    // non-fatal — the cache stays empty and h-tagged broadcasts will be hidden,
    // which is the safe default. Initial REQs still honour membership via the
    // SQL filter in event_store.
    match state.pool.members_of(&event.pubkey).await {
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
