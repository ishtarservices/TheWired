//! DB-backed integration tests for the publish-side membership gate.
//!
//! Drives `protocol::handler::handle_message` directly (no WebSocket) against
//! the test Postgres database. These tests prove end-to-end that a kicked
//! member's h-tagged event is rejected by the relay; without the gate wiring
//! they will fail.
//!
//! See `tests/common/mod.rs` for the harness convention this matches against
//! the backend's vitest setup.

mod common;

use common::{
    add_member, insert_space, make_app_state, remove_member, send_event, setup_test_pool,
    sign_h_tagged, TestIdentity,
};

const SPACE_ID: &str = "space-it-1";

/// Pull the (event_id, ok, message) triple out of an `["OK", id, ok, msg]` reply.
fn parse_ok(value: &serde_json::Value) -> (String, bool, String) {
    assert_eq!(
        value.get(0).and_then(|v| v.as_str()),
        Some("OK"),
        "expected OK frame, got {value:?}"
    );
    let id = value
        .get(1)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let ok = value.get(2).and_then(|v| v.as_bool()).unwrap_or(false);
    let msg = value
        .get(3)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    (id, ok, msg)
}

/// Skips the test (with a printed warning) if Postgres isn't reachable. We do
/// this so a stock `cargo test` on a machine without `pnpm dev:infra` doesn't
/// hard-fail — matching the backend's behavior where vitest just reports a
/// connection error, not a build break.
macro_rules! pool_or_skip {
    () => {
        match setup_test_pool().await {
            Ok(p) => p,
            Err(e) => {
                eprintln!(
                    "SKIP: relay integration test — DB unreachable ({e}). \
                     Run `pnpm dev:infra` and ensure `thewired_test` exists."
                );
                return;
            }
        }
    };
}

/// THE BUG. With no publish-side membership check, a kicked user (no row in
/// `app.space_members`) can post a kind:9 chat to the space and the relay
/// stores + returns OK=true. After fix #1, this returns OK=false with an
/// "auth-required: not a member of this group" reason.
#[tokio::test]
async fn kicked_member_publish_is_rejected() {
    let pool = pool_or_skip!();
    let admin = TestIdentity::from_seed(0x01);
    let bob = TestIdentity::from_seed(0x02);

    insert_space(&pool, SPACE_ID).await.unwrap();
    add_member(&pool, SPACE_ID, &admin.pubkey).await.unwrap();
    add_member(&pool, SPACE_ID, &bob.pubkey).await.unwrap();

    // Bob is kicked.
    remove_member(&pool, SPACE_ID, &bob.pubkey).await.unwrap();

    let (state, broadcast_tx) = make_app_state(pool.clone());
    let chat = sign_h_tagged(&bob, 9, SPACE_ID, "i can still post lol");

    let resp = send_event(&state, &broadcast_tx, &chat).await;
    let (id, ok, msg) = parse_ok(&resp);

    assert_eq!(id, chat.id);
    assert!(
        !ok,
        "kicked member's h-tagged kind:9 must be rejected — got OK=true (msg={msg:?})"
    );
    assert!(
        msg.starts_with("auth-required:"),
        "expected auth-required reason, got: {msg:?}"
    );

    // And nothing was stored.
    let row: Option<(String,)> =
        sqlx::query_as("SELECT id FROM relay.events WHERE id = $1")
            .bind(&chat.id)
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert!(
        row.is_none(),
        "relay.events should not contain rejected event {}",
        chat.id,
    );
}

/// Sanity: actual members can still post.
#[tokio::test]
async fn member_publish_is_accepted() {
    let pool = pool_or_skip!();
    let alice = TestIdentity::from_seed(0x11);

    insert_space(&pool, SPACE_ID).await.unwrap();
    add_member(&pool, SPACE_ID, &alice.pubkey).await.unwrap();

    let (state, broadcast_tx) = make_app_state(pool.clone());
    let chat = sign_h_tagged(&alice, 9, SPACE_ID, "hello space");

    let resp = send_event(&state, &broadcast_tx, &chat).await;
    let (_, ok, msg) = parse_ok(&resp);
    assert!(ok, "member chat should be accepted, got msg={msg:?}");

    // Stored.
    let row: Option<(String,)> =
        sqlx::query_as("SELECT id FROM relay.events WHERE id = $1")
            .bind(&chat.id)
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert!(row.is_some(), "member's event should be stored");
}

