//! The pool's per-statement cap (`PoolSettings::statement_timeout_ms`,
//! `RELAY_DB_STATEMENT_TIMEOUT_MS`): a runaway query is cancelled by Postgres
//! instead of holding one of the pooled connections for good, and the
//! connection stays usable afterwards. Needs the relay test DB; skips otherwise.
mod common;

use thewired_relay::db::pool::{create_pool_with, PoolSettings};

#[tokio::test]
async fn slow_statement_is_cancelled_and_the_connection_survives() {
    let settings = PoolSettings { max_connections: 2, min_connections: 0, statement_timeout_ms: 200 };
    let pool = match create_pool_with(&common::test_db_url(), &settings).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("⚠ skipping statement-timeout test (DB unreachable): {e}");
            return;
        }
    };

    let err = sqlx::query("SELECT pg_sleep(2)").execute(&pool).await.unwrap_err();
    assert!(err.to_string().contains("statement timeout"), "unexpected error: {err}");

    // The cancelled statement did not poison the connection.
    let (one,): (i32,) = sqlx::query_as("SELECT 1").fetch_one(&pool).await.unwrap();
    assert_eq!(one, 1);

    // The cap is the session default, so a RESET (what run_migrations does
    // after lifting it) lands back on it rather than on "unlimited".
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("SET statement_timeout = 0").execute(&mut *conn).await.unwrap();
    sqlx::query("RESET statement_timeout").execute(&mut *conn).await.unwrap();
    let (timeout,): (String,) = sqlx::query_as("SHOW statement_timeout").fetch_one(&mut *conn).await.unwrap();
    assert_eq!(timeout, "200ms");
}

#[tokio::test]
async fn zero_disables_the_cap() {
    let settings = PoolSettings { max_connections: 1, min_connections: 0, statement_timeout_ms: 0 };
    let pool = match create_pool_with(&common::test_db_url(), &settings).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("⚠ skipping statement-timeout test (DB unreachable): {e}");
            return;
        }
    };
    let (timeout,): (String,) = sqlx::query_as("SHOW statement_timeout").fetch_one(&pool).await.unwrap();
    assert_eq!(timeout, "0");
}
