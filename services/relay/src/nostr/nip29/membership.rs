use sqlx::PgPool;

use crate::nostr::event::Event;

/// Handle kind:9021 -- Join request
pub async fn handle_join_request(pool: &PgPool, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    // For open groups, auto-approve
    let row: Option<(bool,)> = sqlx::query_as(
        "SELECT is_closed FROM relay.groups WHERE group_id = $1",
    )
    .bind(&group_id)
    .fetch_optional(pool)
    .await?;

    match row {
        Some((false,)) => {
            // Open group: auto-add member
            crate::db::group_store::add_member(pool, &group_id, &event.pubkey).await?;
            tracing::info!("{} joined group {}", event.pubkey, group_id);
            Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
        }
        Some((true,)) => {
            // Closed group: store request, admin must approve
            Ok(vec![format!(r#"["OK","{}",true,"join request pending"]"#, event.id)])
        }
        None => Ok(vec![format!(
            r#"["OK","{}",false,"group not found"]"#,
            event.id
        )]),
    }
}

/// Handle kind:9022 -- Leave group
pub async fn handle_leave(pool: &PgPool, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    crate::db::group_store::remove_member(pool, &group_id, &event.pubkey).await?;
    tracing::info!("{} left group {}", event.pubkey, group_id);
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}