/// Non-members must still be able to send kind:9021 (NIP-29 join request) —
/// otherwise no one could ever join. The gate must not block this.
#[tokio::test]
async fn join_request_from_non_member_passes_gate() {
    let pool = pool_or_skip!();
    let outsider = TestIdentity::from_seed(0x21);

    insert_space(&pool, SPACE_ID).await.unwrap();
    // outsider is intentionally NOT a member

    let (state, broadcast_tx) = make_app_state(pool.clone());
    let join = sign_h_tagged(&outsider, 9021, SPACE_ID, "");

    let resp = send_event(&state, &broadcast_tx, &join).await;
    let (_, ok, msg) = parse_ok(&resp);
    assert!(
        ok,
        "kind:9021 join request from non-member must not be gated, got msg={msg:?}"
    );
}

/// A kicked user must still be able to send kind:9022 (leave). That's how they
/// signal departure to other relays / clients. The gate would otherwise create
/// a bizarre "you're not a member, so you can't say you're leaving" loop.
#[tokio::test]
async fn leave_event_from_non_member_passes_gate() {
    let pool = pool_or_skip!();
    let bob = TestIdentity::from_seed(0x31);

    insert_space(&pool, SPACE_ID).await.unwrap();
    // bob isn't a member (kicked, never joined, etc.)

    let (state, broadcast_tx) = make_app_state(pool.clone());
    let leave = sign_h_tagged(&bob, 9022, SPACE_ID, "");

    let resp = send_event(&state, &broadcast_tx, &leave).await;
    let (_, ok, msg) = parse_ok(&resp);
    assert!(
        ok,
        "kind:9022 leave from non-member must not be gated, got msg={msg:?}"
    );
}

/// Events with no h-tag (e.g. global kind:1 notes) must pass the gate
/// regardless of membership.
#[tokio::test]
async fn untagged_event_passes_gate() {
    let pool = pool_or_skip!();
    let alice = TestIdentity::from_seed(0x41);

    let (state, broadcast_tx) = make_app_state(pool);
    let global_note = common::sign_event(
        &alice,
        1,
        vec![], // no h tag
        "hello world",
        1_700_000_000,
    );

    let resp = send_event(&state, &broadcast_tx, &global_note).await;
    let (_, ok, msg) = parse_ok(&resp);
    assert!(
        ok,
        "untagged kind:1 must always pass — got msg={msg:?}"
    );
}

/// Re-add a kicked member: they regain publish ability without disconnecting
/// or any other intervention. Confirms the gate reads the live DB row, not
/// some cached snapshot.
#[tokio::test]
async fn re_added_member_can_publish_again() {
    let pool = pool_or_skip!();
    let bob = TestIdentity::from_seed(0x51);

    insert_space(&pool, SPACE_ID).await.unwrap();
    add_member(&pool, SPACE_ID, &bob.pubkey).await.unwrap();

    let (state, broadcast_tx) = make_app_state(pool.clone());

    // Initial post: accepted.
    let first = sign_h_tagged(&bob, 9, SPACE_ID, "hello");
    let resp = send_event(&state, &broadcast_tx, &first).await;
    assert!(parse_ok(&resp).1, "first post should be accepted");

    // Kick.
    remove_member(&pool, SPACE_ID, &bob.pubkey).await.unwrap();
    let second = common::sign_event(
        &bob,
        9,
        vec![vec!["h".into(), SPACE_ID.into()]],
        "spam after kick",
        1_700_000_001,
    );
    let resp = send_event(&state, &broadcast_tx, &second).await;
    assert!(!parse_ok(&resp).1, "post after kick should be rejected");

    // Re-add (e.g. via /spaces/:id/join).
    add_member(&pool, SPACE_ID, &bob.pubkey).await.unwrap();
    let third = common::sign_event(
        &bob,
        9,
        vec![vec!["h".into(), SPACE_ID.into()]],
        "back again",
        1_700_000_002,
    );
    let resp = send_event(&state, &broadcast_tx, &third).await;
    assert!(parse_ok(&resp).1, "post after re-add should be accepted");
}
