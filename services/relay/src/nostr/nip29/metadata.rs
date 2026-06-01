use tokio::sync::broadcast;

use crate::db::Db;
use crate::nostr::event::Event;
use crate::relay_identity::RelayIdentity;

/// Build the tags + content for a kind:39000 group metadata event.
async fn build_group_metadata(
    db: &Db,
    group_id: &str,
) -> anyhow::Result<Option<(Vec<Vec<String>>, String)>> {
    let (name, picture, about, is_private, is_closed) = match db.get_group_metadata(group_id).await? {
        Some(r) => r,
        None => return Ok(None),
    };

    let mut tags = vec![vec!["d".to_string(), group_id.to_string()]];
    // NIP-29 metadata advertises group policy via marker tags.
    tags.push(vec![
        if is_private { "private" } else { "public" }.to_string(),
    ]);
    tags.push(vec![
        if is_closed { "closed" } else { "open" }.to_string(),
    ]);
    tags.push(vec!["name".to_string(), name.clone()]);
    if let Some(p) = &picture {
        tags.push(vec!["picture".to_string(), p.clone()]);
    }
    if let Some(a) = &about {
        tags.push(vec!["about".to_string(), a.clone()]);
    }

    // Content mirrors the human-readable metadata for clients that read it there.
    let content = serde_json::json!({
        "name": name,
        "picture": picture,
        "about": about,
    })
    .to_string();

    Ok(Some((tags, content)))
}

/// Build the tags for a kind:39001 group admins event.
async fn build_group_admins(db: &Db, group_id: &str) -> anyhow::Result<(Vec<Vec<String>>, String)> {
    let admins = db.get_group_admins(group_id).await?;
    let mut tags = vec![vec!["d".to_string(), group_id.to_string()]];
    for pubkey in &admins {
        tags.push(vec!["p".to_string(), pubkey.clone(), "admin".to_string()]);
    }
    Ok((tags, String::new()))
}

/// Build the tags for a kind:39002 group members event.
async fn build_group_members(db: &Db, group_id: &str) -> anyhow::Result<(Vec<Vec<String>>, String)> {
    let members = db.get_members(group_id).await?;
    let mut tags = vec![vec!["d".to_string(), group_id.to_string()]];
    for pubkey in &members {
        tags.push(vec!["p".to_string(), pubkey.clone()]);
    }
    Ok((tags, String::new()))
}

/// Sign one metadata event with the relay identity, store it (replacing the
/// previous addressable version), and broadcast it to subscribers.
async fn sign_store_broadcast(
    db: &Db,
    identity: &RelayIdentity,
    broadcast_tx: &broadcast::Sender<Event>,
    kind: i32,
    tags: Vec<Vec<String>>,
    content: &str,
) -> anyhow::Result<()> {
    let event = identity.sign_event(kind, tags, content);

    // The relay is the SOLE author of its own metadata, so always replace the
    // prior addressable version. store_event's generic replace only fires on
    // `created_at <`, which would silently drop a same-second update (e.g. two
    // membership changes within one second) from both storage AND broadcast.
    if let Some(d) = event.get_tag_value("d") {
        let _ = db.replace_addressable(kind, &identity.pubkey, &d).await;
    }

    if db.store_event(&event).await? {
        let _ = broadcast_tx.send(event);
    }
    Ok(())
}

/// Regenerate, sign (with the relay identity), store, and broadcast the three
/// NIP-29 group state events (39000 metadata, 39001 admins, 39002 members).
///
/// Called after every state-changing NIP-29 op so that other clients
/// (0xchat / Chachi / Flotilla / Obelisk / our own) can render the group —
/// without this, the relay knows the group state but never publishes it, so
/// imported groups appear empty. Errors are logged and swallowed: failing to
/// publish metadata must not fail the underlying op (the member was still
/// added/removed in the group store).
pub async fn publish_group_metadata(
    db: &Db,
    identity: &RelayIdentity,
    broadcast_tx: &broadcast::Sender<Event>,
    group_id: &str,
) {
    match build_group_metadata(db, group_id).await {
        Ok(Some((tags, content))) => {
            if let Err(e) =
                sign_store_broadcast(db, identity, broadcast_tx, 39000, tags, &content).await
            {
                tracing::warn!(group_id, error = %e, "Failed to publish 39000 metadata");
            }
        }
        Ok(None) => {
            // Group no longer exists (e.g. just deleted) — nothing to publish.
            return;
        }
        Err(e) => tracing::warn!(group_id, error = %e, "Failed to build 39000 metadata"),
    }

    match build_group_admins(db, group_id).await {
        Ok((tags, content)) => {
            if let Err(e) =
                sign_store_broadcast(db, identity, broadcast_tx, 39001, tags, &content).await
            {
                tracing::warn!(group_id, error = %e, "Failed to publish 39001 admins");
            }
        }
        Err(e) => tracing::warn!(group_id, error = %e, "Failed to build 39001 admins"),
    }

    match build_group_members(db, group_id).await {
        Ok((tags, content)) => {
            if let Err(e) =
                sign_store_broadcast(db, identity, broadcast_tx, 39002, tags, &content).await
            {
                tracing::warn!(group_id, error = %e, "Failed to publish 39002 members");
            }
        }
        Err(e) => tracing::warn!(group_id, error = %e, "Failed to build 39002 members"),
    }
}
