// Shared test helpers are included via `mod common` in several test binaries;
// each uses a different subset, so unused-in-this-binary is expected.
#![allow(dead_code)]

//! Shared scaffolding for DB-backed integration tests.
//!
//! Mirrors `services/backend/test/setup.ts`: same Postgres database
//! (`thewired_test`), same env-var override (`TEST_DATABASE_URL`), same
//! between-test TRUNCATE strategy.
//!
//! Each test calls [`setup_test_pool`] in a `#[tokio::test]`. The first call
//! per process applies the relay's own migrations and creates the minimum
//! `app.*` tables the relay reads (`spaces`, `space_members`, and the role
//! model behind 9005 authority). Subsequent
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

use secp256k1::{Keypair, SecretKey};
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
/// test crate to the Node service. Only `app.spaces` (FK target),
/// `app.space_members` (the membership source of truth) and the role tables
/// (`space_roles`, `role_permissions`, `channel_overrides`, `member_roles`,
/// `space_channels`, `bans`) are needed.
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
                creator_pubkey TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE app.space_members (
                space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
                pubkey TEXT NOT NULL,
                joined_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (space_id, pubkey)
            );
            -- The backend's role model, read for 9005 authority on platform spaces.
            CREATE TABLE app.space_channels (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                position INTEGER NOT NULL DEFAULT 0,
                is_default BOOLEAN NOT NULL DEFAULT false
            );
            CREATE TABLE app.space_roles (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                is_default BOOLEAN NOT NULL DEFAULT false,
                is_admin BOOLEAN NOT NULL DEFAULT false
            );
            CREATE TABLE app.role_permissions (
                role_id TEXT NOT NULL REFERENCES app.space_roles(id) ON DELETE CASCADE,
                permission TEXT NOT NULL,
                PRIMARY KEY (role_id, permission)
            );
            CREATE TABLE app.channel_overrides (
                role_id TEXT NOT NULL REFERENCES app.space_roles(id) ON DELETE CASCADE,
                channel_id TEXT NOT NULL,
                permission TEXT NOT NULL,
                effect TEXT NOT NULL,
                PRIMARY KEY (role_id, channel_id, permission)
            );
            CREATE TABLE app.member_roles (
                space_id TEXT NOT NULL,
                pubkey TEXT NOT NULL,
                role_id TEXT NOT NULL,
                PRIMARY KEY (space_id, pubkey, role_id)
            );
            CREATE TABLE app.bans (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
                pubkey TEXT NOT NULL,
                banned_by TEXT NOT NULL,
                expires_at BIGINT
            );
            -- The account tables the community author set reads (db/community.rs).
            CREATE TABLE app.nip05_identities (
                username TEXT PRIMARY KEY,
                pubkey TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE app.push_devices (
                id TEXT PRIMARY KEY,
                pubkey TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'expo',
                token TEXT NOT NULL UNIQUE,
                platform TEXT NOT NULL DEFAULT 'ios',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE app.account_clients (
                pubkey TEXT NOT NULL,
                client TEXT NOT NULL,
                platform TEXT NOT NULL DEFAULT '',
                version TEXT NOT NULL DEFAULT '',
                first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (pubkey, client, platform)
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
    // `app.account_clients` is dropped and recreated by one firehose test (the
    // relay must work before the backend migration creates it), so it is
    // truncated only when present.
    sqlx::raw_sql(
        "DO $$ BEGIN IF to_regclass('app.account_clients') IS NOT NULL THEN \
             EXECUTE 'TRUNCATE app.account_clients'; END IF; END $$;",
    )
    .execute(pool)
    .await?;
    sqlx::raw_sql(
        r#"
        TRUNCATE
            relay.events,
            relay.groups,
            relay.group_members,
            relay.group_roles,
            relay.invite_codes,
            relay.suspended_pubkeys,
            relay.tombstones,
            relay.deleted_events,
            relay.deleted_addresses,
            relay.community_authors,
            app.nip05_identities,
            app.push_devices,
            app.space_members,
            app.member_roles,
            app.role_permissions,
            app.channel_overrides,
            app.space_roles,
            app.space_channels,
            app.bans,
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

/// A platform space the way production has it: an `app.spaces` row (with its
/// owner) and NO `relay.groups` mirror — the relay refuses a 9007 whose id
/// collides with `app.spaces`, so platform spaces never get relay admins.
pub async fn insert_platform_space(pool: &PgPool, space_id: &str, creator: &str) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO app.spaces (id, name, creator_pubkey) VALUES ($1, $1, $2)")
        .bind(space_id)
        .bind(creator)
        .execute(pool)
        .await?;
    Ok(())
}

/// Insert an `app.space_channels` row.
pub async fn insert_channel(
    pool: &PgPool,
    space_id: &str,
    channel_id: &str,
    kind: &str,
    is_default: bool,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO app.space_channels (id, space_id, type, label, is_default) VALUES ($1, $2, $3, $1, $4)",
    )
    .bind(channel_id)
    .bind(space_id)
    .bind(kind)
    .bind(is_default)
    .execute(pool)
    .await?;
    Ok(())
}

/// Create a role with base `permissions` and assign it to each of `holders`.
pub async fn insert_role(
    pool: &PgPool,
    space_id: &str,
    role_id: &str,
    is_admin: bool,
    permissions: &[&str],
    holders: &[&str],
) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO app.space_roles (id, space_id, name, is_admin) VALUES ($1, $2, $1, $3)")
        .bind(role_id)
        .bind(space_id)
        .bind(is_admin)
        .execute(pool)
        .await?;
    for permission in permissions {
        sqlx::query("INSERT INTO app.role_permissions (role_id, permission) VALUES ($1, $2)")
            .bind(role_id)
            .bind(permission)
            .execute(pool)
            .await?;
    }
    for pubkey in holders {
        sqlx::query("INSERT INTO app.member_roles (space_id, pubkey, role_id) VALUES ($1, $2, $3)")
            .bind(space_id)
            .bind(pubkey)
            .bind(role_id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Insert an `allow` / `deny` channel override for a role.
pub async fn insert_override(
    pool: &PgPool,
    role_id: &str,
    channel_id: &str,
    permission: &str,
    effect: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO app.channel_overrides (role_id, channel_id, permission, effect) VALUES ($1, $2, $3, $4)",
    )
    .bind(role_id)
    .bind(channel_id)
    .bind(permission)
    .bind(effect)
    .execute(pool)
    .await?;
    Ok(())
}

/// Ban `pubkey` from the space (`expires_at` unix seconds, `None` = permanent).
pub async fn insert_ban(pool: &PgPool, space_id: &str, pubkey: &str, expires_at: Option<i64>) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO app.bans (id, space_id, pubkey, banned_by, expires_at) VALUES ($1, $2, $3, 'test', $4)",
    )
    .bind(format!("ban-{space_id}-{pubkey}"))
    .bind(space_id)
    .bind(pubkey)
    .bind(expires_at)
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
        let secret = SecretKey::from_secret_bytes([seed; 32]).expect("valid sk");
        let keypair = Keypair::from_secret_key(&secret);
        let (xonly, _) = keypair.x_only_public_key();
        TestIdentity {
            keypair,
            pubkey: hex::encode(xonly.to_byte_array()),
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
    let id = hex::encode(hash);

    let sig = secp256k1::schnorr::sign_no_aux_rand(&hash, &identity.keypair);

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

/// An event tagged into SEVERAL spaces (one `["h", id]` per id), signed by
/// `identity`. For multi-space music tests.
pub fn sign_multi_h(
    identity: &TestIdentity,
    kind: i32,
    space_ids: &[&str],
    content: &str,
) -> Event {
    sign_event(
        identity,
        kind,
        space_ids
            .iter()
            .map(|id| vec!["h".to_string(), id.to_string()])
            .collect(),
        content,
        1_700_000_000,
    )
}

/// A kind:31683 track shared into `space_ids`. Music kinds must carry `title`
/// and `d` tags to pass `validate_music_event`; `slug` is the `d` value.
pub fn sign_music_track(identity: &TestIdentity, space_ids: &[&str], slug: &str) -> Event {
    let mut tags: Vec<Vec<String>> = vec![
        vec!["d".to_string(), slug.to_string()],
        vec!["title".to_string(), format!("Track {slug}")],
    ];
    tags.extend(
        space_ids
            .iter()
            .map(|id| vec!["h".to_string(), id.to_string()]),
    );
    sign_event(identity, 31683, tags, "", 1_700_000_000)
}

// ── AppState scaffolding ────────────────────────────────────────────────

/// Build an AppState wired to the given pool. `relay_url` matches what
/// the production server would compute for `ws://localhost:7777`.
pub fn make_app_state(pool: PgPool) -> (Arc<AppState>, broadcast::Sender<Event>) {
    make_app_state_with(pool, |_| {})
}

/// Like [`make_app_state`] but lets a test tweak the config first (ingest
/// pubkeys, gate mode, rate limits…).
pub fn make_app_state_with(
    pool: PgPool,
    tweak: impl FnOnce(&mut Config),
) -> (Arc<AppState>, broadcast::Sender<Event>) {
    let (tx, _) = broadcast::channel::<Event>(64);
    let mut config = Config {
        port: 7777,
        database_url: test_db_url(),
        rust_env: "test".to_string(),
        relay_secret_key: None,
        relay_name: "test-relay".to_string(),
        relay_description: "test".to_string(),
        ..Config::default()
    };
    tweak(&mut config);
    let relay_identity = RelayIdentity::new(config.relay_secret_key.clone(), &config.rust_env);
    // Same shape `server::run` builds: the canonical URL plus any extras.
    let mut auth_relay_urls = vec!["ws://localhost:7777".to_string()];
    auth_relay_urls.extend(config.auth_relay_urls.iter().cloned());
    let state = AppState {
        pool: thewired_relay::db::Db::Pg(pool),
        config,
        broadcast_tx: tx.clone(),
        relay_identity,
        active_connections: std::sync::atomic::AtomicUsize::new(0),
        relay_url: "ws://localhost:7777".to_string(),
        auth_relay_urls: std::sync::RwLock::new(auth_relay_urls),
        hosted_only: false,
        owner_pubkey: None,
        ip_conns: std::sync::Mutex::new(Default::default()),
        ip_last_connect: std::sync::Mutex::new(Default::default()),
        metrics: Default::default(),
        shadowed: std::sync::RwLock::new(Default::default()),
        community: std::sync::RwLock::new(None),
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
