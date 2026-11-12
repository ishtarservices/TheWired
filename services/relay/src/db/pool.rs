use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use std::str::FromStr;
use std::time::Duration;

/// Connection-pool knobs (`Config::pool_settings`, `RELAY_DB_*`).
#[derive(Debug, Clone)]
pub struct PoolSettings {
    pub max_connections: u32,
    pub min_connections: u32,
    /// Per-statement cap, applied as the session default of every pooled
    /// connection. A runaway REQ, NIP-50 search or generic-tag scan is
    /// cancelled instead of holding a connection for good; the client gets
    /// `CLOSED … error: query failed` (handler) and re-REQs. 0 disables it.
    pub statement_timeout_ms: u64,
}

impl Default for PoolSettings {
    fn default() -> Self {
        Self { max_connections: 20, min_connections: 2, statement_timeout_ms: 10_000 }
    }
}

pub async fn create_pool(database_url: &str) -> anyhow::Result<PgPool> {
    create_pool_with(database_url, &PoolSettings::default()).await
}

pub async fn create_pool_with(database_url: &str, settings: &PoolSettings) -> anyhow::Result<PgPool> {
    let mut options = PgConnectOptions::from_str(database_url)?;
    if settings.statement_timeout_ms > 0 {
        // A startup parameter rather than a `SET`: it becomes the session
        // default, so `RESET statement_timeout` (run_migrations) lands back
        // on it instead of on the server's unlimited default.
        options = options.options([("statement_timeout", settings.statement_timeout_ms.to_string())]);
    }
    let max = settings.max_connections.max(1);
    let min = settings.min_connections.min(max);
    let pool = PgPoolOptions::new()
        .max_connections(max)
        .min_connections(min)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(options)
        .await?;

    tracing::info!(
        min_connections = min,
        max_connections = max,
        statement_timeout_ms = settings.statement_timeout_ms,
        "Connected to database"
    );
    Ok(pool)
}

pub async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    // Run raw SQL migrations sequentially
    let migrations = [
        include_str!("../../migrations/001_initial.sql"),
        include_str!("../../migrations/002_visibility_column.sql"),
        include_str!("../../migrations/003_tag_columns.sql"),
        include_str!("../../migrations/004_h_tags_column.sql"),
        include_str!("../../migrations/005_expiration_selfwrap.sql"),
        include_str!("../../migrations/006_moderation.sql"),
        include_str!("../../migrations/007_deletions.sql"),
        include_str!("../../migrations/008_shadow_mode.sql"),
        include_str!("../../migrations/009_community_authors.sql"),
    ];
    // One connection, no statement timeout: an index build or a backfill on
    // a large relay.events legitimately outlives the per-REQ cap.
    let mut conn = pool.acquire().await?;
    sqlx::query("SET statement_timeout = 0").execute(&mut *conn).await?;
    let result: anyhow::Result<()> = async {
        for migration in &migrations {
            sqlx::raw_sql(migration).execute(&mut *conn).await?;
        }
        Ok(())
    }
    .await;
    // Back to the pool's session default whatever happened above.
    let _ = sqlx::query("RESET statement_timeout").execute(&mut *conn).await;
    result?;
    tracing::info!("Database migrations applied");
    Ok(())
}
