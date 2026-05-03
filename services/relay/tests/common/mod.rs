//! Shared scaffolding for DB-backed integration tests.
//!
//! Mirrors `services/backend/test/setup.ts`: same Postgres database
//! (`thewired_test`), same env-var override (`TEST_DATABASE_URL`), same
//! between-test TRUNCATE strategy.
//!
//! Each test calls [`setup_test_pool`] in a `#[tokio::test]`. The first call
//! per process applies the relay's own migrations and creates the minimum
//! `app.*` tables the relay reads (`spaces`, `space_members`). Subsequent
//! calls TRUNCATE all per-test data — they DON'T re-run migrations.
//!
//! ## Running locally
//!
//! ```sh
//! pnpm dev:infra     # spins up postgres on 5432
//! psql -h localhost -U thewired -d postgres -c "CREATE DATABASE thewired_test"  # if not present
//! cd services/relay && cargo test --test membership_gate
//! ```
//!
//! Tests are skipped (with a printed warning) if `TEST_DATABASE_URL` /
//! the default URL isn't reachable, so `cargo test` on a clean machine
//! doesn't hard-fail.

use secp256k1::{Keypair, Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::OnceCell;
use thewired_relay::{
    config::Config,
    nostr::event::Event,
    relay_identity::RelayIdentity,
    server::AppState,
};
use tokio::sync::broadcast;

const DEFAULT_TEST_DB: &str = "postgres://thewired:thewired@localhost:5432/thewired_relay_test";

/// One-shot per-process initializer. The first test to call `setup_test_pool`
/// runs schema setup; subsequent tests reuse the prepared schema and just
/// TRUNCATE between runs. Using a OnceCell (vs an `AtomicBool` flag) means a
/// failed init *blocks* later tests instead of silently skipping them — the
/// previous design hid real schema-mismatch errors as "DB unreachable" skips.
static INIT: OnceCell<()> = OnceCell::const_new();

/// Returns the configured test database URL (TEST_DATABASE_URL env or default).
pub fn test_db_url() -> String {
    std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| DEFAULT_TEST_DB.to_string())
}

/// Connect to the test DB. Returns Err with a message if Postgres isn't reachable —
/// callers should `?` and convert to a `skip` (we use a `Result<…, &str>` wrapper).
pub async fn try_connect_pool() -> Result<PgPool, String> {
    PgPool::connect(&test_db_url())
        .await
        .map_err(|e| format!("failed to connect to {}: {e}", test_db_url()))
}

/// Apply migrations once per test process, then TRUNCATE per-test state.
///
/// We apply BOTH the relay's own migrations (`relay.events` etc.) AND a small
/// subset of the backend's `app.*` schema that the relay reads. We don't
/// import the backend's full migration set — that would couple the relay
/// test crate to the Node service. Only `app.spaces` (FK target) and
/// `app.space_members` (the membership source of truth) are needed.
///
/// Schemas `relay` and `app` are dropped + recreated on first call. The DB
/// is exclusively for relay tests (default `thewired_relay_test`); we don't
/// share it with backend tests so a stale schema from an older relay version
/// can't poison runs.
pub async fn setup_test_pool() -> Result<PgPool, String> {
    let pool = try_connect_pool().await?;

    let init_pool = pool.clone();
    INIT.get_or_try_init(|| async move {
        // Wipe and recreate. The CASCADE drops dependent objects (indexes,
        // FKs, generated columns). Idempotent for a fresh DB.
        sqlx::raw_sql(
            "DROP SCHEMA IF EXISTS relay CASCADE; \
             DROP SCHEMA IF EXISTS app CASCADE; \
             CREATE SCHEMA app; \
             CREATE SCHEMA relay;",
        )
        .execute(&init_pool)
        .await
        .map_err(|e| format!("recreate schemas: {e}"))?;

        // Relay's own migrations build relay.* tables.
        thewired_relay::db::pool::run_migrations(&init_pool)
            .await
            .map_err(|e| format!("relay migrations: {e}"))?;

        // Minimum `app.*` tables the relay reads. Kept inline so this crate
        // stays decoupled from the backend's TypeScript migration set.
        sqlx::raw_sql(
            r#"
            CREATE TABLE app.spaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE app.space_members (
                space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
                pubkey TEXT NOT NULL,
                joined_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (space_id, pubkey)
            );
            "#,
        )
        .execute(&init_pool)
        .await
        .map_err(|e| format!("app.* tables: {e}"))?;

        Ok::<(), String>(())
    })
    .await?;

    truncate_all(&pool)
        .await
        .map_err(|e| format!("truncate: {e}"))?;
    Ok(pool)
}

