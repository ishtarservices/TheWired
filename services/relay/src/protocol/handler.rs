use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;
use crate::nostr::membership_gate::{
    distinct_h_tags, evaluate_publish_gate, PublishVerdict, SpaceMembership,
};
use crate::nostr::moderation_gate;
use crate::nostr::report_gate;
use crate::nostr::verify::verify_event;
use crate::nostr::wrap_gate::{self, ReadCtx, WrapAuthGate, WrapIntake, WrapIntakeGate};
use crate::protocol::subscription::SubscriptionManager;
use crate::server::AppState;

/// NIP-77 frame size limit (bytes) for the relay side of a reconciliation.
const NEG_FRAME_SIZE_LIMIT: u64 = 60_000;

/// The read context of a connection: who it is, whether it may read every
/// gift wrap (ingest role, or a gate mode other than `enforce`), every report
/// (ingest role, or the report gate off), and "now".
pub fn read_ctx<'a>(state: &'a AppState, authed_pubkey: &'a Option<String>) -> ReadCtx<'a> {
    let authed = authed_pubkey.as_deref();
    let ingest = authed.is_some_and(|pk| state.config.is_ingest(pk));
    ReadCtx {
        authed,
        serve_all_wraps: ingest || state.config.wrap_auth_gate != WrapAuthGate::Enforce,
        serve_all_reports: ingest || !state.config.report_read_gate,
        now: wrap_gate::unix_now(),
        firehose_policy: state.config.firehose_policy,
    }
}

