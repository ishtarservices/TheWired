//! Cross-driver parity harness for the `Db` backend abstraction
//! (Decentralized Spaces M6). The plan requires "a parity test suite across
//! both drivers before cutover" — this is it.
//!
//! The SAME sequence of relay-native operations is run through `Db::Sqlite`
//! (always — in-memory, no deps) and `Db::Pg` (only when `TEST_DATABASE_URL`
//! is reachable; skipped with a warning otherwise, like the other relay
//! integration tests). Both must produce identical observable results.
//!
//! We deliberately exercise only **relay-native** semantics (events with no
//! `h`-tag; groups created via 9007 into `relay.groups`). That is exactly the
//! subset the embedded relay uses, and it makes the Postgres
//! `app.space_members ∪ relay.group_members` UNION reduce to its relay-native
//! leg (no `app.*` rows are inserted), so the two backends are comparable.
//!
//! Gated to `--features embedded` (it names `Db::Sqlite`).
#![cfg(feature = "embedded")]

mod common;

use common::{sign_event, TestIdentity};
use thewired_relay::db::{sqlite, Db};

/// Everything observable from running the standard op sequence. `PartialEq` so
/// we can assert the two backends agree field-for-field.
#[derive(Debug, PartialEq)]
struct Obs {
    inserted_first: bool,
    inserted_dup: bool,
    inserted_second: bool,
    by_id_count: usize,
    by_author_count: usize,
    by_kind_ids_newest_first: Vec<String>,
    admin_alice: bool,
    member_alice_native: bool,
    members_after_create: Vec<String>,
    members_after_add: Vec<String>,
    group_has_bob: bool,
    unified_member_alice: bool,
    members_of_alice_has_g1: bool,
    any_private_default: bool,
    members_after_remove: Vec<String>,
    group_has_bob_after_remove: bool,
    existed_before_delete: bool,
    exists_after_delete: bool,
    // --- DM wire contract §7: gift-wrap gate, self-wrap flag, NIP-40 ---
    wrap_anon_count: usize,
    wrap_recipient_count: usize,
    wrap_stranger_count: usize,
    wrap_ingest_count: usize,
    wrap_self_published: bool,
    wrap_ids_for_neg: usize,
    expiring_visible_before: usize,
    expiring_visible_after: usize,
    expired_swept: u64,
}

/// Drive a full relay-native lifecycle through `db` and capture observations.
async fn exercise(db: &Db, alice: &TestIdentity, bob: &TestIdentity) -> Obs {
    // --- event store (plain kind-1 notes, no h-tag → no visibility gating) ---
    let note_a = sign_event(alice, 1, vec![], "hello from alice", 100);
    let note_b = sign_event(bob, 1, vec![], "hello from bob", 101);

    let inserted_first = db.store_event(&note_a).await.unwrap();
    let inserted_dup = db.store_event(&note_a).await.unwrap(); // same id → ignored
    let inserted_second = db.store_event(&note_b).await.unwrap();

    let by_id = db
        .query_events(&filt(serde_json::json!({ "ids": [note_a.id] })), None)
        .await
        .unwrap();
    let by_author = db
        .query_events(&filt(serde_json::json!({ "authors": [bob.pubkey] })), None)
        .await
        .unwrap();
    let by_kind = db
        .query_events(&filt(serde_json::json!({ "kinds": [1] })), None)
        .await
        .unwrap();

    // --- NIP-29 group store ---
    db.create_group("g1", "Group One", &alice.pubkey).await.unwrap();
    let admin_alice = db.is_admin("g1", &alice.pubkey).await.unwrap();
    let member_alice_native = db.group_has_member("g1", &alice.pubkey).await.unwrap();
    let members_after_create = sorted(db.get_members("g1").await.unwrap());

    db.add_member("g1", &bob.pubkey).await.unwrap();
    let members_after_add = sorted(db.get_members("g1").await.unwrap());
    let group_has_bob = db.group_has_member("g1", &bob.pubkey).await.unwrap();

    // unified membership (Pg UNION reduces to relay-native here — no app rows)
    let unified_member_alice = db.is_member("g1", &alice.pubkey).await.unwrap();
    let members_of_alice_has_g1 = db.members_of(&alice.pubkey).await.unwrap().contains("g1");
    let any_private_default = db.any_private(&["g1".into()]).await.unwrap();

    db.remove_member("g1", &bob.pubkey).await.unwrap();
    let members_after_remove = sorted(db.get_members("g1").await.unwrap());
    let group_has_bob_after_remove = db.group_has_member("g1", &bob.pubkey).await.unwrap();

    // --- delete round-trip ---
    let existed_before_delete = db.get_event_by_id(&note_a.id).await.unwrap().is_some();
    db.delete_event(&note_a.id).await.unwrap();
    let exists_after_delete = db.get_event_by_id(&note_a.id).await.unwrap().is_some();

    // --- gift wraps: served only to the authenticated recipient (or ingest) ---
    use thewired_relay::nostr::wrap_gate::ReadCtx;
    let ephemeral = TestIdentity::from_seed(9);
    let wrap = sign_event(&ephemeral, 1059, vec![vec!["p".into(), bob.pubkey.clone()]], "cipher", 200);
    db.store_event_flagged(&wrap, true).await.unwrap();
    let wrap_filter = filt(serde_json::json!({ "kinds": [1059], "#p": [bob.pubkey] }));
    let ctx = |authed: Option<&'static str>, all: bool| ReadCtx { authed, serve_all_wraps: all, now: 300 };
    let bob_pk: &'static str = Box::leak(bob.pubkey.clone().into_boxed_str());
    let carol_pk: &'static str = Box::leak(TestIdentity::from_seed(3).pubkey.into_boxed_str());
    let wrap_anon_count = db.query_events_ctx(&wrap_filter, &ctx(None, false)).await.unwrap().len();
    let wrap_recipient_count = db.query_events_ctx(&wrap_filter, &ctx(Some(bob_pk), false)).await.unwrap().len();
    let wrap_stranger_count = db.query_events_ctx(&wrap_filter, &ctx(Some(carol_pk), false)).await.unwrap().len();
    let wrap_ingest_count = db.query_events_ctx(&wrap_filter, &ctx(Some(carol_pk), true)).await.unwrap().len();
    let wrap_self_published = db.is_self_published(&wrap.id).await.unwrap();
    let wrap_ids_for_neg = db.query_event_ids(&wrap_filter, &ctx(Some(bob_pk), false), 100).await.unwrap().len();

    // --- NIP-40: hidden once expired, then swept ---
    let expiring = sign_event(alice, 1, vec![vec!["expiration".into(), "400".into()]], "brief", 102);
    db.store_event(&expiring).await.unwrap();
    let exp_filter = filt(serde_json::json!({ "ids": [expiring.id] }));
    let expiring_visible_before = db.query_events_ctx(&exp_filter, &ctx(None, false)).await.unwrap().len();
    let expiring_visible_after = db
        .query_events_ctx(&exp_filter, &ReadCtx { authed: None, serve_all_wraps: false, now: 400 })
        .await
        .unwrap()
        .len();
    let expired_swept = db.delete_expired(400).await.unwrap();

    Obs {
        inserted_first,
        inserted_dup,
        inserted_second,
        by_id_count: by_id.len(),
        by_author_count: by_author.len(),
        by_kind_ids_newest_first: by_kind.iter().map(|e| e.id.clone()).collect(),
        admin_alice,
        member_alice_native,
        members_after_create,
        members_after_add,
        group_has_bob,
        unified_member_alice,
        members_of_alice_has_g1,
        any_private_default,
        members_after_remove,
        group_has_bob_after_remove,
        existed_before_delete,
        exists_after_delete,
        wrap_anon_count,
        wrap_recipient_count,
        wrap_stranger_count,
        wrap_ingest_count,
        wrap_self_published,
        wrap_ids_for_neg,
        expiring_visible_before,
        expiring_visible_after,
        expired_swept,
    }
}

