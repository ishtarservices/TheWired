//! SQLite-backed event store for the embedded in-process relay (Decentralized
//! Spaces M6). Mirrors the Postgres `event_store` semantics — store with
//! replaceable/addressable handling, filter query, and NIP-50 search — but with
//! no Postgres-specific features:
//!   - `tags` is a JSON TEXT column; p/e tags live in an `event_tags` child
//!     table (indexed) instead of Postgres array columns,
//!   - NIP-50 search uses FTS5 instead of tsvector/GIN,
//!   - `= ANY($n)` becomes `IN (?, …)` via a `QueryBuilder`.
//!
//! Gated behind the `embedded` Cargo feature so the production (Postgres) relay
//! never pulls the SQLite driver.

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{QueryBuilder, Sqlite, SqlitePool};

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;

/// Hard cap on rows per query (matches the Postgres store / strfry).
const MAX_QUERY_LIMIT: i64 = 500;

/// Schema for the embedded relay. Idempotent (`IF NOT EXISTS`).
pub(crate) const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    pubkey      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    kind        INTEGER NOT NULL,
    tags        TEXT NOT NULL DEFAULT '[]',
    content     TEXT NOT NULL DEFAULT '',
    sig         TEXT NOT NULL,
    d_tag       TEXT,
    h_tag       TEXT,
    visibility  TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_pubkey_kind  ON events (pubkey, kind);
CREATE INDEX IF NOT EXISTS idx_events_htag         ON events (h_tag) WHERE h_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_created      ON events (created_at DESC);

-- Replaceable (0,3,10000-19999) and addressable (30000-39999) uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_replaceable ON events (pubkey, kind)
    WHERE (kind = 0 OR kind = 3 OR (kind >= 10000 AND kind < 20000));
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_addressable ON events (pubkey, kind, d_tag)
    WHERE (kind >= 30000 AND kind < 40000) AND d_tag IS NOT NULL;

-- p/e tag filters (Postgres array columns → child table).
CREATE TABLE IF NOT EXISTS event_tags (
    event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    tag_name  TEXT NOT NULL,
    tag_value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_tags ON event_tags (tag_name, tag_value);

-- NIP-50 full-text search (tsvector/GIN → FTS5 external-content table).
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(content, content='events', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
    INSERT INTO events_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

-- NIP-29 group state (relay-authoritative; the embedded relay owns membership).
CREATE TABLE IF NOT EXISTS groups (
    group_id   TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    picture    TEXT,
    about      TEXT,
    is_private INTEGER NOT NULL DEFAULT 0,
    is_closed  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    pubkey   TEXT NOT NULL,
    PRIMARY KEY (group_id, pubkey)
);
CREATE TABLE IF NOT EXISTS group_roles (
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    pubkey   TEXT NOT NULL,
    role     TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (group_id, pubkey, role)
);
"#;

/// Open (and create) a file-backed SQLite database at filesystem `path` and
/// apply the schema. Creates the file (and enables WAL) if missing. Use
/// [`connect_memory`] for an ephemeral in-memory db (tests).
pub async fn connect(path: &str) -> anyhow::Result<SqlitePool> {
    let opts = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
    let pool = SqlitePoolOptions::new().connect_with(opts).await?;
    sqlx::raw_sql(SCHEMA).execute(&pool).await?;
    Ok(pool)
}

/// Open a fresh in-memory database with the schema applied. Pinned to a single
/// connection so the db persists across queries (each `:memory:` connection is
/// otherwise an isolated database). For tests and ephemeral use.
pub async fn connect_memory() -> anyhow::Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::raw_sql(SCHEMA).execute(&pool).await?;
    Ok(pool)
}

fn is_replaceable(kind: i32) -> bool {
    kind == 0 || kind == 3 || (kind >= 10000 && kind < 20000)
}
fn is_addressable(kind: i32) -> bool {
    (30000..40000).contains(&kind)
}

fn tag_values<'a>(event: &'a Event, name: &str) -> Vec<&'a String> {
    event
        .tags
        .iter()
        .filter(|t| t.first().map(String::as_str) == Some(name))
        .filter_map(|t| t.get(1))
        .collect()
}

