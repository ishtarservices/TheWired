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