/// Char-boundary-safe prefix for logging untrusted strings (#113). Slicing an
/// unverified event's id/pubkey with `&s[..12]` panics on a short string or a
/// multi-byte char straddling the boundary; this never panics.
fn log_prefix(s: &str) -> &str {
    let mut end = s.len().min(12);
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

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
        "EVENT" => handle_event(msg, state, broadcast_tx, authed_pubkey).await,
        "REQ" => handle_req(msg, state, subscriptions, authed_pubkey).await,
        "CLOSE" => handle_close(msg, subscriptions).await,
        "AUTH" => handle_auth(msg, state, authed_pubkey, space_memberships, auth_challenge).await,
        // NIP-77 negentropy set reconciliation (docs/DM_WIRE_CONTRACT.md §7.5).
        "NEG-OPEN" => handle_neg_open(msg, state, subscriptions, authed_pubkey).await,
        "NEG-MSG" => handle_neg_msg(msg, subscriptions).await,
        "NEG-CLOSE" => handle_neg_close(msg, subscriptions).await,
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

/// Store + broadcast a NIP-29 management event ONLY if its handler reported
/// success (#68). Previously these were stored/broadcast unconditionally, so a
/// non-admin's rejected 9000/9001/9005/... still propagated to every subscriber.
async fn store_and_broadcast_if_ok(
    state: &Arc<AppState>,
    broadcast_tx: &broadcast::Sender<Event>,
    result: &[String],
    event: Event,
) {
    if !op_succeeded(result) {
        return;
    }
    if let Ok(true) = state.pool.store_event(&event).await {
        let _ = broadcast_tx.send(event);
    }
}

/// The `OK false` a restricted (hosted_only) relay answers to a write that is
/// not for a group it hosts.
fn hosted_only_rejection(event: &Event) -> String {
    format!(
        r#"["OK","{}",false,"restricted: this relay only accepts events for groups it hosts"]"#,
        event.id
    )
}

/// Does any of these ids name a group this relay hosts? A lookup error counts
/// as "no" (fail closed).
async fn names_hosted_group(state: &AppState, h_tags: &[String]) -> bool {
    for h in h_tags {
        if state.pool.group_exists(h).await.unwrap_or(false) {
            return true;
        }
    }
    false
}

/// hosted_only policy for a kind 5: accepted only when at least one `e`
/// target is an event this relay holds AND the sender authored, or when an
/// own `a` target names an address this relay holds. Naming a hosted group
/// in `h` is not enough — a deletion of nothing is still free storage.
async fn hosted_deletion_allowed(state: &AppState, event: &Event) -> bool {
    let mut checked = 0usize;
    for tag in &event.tags {
        if checked >= crate::nostr::nip29::moderation::MAX_DELETION_TARGETS {
            break;
        }
        match (tag.first().map(String::as_str), tag.get(1)) {
            (Some("e"), Some(id)) => {
                checked += 1;
                if let Ok(Some(target)) = state.pool.get_event_by_id(id).await {
                    if target.pubkey == event.pubkey {
                        return true;
                    }
                }
            }
            (Some("a"), Some(addr)) => {
                checked += 1;
                let parts: Vec<&str> = addr.splitn(3, ':').collect();
                if parts.len() == 3 && parts[1] == event.pubkey {
                    if let Ok(kind) = parts[0].parse::<i32>() {
                        let filter = Filter {
                            authors: vec![event.pubkey.clone()],
                            kinds: vec![kind],
                            d_tags: vec![parts[2].to_string()],
                            limit: Some(1),
                            ..Filter::default()
                        };
                        let ctx = ReadCtx::plain(Some(&event.pubkey));
                        if matches!(state.pool.query_events_ctx(&filter, &ctx).await, Ok(v) if !v.is_empty()) {
                            return true;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    false
}

async fn handle_event(
    msg: serde_json::Value,
    state: &Arc<AppState>,
    broadcast_tx: &broadcast::Sender<Event>,
    authed_pubkey: &Option<String>,
) -> Vec<String> {
    let event: Event = match serde_json::from_value(msg.get(1).cloned().unwrap_or_default()) {
        Ok(e) => e,
        Err(_) => return vec![r#"["NOTICE","invalid event"]"#.to_string()],
    };

    // created_at bounds (audit 2026-10): negative or far-future timestamps are
    // refused before the (CPU-bound) signature check.
    if !crate::nostr::event::created_at_in_bounds(event.created_at, wrap_gate::unix_now()) {
        return vec![format!(
            r#"["OK","{}",false,"invalid: created_at is negative or too far in the future"]"#,
            event.id
        )];
    }

    // NIP-40: an already-expired event is dropped on receipt.
    if wrap_gate::is_expired(&event, wrap_gate::unix_now()) {
        return vec![format!(r#"["OK","{}",false,"invalid: event expired"]"#, event.id)];
    }

    // NIP-17 self-wrap detection: a gift wrap published by a socket that is
    // authenticated as the wrap's own recipient is the sender's copy. Recorded
    // so the backend push planner can skip it (§7.3).
    let self_published = wrap_gate::is_self_published(&event, authed_pubkey.as_deref());

    // Verify signature off the async runtime — schnorr verify + SHA-256 is
    // CPU-bound and would otherwise block the Tokio event loop (RELAY_OPTIMIZATIONS §3).
    let event_for_verify = event.clone();
    let valid = tokio::task::spawn_blocking(move || verify_event(&event_for_verify))
        .await
        .unwrap_or(false);
    if !valid {
        tracing::debug!(
            event_id = log_prefix(&event.id),
            pubkey = log_prefix(&event.pubkey),
            "Rejected: invalid signature"
        );
        return vec![format!(
            r#"["OK","{}",false,"invalid: signature verification failed"]"#,
            event.id
        )];
    }

    // NIP-29 group metadata (39000-39009) is RELAY-generated: the relay signs and
    // writes its own group state directly (never accepting it over EVENT), so any
    // inbound one is a forgery trying to spoof the admin/member lists (#112).
    if (39000..=39009).contains(&event.kind) {
        return vec![format!(
            r#"["OK","{}",false,"restricted: kind {} is relay-generated"]"#,
            event.id, event.kind
        )];
    }

    // Operator moderation (App Store 1.2): an event the operator removed is
    // never stored again, and a suspended account may only delete its own
    // content. Checked before every kind-specific path, NIP-29 ops included.
    // Fails closed like the membership gate: a lookup error rejects the write.
    match state.pool.moderation_state(&event.id, &event.pubkey).await {
        Ok(mstate) => {
            if let Some(reason) = moderation_gate::block_reason(event.kind, mstate.tombstoned, mstate.suspended) {
                tracing::info!(
                    event_id = log_prefix(&event.id),
                    pubkey = log_prefix(&event.pubkey),
                    kind = event.kind,
                    reason,
                    "Rejected publish: operator moderation",
                );
                return vec![format!(r#"["OK","{}",false,"{}"]"#, event.id, reason)];
            }
            // A shadowed author's write goes through as normal (it must not
            // learn it is shadowed); make sure the live-broadcast filter
            // already knows the pubkey before this event is fanned out, even
            // if the periodic refresh hasn't run since the operator acted.
            if mstate.shadowed {
                state.note_shadowed(&event.pubkey);
            }
        }
        Err(e) => {
            tracing::error!(
                error = %e,
                event_id = log_prefix(&event.id),
                "Moderation lookup failed; rejecting publish",
            );
            return vec![format!(
                r#"["OK","{}",false,"error: could not check moderation state"]"#,
                event.id
            )];
        }
    }

    // Gift-wrap intake (`RELAY_WRAP_INTAKE_GATE`): a public relay with no
    // write auth is otherwise everyone's DM inbox. A kind-1059 lands here only
    // when a recipient has a relay list stored here that admits it (a 10050
    // naming this relay, or a 10002 with no 10050), or when its recipient is
    // the authenticated publisher. Postgres only; the embedded relay skips it.
    if let Some(frame) = wrap_intake_refusal(state, &event, authed_pubkey.as_deref()).await {
        return vec![frame];
    }

    // Deletions stick (security audit 2026-10): an event a prior NIP-09 /
    // NIP-29 deletion covers is refused, whoever re-sends it. Fails closed.
    match state.pool.is_deleted(&event).await {
        Ok(true) => {
            tracing::debug!(event_id = log_prefix(&event.id), kind = event.kind, "Rejected publish: deleted");
            return vec![format!(r#"["OK","{}",false,"deleted: this event was deleted"]"#, event.id)];
        }
        Ok(false) => {}
        Err(e) => {
            tracing::error!(error = %e, event_id = log_prefix(&event.id), "Deletion lookup failed; rejecting publish");
            return vec![format!(
                r#"["OK","{}",false,"error: could not check deletion state"]"#,
                event.id
            )];
        }
    }

    // #115 — music events (31683/33123/30119) must carry the structural tags the
    // client relies on (title + d). Previously stored unvalidated.
    if crate::music::kinds::is_music_kind(event.kind)
        && !crate::music::kinds::validate_music_event(event.kind, &event.tags)
    {
        return vec![format!(
            r#"["OK","{}",false,"invalid: music events require title and d tags"]"#,
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
            store_and_broadcast_if_ok(state, broadcast_tx, &result, event).await;
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
            store_and_broadcast_if_ok(state, broadcast_tx, &result, event).await;
            republish_metadata_if_ok(state, broadcast_tx, &result, group_id).await;
            return result;
        }
        9002 => {
            let group_id = event.get_tag_value("h");
            let result = crate::nostr::nip29::groups::handle_edit_metadata(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            store_and_broadcast_if_ok(state, broadcast_tx, &result, event).await;
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
            store_and_broadcast_if_ok(state, broadcast_tx, &result, event).await;
            republish_metadata_if_ok(state, broadcast_tx, &result, group_id).await;
            return result;
        }
        9008 => {
            let result = crate::nostr::nip29::groups::handle_delete_group(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            store_and_broadcast_if_ok(state, broadcast_tx, &result, event).await;
            return result;
        }
        5 => {
            // SECURITY (audit 2026-10): on a restricted relay a kind 5 is
            // only accepted when it deletes something this relay holds for
            // the sender — otherwise a stranger could store unlimited "deletions"
            // of ids that never existed here (the general hosted-only guard
            // below never ran for kind 5).
            if state.hosted_only && !hosted_deletion_allowed(state, &event).await {
                return vec![hosted_only_rejection(&event)];
            }
            let result = match crate::nostr::nip29::moderation::handle_deletion(&state.pool, &event).await {
                Ok(outcome) => outcome.frames,
                Err(e) => vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)],
            };
            // Store the deletion event itself for history
            store_and_broadcast_if_ok(state, broadcast_tx, &result, event).await;
            return result;
        }
        9005 => {
            let result =
                crate::nostr::nip29::moderation::handle_delete_event(&state.pool, &event)
                    .await
                    .unwrap_or_else(|e| {
                        vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]
                    });
            store_and_broadcast_if_ok(state, broadcast_tx, &result, event).await;
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
            store_and_broadcast_if_ok(state, broadcast_tx, &result, event).await;
            republish_metadata_if_ok(state, broadcast_tx, &result, group_id).await;
            return result;
        }
        // NIP-29 management kinds the relay does not implement (edit status,
        // add/remove permission, set role, create invite). They used to fall
        // through to the regular-content path and were stored for any group
        // member; other NIP-29 clients read them as authoritative group
        // changes. Accept them from the group's admins only (audit 2026-10).
        9003 | 9004 | 9006 | 9009 | 9020 => {
            let authorized = match event.get_tag_value("h") {
                Some(gid) => state.pool.is_admin(&gid, &event.pubkey).await.unwrap_or(false),
                None => false,
            };
            if !authorized {
                return vec![format!(
                    r#"["OK","{}",false,"restricted: not authorized"]"#,
                    event.id
                )];
            }
            // An admin's event is stored like regular group content below.
        }
        9022 => {
            let group_id = event.get_tag_value("h");
            // SECURITY (audit 2026-10): on a restricted relay only a current
            // member of a hosted group has a leave to record; anything else
            // was a free stored event for a stranger.
            if state.hosted_only {
                let is_member = match &group_id {
                    Some(gid) => state.pool.group_has_member(gid, &event.pubkey).await.unwrap_or(false),
                    None => false,
                };
                if !is_member {
                    return vec![hosted_only_rejection(&event)];
                }
            }
            let result = crate::nostr::nip29::membership::handle_leave(&state.pool, &event)
                .await
                .unwrap_or_else(|e| vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]);
            store_and_broadcast_if_ok(state, broadcast_tx, &result, event).await;
            republish_metadata_if_ok(state, broadcast_tx, &result, group_id).await;
            return result;
        }
        _ => {}
    }

    // Distinct h tags, in tag order. Multi-space events (music) may list
    // several; each is resolved once below.
    let h_tags = distinct_h_tags(&event);

    // Cap BEFORE any per-tag DB work: both the hosted-only check below and the
    // membership gate do one lookup per distinct h tag, so an event carrying
    // hundreds of them would otherwise fan out that many queries before being
    // rejected. The pure gate applies the same cap for its unit tests.
    if h_tags.len() > crate::nostr::membership_gate::MAX_H_TAGS {
        tracing::info!(
            pubkey = log_prefix(&event.pubkey),
            h_tags = h_tags.len(),
            kind = event.kind,
            "Rejected publish: too many h tags",
        );
        return vec![format!(
            r#"["OK","{}",false,"invalid: too many h tags"]"#,
            event.id
        )];
    }

    // SECURITY: a restricted relay (embedded/personal, possibly publicly
    // tunneled) is NOT a general-purpose relay — it only stores content for the
    // NIP-29 groups it hosts. Reject any regular event that isn't h-tagged to an
    // existing group (any of its h tags will do), so a stranger can't fill the
    // host's disk with arbitrary events (open-relay abuse).
    if state.hosted_only && !names_hosted_group(state, &h_tags).await {
        return vec![hosted_only_rejection(&event)];
    }

    // Publish-side membership gate. NIP-29 management kinds matched above and
    // returned early; everything reaching here is regular content. If it's
    // h-tagged (space-scoped) and the kind is subject to the gate, we must
    // verify the author is a current member of EVERY listed space the relay
    // resolves (`app.space_members` ∪ `relay.group_members`) — otherwise a
    // kicked user keeps posting via the same WebSocket (the per-connection
    // membership cache is read-side only and stale post-kick), or shares a
    // track into a space they are not in.
    if !h_tags.is_empty()
        && crate::nostr::membership_gate::requires_h_membership_check(event.kind)
    {
        // Resolve each distinct id once (at most MAX_H_TAGS — enforced above).
        let mut statuses: Vec<SpaceMembership> = Vec::with_capacity(h_tags.len());
        for h in &h_tags {
            let status = state.pool.space_membership(h, &event.pubkey)
                .await
                .unwrap_or_else(|e| {
                    // Fail closed: a DB error during the gate check rejects
                    // the publish rather than leaking it past the kick.
                    tracing::error!(
                        error = %e,
                        space_id = %h,
                        pubkey = log_prefix(&event.pubkey),
                        "Membership lookup failed; rejecting publish",
                    );
                    SpaceMembership::NonMember
                });
            statuses.push(status);
        }
        if let PublishVerdict::Reject(reason) = evaluate_publish_gate(&event, &statuses) {
            // Name the space that failed the check (first NonMember, else the
            // first id) so the log says which membership was missing.
            let offending = statuses
                .iter()
                .position(|s| *s == SpaceMembership::NonMember)
                .and_then(|i| h_tags.get(i))
                .or_else(|| h_tags.first())
                .map(String::as_str)
                .unwrap_or("");
            tracing::info!(
                pubkey = log_prefix(&event.pubkey),
                space_id = %offending,
                h_tags = h_tags.len(),
                kind = event.kind,
                reason,
                "Rejected publish: membership gate",
            );
            return vec![format!(
                r#"["OK","{}",false,"{}"]"#,
                event.id, reason
            )];
        }
    }

    // NIP-01 ephemeral kinds (20000–29999) are relayed to live subscribers
    // but never persisted: they are refetch hints (kind 20900 space-config
    // nudges, typing/presence style signals), not history, and would only
    // bloat `relay.events` for REQs that must never return them anyway.
    if event.is_ephemeral() {
        tracing::debug!(
            event_id = log_prefix(&event.id),
            kind = event.kind,
            pubkey = log_prefix(&event.pubkey),
            "Ephemeral event broadcast (not stored)"
        );
        let id = event.id.clone();
        let _ = broadcast_tx.send(event);
        return vec![format!(r#"["OK","{}",true,""]"#, id)];
    }

    // Store regular events
    match state.pool.store_event_flagged(&event, self_published).await {
        Ok(true) => {
            tracing::debug!(
                event_id = log_prefix(&event.id),
                kind = event.kind,
                pubkey = log_prefix(&event.pubkey),
                "Event stored"
            );
            let _ = broadcast_tx.send(event.clone());
            vec![format!(r#"["OK","{}",true,""]"#, event.id)]
        }
        Ok(false) => {
            tracing::trace!(event_id = log_prefix(&event.id), "Duplicate event");
            vec![format!(r#"["OK","{}",true,"duplicate:"]"#, event.id)]
        }
        Err(e) => {
            tracing::error!(
                event_id = log_prefix(&event.id),
                kind = event.kind,
                error = %e,
                "Failed to store event"
            );
            vec![format!(r#"["OK","{}",false,"error: {e}"]"#, event.id)]
        }
    }
}

/// The `OK false` frame for a kind-1059 the intake gate refuses, or `None`
/// when the event is to be stored (every non-wrap, gate off, embedded relay,
/// a recipient with a qualifying list here, a self-wrap, or `warn` mode —
/// which logs and counts the would-be refusal instead). One list lookup per
/// wrap, never per recipient; none at all for a self-wrap or an over-cap
/// wrap. Like the moderation gate, `enforce` fails closed on a lookup error;
/// `warn` keeps accepting.
async fn wrap_intake_refusal(state: &Arc<AppState>, event: &Event, authed: Option<&str>) -> Option<String> {
    let gate = state.config.wrap_intake_gate;
    if !wrap_gate::intake_needs_dm_relay_lookup(gate, event, authed) {
        return None;
    }
    let recipients = wrap_gate::wrap_recipients(event);
    let lists = if recipients.is_empty() || recipients.len() > wrap_gate::MAX_WRAP_RECIPIENTS {
        // Settled from the event alone; no lookup.
        Vec::new()
    } else {
        match state.pool.relay_lists_for(&recipients).await {
            Ok(Some(lists)) => lists,
            // A backend without an intake gate (embedded SQLite): the
            // personal relay's own write policy applies instead.
            Ok(None) => return None,
            Err(e) => {
                tracing::error!(error = %e, event_id = log_prefix(&event.id), "Relay list lookup failed");
                if gate == WrapIntakeGate::Enforce {
                    return Some(format!(
                        r#"["OK","{}",false,"error: could not check DM relay lists"]"#,
                        event.id
                    ));
                }
                return None;
            }
        }
    };
    let own_urls = state.auth_relay_urls.read().unwrap_or_else(|e| e.into_inner()).clone();
    let recipient = recipients.first().map(|p| log_prefix(p)).unwrap_or_default();
    match wrap_gate::wrap_intake(gate, event, authed, &lists, &own_urls) {
        WrapIntake::Store => None,
        WrapIntake::StoreAndLog(why) => {
            state.metrics.wrap_intake_would_refuse.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            tracing::info!(
                event_id = log_prefix(&event.id),
                recipient,
                recipients = recipients.len(),
                reason = why.label(),
                "wrap intake (warn): enforce would refuse this kind 1059"
            );
            None
        }
        WrapIntake::Refuse(why) => {
            state.metrics.wrap_intake_refused.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            tracing::info!(
                event_id = log_prefix(&event.id),
                recipient,
                recipients = recipients.len(),
                reason = why.label(),
                "Rejected publish: wrap intake"
            );
            Some(format!(r#"["OK","{}",false,"{}"]"#, event.id, why.message()))
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

    // NIP-01: a REQ may carry MULTIPLE filters (msg[2..]); an event matches the
    // subscription if it matches ANY of them. Previously only the first was honored
    // (#19), silently dropping the rest.
    const MAX_FILTERS: usize = 16;
    let raw = msg.as_array().map(|a| &a[2..]);
    let filters: Vec<Filter> = match raw {
        Some(items) if !items.is_empty() => {
            if items.len() > MAX_FILTERS {
                return vec![format!(r#"["CLOSED","{}","invalid: too many filters"]"#, sub_id)];
            }
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                match serde_json::from_value::<Filter>(item.clone()) {
                    Ok(f) => out.push(f),
                    Err(_) => return vec![r#"["NOTICE","invalid filter"]"#.to_string()],
                }
            }
            out
        }
        _ => return vec![r#"["NOTICE","invalid filter"]"#.to_string()],
    };

    // NIP-42: an anonymous client REQ-ing a private group gets an explicit
    // `auth-required` CLOSED so it knows to AUTH and retry (rather than a silent
    // empty EOSE). Members / public groups are unaffected. Check the union of all
    // filters' h_tags.
    if authed_pubkey.is_none() {
        let h_union: Vec<String> = filters.iter().flat_map(|f| f.h_tags.clone()).collect();
        if !h_union.is_empty() && state.pool.any_private(&h_union).await.unwrap_or(false) {
            return vec![format!(
                r#"["CLOSED","{}","auth-required: this group requires authentication"]"#,
                sub_id
            )];
        }
    }

    // NIP-17: gift wraps are served only to their authenticated recipient
    // (docs/DM_WIRE_CONTRACT.md §7.1). An anonymous REQ that explicitly asks
    // for kind 1059 gets an `auth-required` CLOSED so the client AUTHs and
    // retries; in `warn` mode we serve as before and log the would-be denial.
    if authed_pubkey.is_none() && wrap_gate::filters_want_wraps(&filters) {
        match state.config.wrap_auth_gate {
            WrapAuthGate::Enforce => {
                return vec![format!(
                    r#"["CLOSED","{}","auth-required: gift wraps are served only to their recipient"]"#,
                    sub_id
                )];
            }
            WrapAuthGate::Warn => {
                tracing::info!(sub_id, "wrap gate (warn): anonymous REQ for kind 1059 would be denied");
            }
            WrapAuthGate::Off => {}
        }
    }

    // NIP-56: a report names its reporter, so it is served only to its author
    // (or the ingest role). An anonymous REQ that explicitly asks for kind
    // 1984 is told to AUTH; one that merely could match gets them excluded.
    if authed_pubkey.is_none()
        && state.config.report_read_gate
        && report_gate::filters_want_reports(&filters)
    {
        return vec![format!(
            r#"["CLOSED","{}","auth-required: reports are served only to their author"]"#,
            sub_id
        )];
    }
    let ctx = read_ctx(state, authed_pubkey);

    // A store that cannot answer (pool exhausted, query error) is told to the
    // client as CLOSED — never as an empty EOSE. Both clients stamp their
    // since-watermark on EOSE, so a silent empty answer would put the whole
    // undelivered backlog outside their next catch-up window. The sub is not
    // registered either, and an earlier one under the same id (this REQ was
    // meant to replace it) stops too: the client was told it is closed and
    // will re-REQ.
    let merged = match query_merged(state, &filters, &ctx).await {
        Ok(events) => events,
        Err(e) => {
            tracing::warn!(
                sub_id,
                filters = filters.len(),
                error = %e,
                "REQ query failed; CLOSED instead of EOSE"
            );
            subscriptions.lock().await.remove(&sub_id);
            return vec![closed_frame(&sub_id, "error: query failed")];
        }
    };

    tracing::debug!(sub_id, filters = filters.len(), results = merged.len(), "REQ");

    // Register the subscription (all filters) for live events.
    {
        let mut subs = subscriptions.lock().await;
        if let Err(msg) = subs.add(sub_id.clone(), filters) {
            return vec![format!(r#"["CLOSED","{}","error: {}"]"#, sub_id, msg)];
        }
    }

    let mut responses: Vec<String> = merged
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

/// `["CLOSED", <subId>, <reason>]`, JSON-escaped (a sub id is client text).
pub fn closed_frame(sub_id: &str, reason: &str) -> String {
    serde_json::json!(["CLOSED", sub_id, reason]).to_string()
}

/// Run the stored query for every filter of a subscription and merge the
/// results by id, newest first. Fails on the FIRST filter whose query fails:
/// a partial answer followed by EOSE would read as "backlog delivered".
async fn query_merged(
    state: &Arc<AppState>,
    filters: &[Filter],
    ctx: &ReadCtx<'_>,
) -> anyhow::Result<Vec<Event>> {
    let mut seen = HashSet::new();
    let mut merged: Vec<Event> = Vec::new();
    for filter in filters {
        for e in state.pool.query_events_ctx(filter, ctx).await? {
            if seen.insert(e.id.clone()) {
                merged.push(e);
            }
        }
    }
    merged.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(merged)
}

/// Clock-skew margin (seconds) subtracted from the lag window start: an event
/// is stored (its `first_seen` stamped) a moment before it is broadcast.
const RESYNC_MARGIN_SECS: i64 = 5;

/// The resync shape of one client filter: the same filter restricted to rows
/// the relay first stored since `missed_since` (server time, so a NIP-59
/// backdated `created_at` cannot escape it). For a filter that can match kind
/// 1059 the client's `since` is dropped, mirroring the live rule
/// (`Filter::matches` ignores `since` for wraps) — otherwise a wrap backdated
/// below a near-"now" `since` would be lost by the lag the resync repairs.
pub fn resync_filter(filter: &Filter, missed_since: i64) -> Filter {
    let mut f = filter.clone();
    f.first_seen_since = Some(missed_since - RESYNC_MARGIN_SECS);
    if f.kinds.is_empty() || f.kinds.contains(&wrap_gate::KIND_GIFT_WRAP) {
        f.since = None;
    }
    f
}

/// Re-run every open subscription of a connection whose broadcast receiver
/// lagged, over the window it missed (`missed_since`, unix seconds: when it
/// last kept up), and return the EVENT frames to send (no EOSE: these
/// subscriptions already had theirs). Clients dedupe by id. Ephemeral kinds
/// are not stored, so a lag can still lose those — they are refetch hints,
/// not history. A subscription whose query fails is skipped (logged); it is
/// not closed, since live matching for it still works.
pub async fn resync_subscriptions(
    state: &Arc<AppState>,
    subscriptions: &Arc<Mutex<SubscriptionManager>>,
    authed_pubkey: &Option<String>,
    missed_since: i64,
) -> Vec<String> {
    let ctx = read_ctx(state, authed_pubkey);
    let snapshot = subscriptions.lock().await.snapshot();
    let mut frames = Vec::new();
    for (sub_id, filters) in snapshot {
        let filters: Vec<Filter> = filters.iter().map(|f| resync_filter(f, missed_since)).collect();
        match query_merged(state, &filters, &ctx).await {
            Ok(events) => {
                for e in events {
                    frames.push(format!(
                        r#"["EVENT","{}",{}]"#,
                        sub_id,
                        serde_json::to_string(&e).unwrap_or_default()
                    ));
                }
            }
            Err(e) => {
                tracing::warn!(sub_id, filters = filters.len(), error = %e, "Resync query failed; subscription skipped");
            }
        }
    }
    frames
}

/// `["NEG-OPEN", <subId>, <filter>, <initialMessageHex>]` → the relay builds a
/// sealed (created_at, id) vector for everything the filter matches under the
/// connection's read context, answers the initiator's first frame and keeps
/// the vector for follow-up NEG-MSGs.
async fn handle_neg_open(
    msg: serde_json::Value,
    state: &Arc<AppState>,
    subscriptions: &Arc<Mutex<SubscriptionManager>>,
    authed_pubkey: &Option<String>,
) -> Vec<String> {
    let sub_id = match msg.get(1).and_then(|v| v.as_str()) {
        Some(id) if !id.is_empty() && id.len() <= 64 => id.to_string(),
        _ => return vec![r#"["NOTICE","NEG-OPEN: missing subscription ID"]"#.to_string()],
    };
    let filter: Filter = match msg.get(2).cloned().map(serde_json::from_value) {
        Some(Ok(f)) => f,
        _ => return vec![format!(r#"["NEG-ERR","{}","error: invalid filter"]"#, sub_id)],
    };
    let initial = match msg.get(3).and_then(|v| v.as_str()).map(hex::decode) {
        Some(Ok(bytes)) if !bytes.is_empty() => bytes,
        _ => return vec![format!(r#"["NEG-ERR","{}","error: invalid initial message"]"#, sub_id)],
    };

    if authed_pubkey.is_none()
        && wrap_gate::filters_want_wraps(std::slice::from_ref(&filter))
        && state.config.wrap_auth_gate == WrapAuthGate::Enforce
    {
        return vec![format!(
            r#"["NEG-ERR","{}","blocked: auth-required: gift wraps are served only to their recipient"]"#,
            sub_id
        )];
    }
    if authed_pubkey.is_none()
        && state.config.report_read_gate
        && report_gate::filters_want_reports(std::slice::from_ref(&filter))
    {
        return vec![format!(
            r#"["NEG-ERR","{}","blocked: auth-required: reports are served only to their author"]"#,
            sub_id
        )];
    }

    let ctx = read_ctx(state, authed_pubkey);
    let max = crate::db::event_store::MAX_NEG_IDS;
    let rows = match state.pool.query_event_ids(&filter, &ctx, max).await {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(sub_id, error = %e, "NEG-OPEN query failed");
            return vec![format!(r#"["NEG-ERR","{}","error: query failed"]"#, sub_id)];
        }
    };
    if rows.len() as i64 > max {
        return vec![format!(r#"["NEG-ERR","{}","blocked: too many records"]"#, sub_id)];
    }

    let mut storage = negentropy::NegentropyStorageVector::with_capacity(rows.len());
    for (created_at, id) in &rows {
        let Ok(bytes) = hex::decode(id) else { continue };
        let Ok(id) = negentropy::Id::from_slice(&bytes) else { continue };
        if storage.insert((*created_at).max(0) as u64, id).is_err() {
            return vec![format!(r#"["NEG-ERR","{}","error: storage"]"#, sub_id)];
        }
    }
    if storage.seal().is_err() {
        return vec![format!(r#"["NEG-ERR","{}","error: storage"]"#, sub_id)];
    }

    let response = match reconcile_frame(&storage, &initial) {
        Ok(bytes) => bytes,
        Err(reason) => return vec![format!(r#"["NEG-ERR","{}","error: {reason}"]"#, sub_id)],
    };

    {
        let mut subs = subscriptions.lock().await;
        if let Err(msg) = subs.neg_open(sub_id.clone(), storage) {
            return vec![format!(r#"["NEG-ERR","{}","blocked: {}"]"#, sub_id, msg)];
        }
    }
    tracing::debug!(sub_id, records = rows.len(), "NEG-OPEN");
    vec![format!(r#"["NEG-MSG","{}","{}"]"#, sub_id, hex::encode(response))]
}

/// `["NEG-MSG", <subId>, <hex>]` from the initiator → one reconciliation round.
async fn handle_neg_msg(
    msg: serde_json::Value,
    subscriptions: &Arc<Mutex<SubscriptionManager>>,
) -> Vec<String> {
    let sub_id = match msg.get(1).and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return vec![r#"["NOTICE","NEG-MSG: missing subscription ID"]"#.to_string()],
    };
    let query = match msg.get(2).and_then(|v| v.as_str()).map(hex::decode) {
        Some(Ok(bytes)) if !bytes.is_empty() => bytes,
        _ => return vec![format!(r#"["NEG-ERR","{}","error: invalid message"]"#, sub_id)],
    };
    let subs = subscriptions.lock().await;
    let Some(storage) = subs.neg_get(&sub_id) else {
        return vec![format!(r#"["NEG-ERR","{}","closed: no such session"]"#, sub_id)];
    };
    match reconcile_frame(storage, &query) {
        Ok(bytes) => vec![format!(r#"["NEG-MSG","{}","{}"]"#, sub_id, hex::encode(bytes))],
        Err(reason) => vec![format!(r#"["NEG-ERR","{}","error: {reason}"]"#, sub_id)],
    }
}

async fn handle_neg_close(
    msg: serde_json::Value,
    subscriptions: &Arc<Mutex<SubscriptionManager>>,
) -> Vec<String> {
    if let Some(sub_id) = msg.get(1).and_then(|v| v.as_str()) {
        subscriptions.lock().await.neg_close(sub_id);
    }
    vec![]
}

/// Run one relay-side reconciliation round over a sealed storage vector. The
/// crate keeps no cross-frame state on the responder (timestamps reset per
/// frame), so a fresh `Negentropy` per frame is correct.
fn reconcile_frame(
    storage: &negentropy::NegentropyStorageVector,
    query: &[u8],
) -> Result<Vec<u8>, String> {
    let mut neg = negentropy::Negentropy::borrowed(storage, NEG_FRAME_SIZE_LIMIT)
        .map_err(|e| e.to_string())?;
    neg.reconcile(query).map_err(|e| e.to_string())
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

    // The `relay` tag must name one of this relay's own addresses. A personal
    // (hosted_only) relay is reachable via several (loopback/LAN/tunnel), so
    // the set holds all of them — it is never "any URL" (security audit
    // 2026-10: that allowed challenge forwarding from a hostile relay).
    let allowed_relay_urls = state
        .auth_relay_urls
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    if !crate::protocol::nip42::verify_auth_event(&event, challenge, &allowed_relay_urls, now) {
        tracing::debug!(
            event_id = log_prefix(&event.id),
            "AUTH failed: invalid challenge/relay/signature"
        );
        return vec![format!(
            r#"["OK","{}",false,"auth-required: verification failed"]"#,
            event.id
        )];
    }

    tracing::info!(
        pubkey = log_prefix(&event.pubkey),
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
                pubkey = log_prefix(&event.pubkey),
                space_count = set.len(),
                "Loaded space memberships for broadcast filter"
            );
            *space_memberships = set;
        }
        Err(e) => {
            tracing::warn!(
                pubkey = log_prefix(&event.pubkey),
                error = %e,
                "Failed to load space memberships (h-tagged broadcasts will be hidden until reconnect)"
            );
        }
    }

    vec![format!(r#"["OK","{}",true,""]"#, event.id)]
}

#[cfg(test)]
mod resync_tests {
    use super::*;

    /// The resync keeps the client's filter but pins it to the missed window
    /// by server receipt time; a filter that can match wraps drops `since`
    /// (as live matching does), one that cannot keeps it.
    #[test]
    fn resync_filter_pins_first_seen_and_mirrors_live_since_rule() {
        let inbox = Filter { kinds: vec![1059], since: Some(1_000_000), limit: Some(500), ..Default::default() };
        let r = resync_filter(&inbox, 2_000_000);
        assert_eq!(r.first_seen_since, Some(2_000_000 - RESYNC_MARGIN_SECS));
        assert_eq!(r.since, None, "backdated wraps must be recoverable");
        assert_eq!(r.limit, Some(500));

        let feed = Filter { kinds: vec![1, 9], since: Some(1_000_000), ..Default::default() };
        let r = resync_filter(&feed, 2_000_000);
        assert_eq!(r.since, Some(1_000_000), "non-wrap kinds keep the client's since");
        assert_eq!(r.first_seen_since, Some(2_000_000 - RESYNC_MARGIN_SECS));

        let any = Filter { since: Some(1_000_000), ..Default::default() };
        assert_eq!(resync_filter(&any, 2_000_000).since, None, "no kinds = may match wraps");
    }
}