/// Store an event, replacing older replaceable/addressable versions. Returns
/// true if a new row was inserted (false on duplicate / superseded).
pub async fn store_event(pool: &SqlitePool, event: &Event) -> anyhow::Result<bool> {
    let d_tag = event.get_tag_value("d");
    let h_tag = event.get_tag_value("h");
    let visibility = event.get_tag_value("visibility");
    let tags_json = serde_json::to_string(&event.tags)?;

    let mut tx = pool.begin().await?;

    if is_replaceable(event.kind) {
        sqlx::query("DELETE FROM events WHERE pubkey = ? AND kind = ? AND created_at < ?")
            .bind(&event.pubkey)
            .bind(event.kind)
            .bind(event.created_at)
            .execute(&mut *tx)
            .await?;
    } else if is_addressable(event.kind) {
        if let Some(ref d) = d_tag {
            sqlx::query(
                "DELETE FROM events WHERE pubkey = ? AND kind = ? AND d_tag = ? AND created_at < ?",
            )
            .bind(&event.pubkey)
            .bind(event.kind)
            .bind(d)
            .bind(event.created_at)
            .execute(&mut *tx)
            .await?;
        }
    }

    let inserted = sqlx::query(
        "INSERT OR IGNORE INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag, h_tag, visibility) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&event.id)
    .bind(&event.pubkey)
    .bind(event.created_at)
    .bind(event.kind)
    .bind(&tags_json)
    .bind(&event.content)
    .bind(&event.sig)
    .bind(&d_tag)
    .bind(&h_tag)
    .bind(&visibility)
    .execute(&mut *tx)
    .await?
    .rows_affected()
        > 0;

    if inserted {
        for name in ["p", "e"] {
            for value in tag_values(event, name) {
                sqlx::query("INSERT INTO event_tags (event_id, tag_name, tag_value) VALUES (?, ?, ?)")
                    .bind(&event.id)
                    .bind(name)
                    .bind(value)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }

    tx.commit().await?;
    Ok(inserted)
}

#[derive(sqlx::FromRow)]
struct EventRow {
    id: String,
    pubkey: String,
    created_at: i64,
    kind: i32,
    tags: String,
    content: String,
    sig: String,
}

fn row_to_event(r: EventRow) -> Event {
    Event {
        id: r.id,
        pubkey: r.pubkey,
        created_at: r.created_at,
        kind: r.kind,
        tags: serde_json::from_str(&r.tags).unwrap_or_default(),
        content: r.content,
        sig: r.sig,
    }
}

/// Query events matching a filter. Mirrors the Postgres `query_events` core
/// (no auth/visibility gating — the embedded relay applies relay-native
/// membership gating separately).
pub async fn query_events(pool: &SqlitePool, filter: &Filter) -> anyhow::Result<Vec<Event>> {
    if let Some(ref q) = filter.search {
        return search_events(pool, q, filter.limit.unwrap_or(100).min(MAX_QUERY_LIMIT)).await;
    }

    let mut qb: QueryBuilder<Sqlite> =
        QueryBuilder::new("SELECT id, pubkey, created_at, kind, tags, content, sig FROM events WHERE 1 = 1");

    push_in(&mut qb, "id", &filter.ids);
    push_in(&mut qb, "pubkey", &filter.authors);
    push_in_i32(&mut qb, "kind", &filter.kinds);
    push_in(&mut qb, "h_tag", &filter.h_tags);
    push_in(&mut qb, "d_tag", &filter.d_tags);
    push_tag_subquery(&mut qb, "p", &filter.p_tags);
    push_tag_subquery(&mut qb, "e", &filter.e_tags);

    if let Some(since) = filter.since {
        qb.push(" AND created_at >= ").push_bind(since);
    }
    if let Some(until) = filter.until {
        qb.push(" AND created_at <= ").push_bind(until);
    }

    let limit = filter.limit.unwrap_or(MAX_QUERY_LIMIT).min(MAX_QUERY_LIMIT);
    qb.push(" ORDER BY created_at DESC LIMIT ").push_bind(limit);

    let rows: Vec<EventRow> = qb.build_query_as().fetch_all(pool).await?;
    Ok(rows.into_iter().map(row_to_event).collect())
}

fn push_in(qb: &mut QueryBuilder<Sqlite>, col: &str, values: &[String]) {
    if values.is_empty() {
        return;
    }
    qb.push(format!(" AND {col} IN ("));
    let mut sep = qb.separated(", ");
    for v in values {
        sep.push_bind(v.clone());
    }
    qb.push(")");
}

fn push_in_i32(qb: &mut QueryBuilder<Sqlite>, col: &str, values: &[i32]) {
    if values.is_empty() {
        return;
    }
    qb.push(format!(" AND {col} IN ("));
    let mut sep = qb.separated(", ");
    for v in values {
        sep.push_bind(*v);
    }
    qb.push(")");
}

/// `#p` / `#e` → membership in the event_tags child table.
fn push_tag_subquery(qb: &mut QueryBuilder<Sqlite>, name: &str, values: &[String]) {
    if values.is_empty() {
        return;
    }
    qb.push(" AND id IN (SELECT event_id FROM event_tags WHERE tag_name = ")
        .push_bind(name.to_string())
        .push(" AND tag_value IN (");
    let mut sep = qb.separated(", ");
    for v in values {
        sep.push_bind(v.clone());
    }
    qb.push("))");
}

/// NIP-50 full-text search via FTS5 (bm25 ranking).
pub async fn search_events(pool: &SqlitePool, query: &str, limit: i64) -> anyhow::Result<Vec<Event>> {
    let rows: Vec<EventRow> = sqlx::query_as(
        "SELECT e.id, e.pubkey, e.created_at, e.kind, e.tags, e.content, e.sig \
         FROM events_fts f JOIN events e ON e.rowid = f.rowid \
         WHERE events_fts MATCH ? ORDER BY bm25(events_fts) LIMIT ?",
    )
    .bind(query)
    .bind(limit.min(MAX_QUERY_LIMIT))
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(row_to_event).collect())
}

/// Get a single event by id (used for author verification on deletion).
pub async fn get_event_by_id(pool: &SqlitePool, event_id: &str) -> anyhow::Result<Option<Event>> {
    let row: Option<EventRow> = sqlx::query_as(
        "SELECT id, pubkey, created_at, kind, tags, content, sig FROM events WHERE id = ?",
    )
    .bind(event_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(row_to_event))
}

/// Total number of stored events (for host-management stats).
pub async fn count_events(pool: &SqlitePool) -> anyhow::Result<i64> {
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events")
        .fetch_one(pool)
        .await?;
    Ok(n)
}

/// Number of NIP-29 groups hosted (for host-management stats).
pub async fn count_groups(pool: &SqlitePool) -> anyhow::Result<i64> {
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM groups")
        .fetch_one(pool)
        .await?;
    Ok(n)
}

/// Delete an event by id.
pub async fn delete_event(pool: &SqlitePool, event_id: &str) -> anyhow::Result<bool> {
    let r = sqlx::query("DELETE FROM events WHERE id = ?")
        .bind(event_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

/// Unconditionally delete the addressable event for `(kind, pubkey, d_tag)`
/// (relay re-publishing its own group metadata; same-second replace).
pub async fn replace_addressable(
    pool: &SqlitePool,
    kind: i32,
    pubkey: &str,
    d_tag: &str,
) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM events WHERE kind = ? AND pubkey = ? AND d_tag = ?")
        .bind(kind)
        .bind(pubkey)
        .bind(d_tag)
        .execute(pool)
        .await?;
    Ok(())
}

/// NIP-09 `a`-tag deletion: delete the addressable event for `(kind, pubkey,
/// d_tag)` only if created at or before `created_at`. Returns rows removed.
pub async fn delete_addressable_upto(
    pool: &SqlitePool,
    kind: i32,
    pubkey: &str,
    d_tag: &str,
    created_at: i64,
) -> anyhow::Result<u64> {
    let r = sqlx::query(
        "DELETE FROM events WHERE kind = ? AND pubkey = ? AND d_tag = ? AND created_at <= ?",
    )
    .bind(kind)
    .bind(pubkey)
    .bind(d_tag)
    .bind(created_at)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    // A single-connection in-memory pool (so the db persists across queries).
    async fn pool() -> SqlitePool {
        let p = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(SCHEMA).execute(&p).await.unwrap();
        p
    }

    fn ev(id: &str, pubkey: &str, kind: i32, created_at: i64, tags: Vec<Vec<&str>>, content: &str) -> Event {
        Event {
            id: id.into(),
            pubkey: pubkey.into(),
            created_at,
            kind,
            tags: tags.into_iter().map(|t| t.into_iter().map(String::from).collect()).collect(),
            content: content.into(),
            sig: "sig".into(),
        }
    }

    fn filter(json: serde_json::Value) -> Filter {
        serde_json::from_value(json).unwrap()
    }

    #[tokio::test]
    async fn store_and_query_by_id_author_kind() {
        let p = pool().await;
        assert!(store_event(&p, &ev("a", "alice", 1, 100, vec![], "hi")).await.unwrap());
        assert!(store_event(&p, &ev("b", "bob", 1, 101, vec![], "yo")).await.unwrap());

        let by_id = query_events(&p, &filter(serde_json::json!({"ids": ["a"]}))).await.unwrap();
        assert_eq!(by_id.len(), 1);
        assert_eq!(by_id[0].id, "a");

        let by_author = query_events(&p, &filter(serde_json::json!({"authors": ["bob"]}))).await.unwrap();
        assert_eq!(by_author.len(), 1);
        assert_eq!(by_author[0].pubkey, "bob");

        // Ordered newest-first.
        let by_kind = query_events(&p, &filter(serde_json::json!({"kinds": [1]}))).await.unwrap();
        assert_eq!(by_kind.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), vec!["b", "a"]);
    }

    #[tokio::test]
    async fn duplicate_id_is_ignored() {
        let p = pool().await;
        assert!(store_event(&p, &ev("a", "alice", 1, 100, vec![], "hi")).await.unwrap());
        assert!(!store_event(&p, &ev("a", "alice", 1, 100, vec![], "hi")).await.unwrap());
        let rows = query_events(&p, &filter(serde_json::json!({"ids": ["a"]}))).await.unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[tokio::test]
    async fn replaceable_keeps_newest() {
        let p = pool().await;
        // kind:0 is replaceable (one per pubkey+kind).
        store_event(&p, &ev("v1", "alice", 0, 100, vec![], "old")).await.unwrap();
        store_event(&p, &ev("v2", "alice", 0, 200, vec![], "new")).await.unwrap();
        // An older one must be rejected (unique index conflict after no-op delete).
        assert!(!store_event(&p, &ev("v3", "alice", 0, 50, vec![], "older")).await.unwrap());

        let rows = query_events(&p, &filter(serde_json::json!({"kinds": [0]}))).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].content, "new");
    }

    #[tokio::test]
    async fn addressable_replaces_by_dtag() {
        let p = pool().await;
        store_event(&p, &ev("a1", "alice", 30023, 100, vec![vec!["d", "post"]], "draft")).await.unwrap();
        store_event(&p, &ev("a2", "alice", 30023, 200, vec![vec!["d", "post"]], "final")).await.unwrap();
        // Different d-tag coexists.
        store_event(&p, &ev("a3", "alice", 30023, 150, vec![vec!["d", "other"]], "second")).await.unwrap();

        let rows = query_events(&p, &filter(serde_json::json!({"kinds": [30023], "#d": ["post"]}))).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].content, "final");
        let all = query_events(&p, &filter(serde_json::json!({"kinds": [30023]}))).await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn h_tag_and_pe_tag_filters() {
        let p = pool().await;
        store_event(&p, &ev("c1", "alice", 9, 100, vec![vec!["h", "groupA"], vec!["p", "bob"]], "in A")).await.unwrap();
        store_event(&p, &ev("c2", "alice", 9, 101, vec![vec!["h", "groupB"], vec!["e", "evt1"]], "in B")).await.unwrap();

        let h = query_events(&p, &filter(serde_json::json!({"#h": ["groupA"]}))).await.unwrap();
        assert_eq!(h.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), vec!["c1"]);

        let p_tag = query_events(&p, &filter(serde_json::json!({"#p": ["bob"]}))).await.unwrap();
        assert_eq!(p_tag.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), vec!["c1"]);

        let e_tag = query_events(&p, &filter(serde_json::json!({"#e": ["evt1"]}))).await.unwrap();
        assert_eq!(e_tag.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), vec!["c2"]);
    }

    #[tokio::test]
    async fn since_until_and_limit() {
        let p = pool().await;
        for i in 0..10 {
            store_event(&p, &ev(&format!("e{i}"), "alice", 1, 100 + i, vec![], "x")).await.unwrap();
        }
        let windowed = query_events(&p, &filter(serde_json::json!({"since": 103, "until": 105}))).await.unwrap();
        assert_eq!(windowed.len(), 3); // 103, 104, 105
        let limited = query_events(&p, &filter(serde_json::json!({"kinds": [1], "limit": 2}))).await.unwrap();
        assert_eq!(limited.len(), 2);
    }

    #[tokio::test]
    async fn fts_search() {
        let p = pool().await;
        store_event(&p, &ev("s1", "alice", 1, 100, vec![], "the quick brown fox")).await.unwrap();
        store_event(&p, &ev("s2", "alice", 1, 101, vec![], "lazy dog sleeps")).await.unwrap();

        let hits = query_events(&p, &filter(serde_json::json!({"search": "fox"}))).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "s1");

        // FTS index stays consistent after a delete.
        delete_event(&p, "s1").await.unwrap();
        let after = query_events(&p, &filter(serde_json::json!({"search": "fox"}))).await.unwrap();
        assert_eq!(after.len(), 0);
    }
}
