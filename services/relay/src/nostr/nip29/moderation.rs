use crate::db::Db;
use crate::nostr::event::Event;

/// Handle kind:9000 -- Put user (add to group)
pub async fn handle_put_user(db: &Db, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    if !db.is_admin(&group_id, &event.pubkey).await? {
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
        db.add_member(&group_id, pubkey).await?;
    }

    tracing::info!("Added {} members to group {}", targets.len(), group_id);
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}

/// Handle kind:9001 -- Remove user (kick from group)
pub async fn handle_remove_user(db: &Db, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    if !db.is_admin(&group_id, &event.pubkey).await? {
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
        db.remove_member(&group_id, pubkey).await?;
    }

    tracing::info!("Removed {} members from group {}", targets.len(), group_id);
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}

/// Handle kind:5 -- NIP-09 deletion (author deletes own events)
pub async fn handle_deletion(db: &Db, event: &Event) -> anyhow::Result<Vec<String>> {
    let mut deleted = 0u32;
    for tag in &event.tags {
        let tag_name = tag.first().map(|s| s.as_str());

        if tag_name == Some("e") {
            if let Some(target_id) = tag.get(1) {
                // Verify the target event is authored by the deletion sender
                if let Ok(Some(target)) = db.get_event_by_id(target_id).await {
                    if target.pubkey == event.pubkey {
                        if db.delete_event(target_id).await.unwrap_or(false) {
                            deleted += 1;
                        }
                    }
                }
            }
        }

        // NIP-09: "a" tags delete addressable events by kind:pubkey:d-tag.
        // Only delete events created before the deletion event (newer versions
        // supersede the deletion).
        if tag_name == Some("a") {
            if let Some(addr) = tag.get(1) {
                let parts: Vec<&str> = addr.splitn(3, ':').collect();
                if parts.len() >= 3 {
                    let kind_str = parts[0];
                    let addr_pubkey = parts[1];
                    let d_tag = parts[2];
                    // Only honor deletions from the content author
                    if addr_pubkey == event.pubkey {
                        if let Ok(kind) = kind_str.parse::<i32>() {
                            match db
                                .delete_addressable_upto(kind, addr_pubkey, d_tag, event.created_at)
                                .await
                            {
                                Ok(n) => deleted += n as u32,
                                Err(e) => tracing::error!(addr, error = %e, "Failed to delete addressable event"),
                            }
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
pub async fn handle_delete_event(db: &Db, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    // Verify the sender is an admin of the group
    if !db.is_admin(&group_id, &event.pubkey).await? {
        return Ok(vec![format!(
            r#"["OK","{}",false,"not authorized"]"#,
            event.id
        )]);
    }

    let mut deleted = 0u32;
    for tag in &event.tags {
        if tag.first().map(|s| s.as_str()) == Some("e") {
            if let Some(target_id) = tag.get(1) {
                if db.delete_event(target_id).await.unwrap_or(false) {
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
