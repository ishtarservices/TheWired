use sqlx::PgPool;

use crate::db::event_store;
use crate::nostr::event::Event;

/// Handle kind:9000 -- Put user (add to group)
pub async fn handle_put_user(pool: &PgPool, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    if !crate::db::group_store::is_admin(pool, &group_id, &event.pubkey).await? {
        return Ok(vec![format!(
            r#"["OK","{}",false,"not authorized"]"#,
            event.id
        )]);
    }

    // Get target pubkeys from p tags
    let targets: Vec<String> = event
        .tags
        .iter()
        .filter(|t| t.first().map(|s| s.as_str()) == Some("p"))
        .filter_map(|t| t.get(1).cloned())
        .collect();

    for pubkey in &targets {
        crate::db::group_store::add_member(pool, &group_id, pubkey).await?;
    }

    tracing::info!("Added {} members to group {}", targets.len(), group_id);
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}

/// Handle kind:9001 -- Remove user (kick from group)
pub async fn handle_remove_user(pool: &PgPool, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    if !crate::db::group_store::is_admin(pool, &group_id, &event.pubkey).await? {
        return Ok(vec![format!(
            r#"["OK","{}",false,"not authorized"]"#,
            event.id
        )]);
    }

    let targets: Vec<String> = event
        .tags
        .iter()
        .filter(|t| t.first().map(|s| s.as_str()) == Some("p"))
        .filter_map(|t| t.get(1).cloned())
        .collect();

    for pubkey in &targets {
        crate::db::group_store::remove_member(pool, &group_id, pubkey).await?;
    }

    tracing::info!("Removed {} members from group {}", targets.len(), group_id);
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}

/// Handle kind:5 -- NIP-09 deletion (author deletes own events)
pub async fn handle_deletion(pool: &PgPool, event: &Event) -> anyhow::Result<Vec<String>> {
    let mut deleted = 0u32;
    for tag in &event.tags {
        if tag.first().map(|s| s.as_str()) == Some("e") {
            if let Some(target_id) = tag.get(1) {
                // Verify the target event is authored by the deletion sender
                if let Ok(Some(target)) = event_store::get_event_by_id(pool, target_id).await {
                    if target.pubkey == event.pubkey {
                        if event_store::delete_event(pool, target_id).await.unwrap_or(false) {
                            deleted += 1;
                        }
                    }
                }
            }
        }
    }
    tracing::info!(pubkey = &event.pubkey[..12], deleted, "NIP-09 deletion");
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}

/// Handle kind:9005 -- NIP-29 moderator deletion (admin deletes events from group)
pub async fn handle_delete_event(pool: &PgPool, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    // Verify the sender is an admin of the group
    if !crate::db::group_store::is_admin(pool, &group_id, &event.pubkey).await? {
        return Ok(vec![format!(
            r#"["OK","{}",false,"not authorized"]"#,
            event.id
        )]);
    }

    let mut deleted = 0u32;
    for tag in &event.tags {
        if tag.first().map(|s| s.as_str()) == Some("e") {
            if let Some(target_id) = tag.get(1) {
                if event_store::delete_event(pool, target_id).await.unwrap_or(false) {
                    deleted += 1;
                }
            }
        }
    }

    tracing::info!(
        group_id,
        admin = &event.pubkey[..12],
        deleted,
        "NIP-29 mod deletion"
    );
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}
