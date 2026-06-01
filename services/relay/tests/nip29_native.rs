//! DB-backed integration tests for relay-native NIP-29 groups (Decentralized
//! Spaces M2). Proves that a group created via kind:9007 on our relay:
//!   - grants membership via `relay.group_members` (the UNION leg, independent
//!     of `app.space_members`),
//!   - causes the relay to sign + store + broadcast 39000/39001/39002 so other
//!     NIP-29 clients can render it,
//!   - gates publishing by relay-native membership,
//!   - republishes 39002 when a new member joins via kind:9021.
//!
//! See `tests/common/mod.rs` for the harness.

mod common;

use std::collections::HashSet;
use std::sync::Arc;
use common::{make_app_state, send_event, setup_test_pool, sign_event, sign_h_tagged, TestIdentity};
use thewired_relay::db::membership_source;
use thewired_relay::protocol::handler::handle_message;
use thewired_relay::protocol::subscription::SubscriptionManager;

fn parse_ok(value: &serde_json::Value) -> (bool, String) {
    assert_eq!(
        value.get(0).and_then(|v| v.as_str()),
        Some("OK"),
        "expected OK frame, got {value:?}"
    );
    let ok = value.get(2).and_then(|v| v.as_bool()).unwrap_or(false);
    let msg = value.get(3).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    (ok, msg)
}

macro_rules! pool_or_skip {
    () => {
        match setup_test_pool().await {
            Ok(p) => p,
            Err(e) => {
                eprintln!("SKIP: relay integration test — DB unreachable ({e}).");
                return;
            }
        }
    };
}

/// Sign a kind:9007 create-group with the group id in the `h` tag.
fn create_group_event(creator: &TestIdentity, group_id: &str, name: &str) -> thewired_relay::nostr::event::Event {
    sign_event(
        creator,
        9007,
        vec![vec!["h".into(), group_id.into()]],
        name,
        1_700_000_000,
    )
}

