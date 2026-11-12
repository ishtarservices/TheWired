use sqlx::PgPool;

use crate::db::event_store;
use crate::nostr::event::Event;
use crate::nostr::filter::Filter;

/// NIP-50 full-text search by bare query, visibility-gated by `authed_pubkey`
/// (#18: search was previously ungated, leaking private/group content to
/// anonymous callers). A REQ carrying `search` never comes through here: the
/// store applies the whole filter (`event_store::search_events_ctx`), so
/// `kinds` / `authors` / `#h` / `since` scope the search like any other query.
pub async fn search_events(
    pool: &PgPool,
    query: &str,
    limit: i64,
    authed_pubkey: Option<&str>,
) -> anyhow::Result<Vec<Event>> {
    let filter = Filter {
        search: Some(query.to_string()),
        limit: Some(limit),
        ..Filter::default()
    };
    event_store::query_events(pool, &filter, authed_pubkey).await
}
