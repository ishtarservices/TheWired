use crate::db::Db;
use crate::nostr::event::Event;

/// Handle kind:9007 -- Create group
pub async fn handle_create_group(db: &Db, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = event
        .get_tag_value("h")
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // SECURITY: refuse to create a relay-native group whose id collides with a
    // backend-authoritative (platform / A-lite) space. Membership is resolved as
    // `app.space_members ∪ relay.group_members`, so without this guard a caller
    // who learns a platform space's id could 9007-create a same-id relay group,
    // become its admin, and gain read/write access to that backend space. The
    // embedded SQLite relay has no platform spaces, so this is always false there.
    if db.platform_space_exists(&group_id).await? {
        return Ok(vec![format!(
            r#"["OK","{}",false,"error: group id is reserved"]"#,
            event.id
        )]);
    }

    let name = event.content.clone();

    db.create_group(&group_id, &name, &event.pubkey).await?;

    // Apply NIP-29 policy marker tags from the create event (private = members-only
    // read, closed = join requires invite/approval).
    let is_private = event.tags.iter().any(|t| t.first().map(|s| s.as_str()) == Some("private"));
    let is_closed = event.tags.iter().any(|t| t.first().map(|s| s.as_str()) == Some("closed"));
    if is_private || is_closed {
        db.set_group_flags(&group_id, is_private, is_closed).await?;
    }

    tracing::info!("Group created: {} by {}", group_id, event.pubkey);
    Ok(vec![format!(
        r#"["OK","{}",true,""]"#,
        event.id
    )])
}

/// Handle kind:9002 -- Edit group metadata (admin only). Reads `name`/`picture`/
/// `about` tags and updates the group; the caller then republishes 39000.
pub async fn handle_edit_metadata(db: &Db, event: &Event) -> anyhow::Result<Vec<String>> {
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

    // Only present tags update their column (COALESCE keeps the existing value),
    // so a partial edit never wipes name/picture/about.
    let name = event.get_tag_value("name");
    let picture = event.get_tag_value("picture");
    let about = event.get_tag_value("about");

    db.edit_group_metadata(&group_id, name.as_deref(), picture.as_deref(), about.as_deref())
        .await?;

    tracing::info!("Group metadata edited: {} by {}", group_id, event.pubkey);
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}

/// Handle kind:9008 -- Delete group (admin only)
pub async fn handle_delete_group(db: &Db, event: &Event) -> anyhow::Result<Vec<String>> {
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

    db.delete_group(&group_id).await?;

    tracing::info!("Group deleted: {} by {}", group_id, event.pubkey);
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}
