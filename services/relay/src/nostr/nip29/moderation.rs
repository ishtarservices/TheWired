use sqlx::PgPool;

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
