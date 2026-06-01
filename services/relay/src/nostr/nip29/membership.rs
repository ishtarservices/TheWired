use crate::db::Db;
use crate::nostr::event::Event;

/// Handle kind:9021 -- Join request
pub async fn handle_join_request(db: &Db, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    // For open groups, auto-approve; closed groups defer to an admin.
    match db.group_is_closed(&group_id).await? {
        Some(false) => {
            // Open group: auto-add member
            db.add_member(&group_id, &event.pubkey).await?;
            tracing::info!("{} joined group {}", event.pubkey, group_id);
            Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
        }
        Some(true) => {
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
pub async fn handle_leave(db: &Db, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    db.remove_member(&group_id, &event.pubkey).await?;
    tracing::info!("{} left group {}", event.pubkey, group_id);
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}