fn filt(json: serde_json::Value) -> thewired_relay::nostr::filter::Filter {
    serde_json::from_value(json).unwrap()
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

/// The expected, backend-independent outcome of `exercise`.
fn expected(alice: &TestIdentity, bob: &TestIdentity, note_a_id: &str, note_b_id: &str) -> Obs {
    Obs {
        inserted_first: true,
        inserted_dup: false,
        inserted_second: true,
        by_id_count: 1,
        by_author_count: 1,
        // newest-first: note_b (ts 101) before note_a (ts 100)
        by_kind_ids_newest_first: vec![note_b_id.to_string(), note_a_id.to_string()],
        admin_alice: true,
        member_alice_native: true,
        members_after_create: vec![alice.pubkey.clone()],
        members_after_add: sorted(vec![alice.pubkey.clone(), bob.pubkey.clone()]),
        group_has_bob: true,
        unified_member_alice: true,
        members_of_alice_has_g1: true,
        any_private_default: false,
        members_after_remove: vec![alice.pubkey.clone()],
        group_has_bob_after_remove: false,
        existed_before_delete: true,
        exists_after_delete: false,
        wrap_anon_count: 0,
        wrap_recipient_count: 1,
        wrap_stranger_count: 0,
        wrap_ingest_count: 1,
        wrap_self_published: true,
        wrap_ids_for_neg: 1,
        expiring_visible_before: 1,
        expiring_visible_after: 0,
        expired_swept: 1,
    }
}

#[tokio::test]
async fn sqlite_matches_expected_and_postgres() {
    let alice = TestIdentity::from_seed(1);
    let bob = TestIdentity::from_seed(2);
    let note_a_id = sign_event(&alice, 1, vec![], "hello from alice", 100).id;
    let note_b_id = sign_event(&bob, 1, vec![], "hello from bob", 101).id;
    let want = expected(&alice, &bob, &note_a_id, &note_b_id);

    // SQLite arm — always runs (in-memory, no deps).
    let sqlite_db = Db::Sqlite(sqlite::connect_memory().await.unwrap());
    let sqlite_obs = exercise(&sqlite_db, &alice, &bob).await;
    assert_eq!(sqlite_obs, want, "SQLite backend diverged from expected");

    // Postgres arm — only if the test DB is reachable; otherwise skip.
    match common::setup_test_pool().await {
        Ok(pool) => {
            let pg_db = Db::Pg(pool);
            let pg_obs = exercise(&pg_db, &alice, &bob).await;
            assert_eq!(
                pg_obs, sqlite_obs,
                "Postgres and SQLite backends disagree — parity broken"
            );
        }
        Err(e) => {
            eprintln!("⚠ skipping Postgres parity arm (DB unreachable): {e}");
        }
    }
}