#[tokio::test]
async fn create_group_grants_relay_native_membership_and_emits_metadata() {
    let pool = pool_or_skip!();
    let group_id = "native-grp-meta";
    let (state, tx) = make_app_state(pool.clone());
    let creator = TestIdentity::from_seed(11);

    let (ok, _) = parse_ok(&send_event(&state, &tx, &create_group_event(&creator, group_id, "My Group")).await);
    assert!(ok, "9007 create should succeed");

    // Membership comes from relay.group_members — there is NO app.space_members
    // row for this group, proving the UNION's relay-native leg works.
    assert!(
        membership_source::is_member(&pool, group_id, &creator.pubkey).await.unwrap(),
        "creator should be a member of the native group"
    );
    let stranger = TestIdentity::from_seed(99);
    assert!(
        !membership_source::is_member(&pool, group_id, &stranger.pubkey).await.unwrap(),
        "a stranger must not be a member"
    );

    // members_of (used to seed the broadcast cache) includes the native group.
    let groups = membership_source::members_of(&pool, &creator.pubkey).await.unwrap();
    assert!(groups.contains(group_id), "members_of should include the native group id");

    // The relay signed + stored 39000/39001/39002 for the group.
    for kind in [39000, 39001, 39002] {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT pubkey FROM relay.events WHERE kind = $1 AND d_tag = $2",
        )
        .bind(kind)
        .bind(group_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
        let (pubkey,) = row.unwrap_or_else(|| panic!("expected a kind:{kind} metadata event"));
        assert_eq!(
            pubkey, state.relay_identity.pubkey,
            "kind:{kind} must be signed by the relay identity"
        );
    }

    // 39002 (members) p-tags the creator.
    let (members_tags,): (String,) = sqlx::query_as(
        "SELECT tags::text FROM relay.events WHERE kind = 39002 AND d_tag = $1",
    )
    .bind(group_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(members_tags.contains(&creator.pubkey), "39002 should list the creator as a member");
}

#[tokio::test]
async fn private_group_sets_flag_and_signals_auth_required() {
    let pool = pool_or_skip!();
    let group_id = "native-grp-private";
    let (state, tx) = make_app_state(pool.clone());
    let creator = TestIdentity::from_seed(17);

    // Create a private group (kind:9007 with a "private" marker tag).
    let create = sign_event(
        &creator,
        9007,
        vec![vec!["h".into(), group_id.into()], vec!["private".into()]],
        "Secret",
        1_700_000_000,
    );
    let (ok, _) = parse_ok(&send_event(&state, &tx, &create).await);
    assert!(ok, "private group creation should succeed");

    let (is_private,): (bool,) =
        sqlx::query_as("SELECT is_private FROM relay.groups WHERE group_id = $1")
            .bind(group_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(is_private, "is_private should be recorded");

    // An anonymous REQ for the private group's chat gets an auth-required CLOSED.
    let req = serde_json::json!(["REQ", "s1", { "kinds": [9], "#h": [group_id] }]).to_string();
    let subs = Arc::new(tokio::sync::Mutex::new(SubscriptionManager::new()));
    let mut authed: Option<String> = None;
    let mut memberships: HashSet<String> = HashSet::new();
    let resp = handle_message(&req, &state, &subs, &mut authed, &mut memberships, "ch", &tx).await;
    assert!(resp[0].contains("CLOSED"), "expected CLOSED, got: {:?}", resp);
    assert!(resp[0].contains("auth-required"), "expected auth-required, got: {:?}", resp);
}

#[tokio::test]
async fn create_group_rejects_collision_with_platform_space() {
    // SECURITY (VULN B): a 9007 whose id collides with a backend-authoritative
    // platform space must be rejected, so an attacker can't hijack membership of
    // that space via the app.space_members ∪ relay.group_members union.
    let pool = pool_or_skip!();
    let (state, tx) = make_app_state(pool.clone());
    let platform_id = "platform-space-xyz";
    let owner = TestIdentity::from_seed(20);
    let attacker = TestIdentity::from_seed(21);

    // A platform space lives in app.spaces (+ app.space_members) with NO relay.groups row.
    sqlx::query("INSERT INTO app.spaces (id, name) VALUES ($1, $1)")
        .bind(platform_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO app.space_members (space_id, pubkey) VALUES ($1, $2)")
        .bind(platform_id)
        .bind(&owner.pubkey)
        .execute(&pool)
        .await
        .unwrap();

    let (ok, msg) = parse_ok(&send_event(&state, &tx, &create_group_event(&attacker, platform_id, "hijack")).await);
    assert!(!ok, "9007 colliding with a platform space id must be rejected");
    assert!(msg.contains("reserved"), "reason should say reserved, got: {msg}");

    // The attacker did NOT become a relay-native member, and the union still
    // excludes them from the platform space (only the real member remains).
    assert!(!membership_source::is_member(&pool, platform_id, &attacker.pubkey).await.unwrap());
    assert!(membership_source::is_member(&pool, platform_id, &owner.pubkey).await.unwrap());
}

#[tokio::test]
async fn relay_native_membership_gates_publishing() {
    let pool = pool_or_skip!();
    let group_id = "native-grp-gate";
    let (state, tx) = make_app_state(pool.clone());
    let creator = TestIdentity::from_seed(12);

    parse_ok(&send_event(&state, &tx, &create_group_event(&creator, group_id, "G")).await);

    // Member can post chat.
    let (ok, _) = parse_ok(&send_event(&state, &tx, &sign_h_tagged(&creator, 9, group_id, "hi")).await);
    assert!(ok, "member should be able to post to the native group");

    // Non-member is rejected by the union publish gate.
    let stranger = TestIdentity::from_seed(98);
    let (ok, msg) = parse_ok(&send_event(&state, &tx, &sign_h_tagged(&stranger, 9, group_id, "spam")).await);
    assert!(!ok, "non-member must be rejected");
    assert!(msg.contains("not a member"), "reason should explain membership, got: {msg}");
}

#[tokio::test]
async fn edit_metadata_updates_published_39000() {
    let pool = pool_or_skip!();
    let group_id = "native-grp-edit";
    let (state, tx) = make_app_state(pool.clone());
    let creator = TestIdentity::from_seed(15);
    let stranger = TestIdentity::from_seed(16);

    parse_ok(&send_event(&state, &tx, &create_group_event(&creator, group_id, "G")).await);

    // Admin edits picture + about via kind:9002.
    let edit = sign_event(
        &creator,
        9002,
        vec![
            vec!["h".into(), group_id.into()],
            vec!["picture".into(), "https://example.com/p.png".into()],
            vec!["about".into(), "hello world".into()],
        ],
        "",
        1_700_000_001,
    );
    let (ok, _) = parse_ok(&send_event(&state, &tx, &edit).await);
    assert!(ok, "admin 9002 should succeed");

    // The republished 39000 reflects the new picture/about.
    let (tags,): (String,) = sqlx::query_as(
        "SELECT tags::text FROM relay.events WHERE kind = 39000 AND d_tag = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(group_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(tags.contains("example.com/p.png"), "39000 should carry the edited picture");
    assert!(tags.contains("hello world"), "39000 should carry the edited about");

    // A non-admin's 9002 is rejected.
    let (ok, _) = parse_ok(
        &send_event(
            &state,
            &tx,
            &sign_event(
                &stranger,
                9002,
                vec![vec!["h".into(), group_id.into()], vec!["name".into(), "hijack".into()]],
                "",
                1_700_000_002,
            ),
        )
        .await,
    );
    assert!(!ok, "non-admin 9002 must be rejected");
}

#[tokio::test]
async fn open_group_join_adds_member_and_republishes_39002() {
    let pool = pool_or_skip!();
    let group_id = "native-grp-join";
    let (state, tx) = make_app_state(pool.clone());
    let creator = TestIdentity::from_seed(13);
    let joiner = TestIdentity::from_seed(14);

    parse_ok(&send_event(&state, &tx, &create_group_event(&creator, group_id, "G")).await);

    // Open group (default is_closed=false) → 9021 auto-adds.
    let (ok, _) = parse_ok(&send_event(&state, &tx, &sign_h_tagged(&joiner, 9021, group_id, "")).await);
    assert!(ok, "join request should succeed for open group");
    assert!(
        membership_source::is_member(&pool, group_id, &joiner.pubkey).await.unwrap(),
        "joiner should now be a member"
    );

    // 39002 was republished (unconditional replace) and includes the joiner.
    let (members_tags,): (String,) = sqlx::query_as(
        "SELECT tags::text FROM relay.events WHERE kind = 39002 AND d_tag = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(group_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(members_tags.contains(&joiner.pubkey), "republished 39002 should include the joiner");
}