/// TRUNCATE every per-test table. We deliberately leave `app.schema_migrations`
/// (managed by the backend) untouched — the relay test crate doesn't own it.
async fn truncate_all(pool: &PgPool) -> sqlx::Result<()> {
    sqlx::raw_sql(
        r#"
        TRUNCATE
            relay.events,
            relay.groups,
            relay.group_members,
            relay.group_roles,
            relay.invite_codes,
            app.space_members,
            app.spaces
        RESTART IDENTITY CASCADE;
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert a row into `app.spaces` so `app.space_members` FK is satisfied,
/// AND a parallel row in `relay.groups` so NIP-29 management handlers
/// (`handle_join_request`, `handle_leave`, etc.) recognize the group.
/// The two tables are intentionally separate in production — `app.spaces`
/// is the backend's source of truth, `relay.groups` is the NIP-29 mirror.
pub async fn insert_space(pool: &PgPool, space_id: &str) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO app.spaces (id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING")
        .bind(space_id)
        .execute(pool)
        .await?;
    sqlx::query(
        "INSERT INTO relay.groups (group_id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING",
    )
    .bind(space_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert a (space_id, pubkey) row into `app.space_members`.
pub async fn add_member(pool: &PgPool, space_id: &str, pubkey: &str) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO app.space_members (space_id, pubkey) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(space_id)
    .bind(pubkey)
    .execute(pool)
    .await?;
    Ok(())
}

/// Remove a (space_id, pubkey) row — simulates `moderationService.kickMember`.
pub async fn remove_member(pool: &PgPool, space_id: &str, pubkey: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM app.space_members WHERE space_id = $1 AND pubkey = $2")
        .bind(space_id)
        .bind(pubkey)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Event signing helpers ───────────────────────────────────────────────

/// A reproducible test identity: 32-byte secret key derived from a seed byte.
#[derive(Clone)]
pub struct TestIdentity {
    pub keypair: Keypair,
    pub pubkey: String,
}

impl TestIdentity {
    pub fn from_seed(seed: u8) -> Self {
        let secp = Secp256k1::new();
        let secret = SecretKey::from_slice(&[seed; 32]).expect("valid sk");
        let keypair = Keypair::from_secret_key(&secp, &secret);
        let (xonly, _) = keypair.x_only_public_key();
        TestIdentity {
            keypair,
            pubkey: hex::encode(xonly.serialize()),
        }
    }
}

/// Build a signed Nostr event with given kind, tags, and content. The schnorr
/// signature is real — `verify_event` will accept the result.
pub fn sign_event(
    identity: &TestIdentity,
    kind: i32,
    tags: Vec<Vec<String>>,
    content: &str,
    created_at: i64,
) -> Event {
    let secp = Secp256k1::new();
    let tags_json = serde_json::to_value(&tags).expect("serialize tags");
    let canonical = serde_json::to_string(&serde_json::json!([
        0,
        &identity.pubkey,
        created_at,
        kind,
        tags_json,
        content
    ]))
    .expect("serialize canonical");

    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let hash = hasher.finalize();
    let id = hex::encode(&hash);

    let sig = secp.sign_schnorr_no_aux_rand(&hash, &identity.keypair);

    Event {
        id,
        pubkey: identity.pubkey.clone(),
        created_at,
        kind,
        tags,
        content: content.to_string(),
        sig: hex::encode(sig.to_byte_array()),
    }
}

/// Convenience: an h-tagged event of the given kind, signed by `identity`.
pub fn sign_h_tagged(
    identity: &TestIdentity,
    kind: i32,
    space_id: &str,
    content: &str,
) -> Event {
    sign_event(
        identity,
        kind,
        vec![vec!["h".into(), space_id.into()]],
        content,
        1_700_000_000,
    )
}

// ── AppState scaffolding ────────────────────────────────────────────────

/// Build an AppState wired to the given pool. `relay_url` matches what
/// the production server would compute for `ws://localhost:7777`.
pub fn make_app_state(pool: PgPool) -> (Arc<AppState>, broadcast::Sender<Event>) {
    let (tx, _) = broadcast::channel::<Event>(64);
    let config = Config {
        port: 7777,
        database_url: test_db_url(),
        rust_env: "test".to_string(),
        relay_secret_key: None,
        relay_name: "test-relay".to_string(),
        relay_description: "test".to_string(),
    };
    let relay_identity = RelayIdentity::new(config.relay_secret_key.clone(), &config.rust_env);
    let state = AppState {
        pool,
        config,
        broadcast_tx: tx.clone(),
        relay_identity,
        active_connections: std::sync::atomic::AtomicUsize::new(0),
        relay_url: "ws://localhost:7777".to_string(),
    };
    (Arc::new(state), tx)
}

/// Send an EVENT message string through `handle_message` and return the
/// first OK / NOTICE response as a JSON value. Panics if there is no response
/// or the first response can't be parsed (means we'd need to fix the test).
pub async fn send_event(
    state: &Arc<AppState>,
    broadcast_tx: &broadcast::Sender<Event>,
    event: &Event,
) -> serde_json::Value {
    let event_json = serde_json::to_string(event).expect("serialize event");
    let msg = format!(r#"["EVENT",{event_json}]"#);
    let subs = Arc::new(tokio::sync::Mutex::new(
        thewired_relay::protocol::subscription::SubscriptionManager::new(),
    ));
    let mut authed: Option<String> = None;
    let mut memberships: std::collections::HashSet<String> = Default::default();
    let challenge = "test-challenge";

    let responses = thewired_relay::protocol::handler::handle_message(
        &msg,
        state,
        &subs,
        &mut authed,
        &mut memberships,
        challenge,
        broadcast_tx,
    )
    .await;

    assert!(
        !responses.is_empty(),
        "handle_message returned no response for EVENT"
    );
    serde_json::from_str(&responses[0]).expect("first response is JSON")
}
