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

/// Both tests truncate the shared Postgres test DB; run them one at a time.
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
    tie_lower_replaces_higher: bool,
    tie_higher_refused_after_lower: bool,
    tie_survivor_is_lowest: bool,
    dless_addressable_count: usize,
    group_created: bool,
    group_recreated: bool,
    recreate_made_bob_admin: bool,
    admin_alice: bool,
    member_alice_native: bool,
    members_after_create: Vec<String>,
    members_after_add: Vec<String>,
    group_has_bob: bool,
    unified_member_alice: bool,
    members_of_alice_has_g1: bool,
    any_private_default: bool,
    private_lists_anon: Vec<String>,
    private_lists_stranger: Vec<String>,
    private_lists_member: Vec<String>,
    private_meta_anon: Vec<String>,
    public_lists_anon: Vec<String>,
    members_after_remove: Vec<String>,
    group_has_bob_after_remove: bool,
    existed_before_delete: bool,
    exists_after_delete: bool,
    deleted_is_flagged: bool,
    deleted_reinsert: bool,
    deleted_reinsert_row: bool,
    other_is_flagged: bool,
    deleted_address_old_inserted: bool,
    deleted_address_new_inserted: bool,
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
    // --- space-scoped (h-only) events vs the ingest role ---
    space_anon_count: usize,
    space_stranger_count: usize,
    space_author_count: usize,
    space_ingest_count: usize,
    space_ingest_sees_only_chat: bool,
}

/// Drive a full relay-native lifecycle through `db` and capture observations.
async fn exercise(db: &Db, alice: &TestIdentity, bob: &TestIdentity) -> Obs {
    // --- event store (plain kind-1 notes, no h-tag → no visibility gating) ---
    let note_a = sign_event(alice, 1, vec![], "hello from alice", 100);
    let note_b = sign_event(bob, 1, vec![], "hello from bob", 101);

    let inserted_first = db.store_event(&note_a).await.unwrap();
    let inserted_dup = db.store_event(&note_a).await.unwrap(); // same id → ignored
    let inserted_second = db.store_event(&note_b).await.unwrap();

    // --- replaceable tie-break (audit 2026-10): equal created_at → lowest id
    //     survives whichever arrives first; a d-less addressable collapses to "" ---
    let (tie_lo, tie_hi) = {
        let x = sign_event(alice, 10002, vec![], "x", 300);
        let y = sign_event(alice, 10002, vec![], "y", 300);
        if x.id < y.id { (x, y) } else { (y, x) }
    };
    db.store_event(&tie_hi).await.unwrap();
    let tie_lower_replaces_higher = db.store_event(&tie_lo).await.unwrap();
    let tie_higher_refused_after_lower = db.store_event(&tie_hi).await.unwrap();
    let tie_survivor = db
        .query_events(&filt(serde_json::json!({ "kinds": [10002], "authors": [alice.pubkey] })), None)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.id)
        .collect::<Vec<_>>();
    let tie_survivor_is_lowest = tie_survivor == vec![tie_lo.id.clone()];
    db.store_event(&sign_event(alice, 30023, vec![], "nod-1", 300)).await.unwrap();
    db.store_event(&sign_event(alice, 30023, vec![], "nod-2", 301)).await.unwrap();
    let dless_addressable_count = db
        .query_events(&filt(serde_json::json!({ "kinds": [30023], "authors": [alice.pubkey] })), None)
        .await
        .unwrap()
        .len();

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
    let group_created = db.create_group("g1", "Group One", &alice.pubkey).await.unwrap();
    // Security audit 2026-10: re-creating an existing id is a no-op on BOTH
    // backends — the second caller gains no membership and no admin role.
    let group_recreated = db.create_group("g1", "Hijack", &bob.pubkey).await.unwrap();
    let recreate_made_bob_admin = db.is_admin("g1", &bob.pubkey).await.unwrap()
        || db.group_has_member("g1", &bob.pubkey).await.unwrap();
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

    // --- relay-signed group lists: private groups' 39001/39002 are members-only
    //     (security audit 2026-10); 39000 and public groups' lists stay public ---
    {
        use thewired_relay::nostr::nip29::metadata::publish_group_metadata;
        use thewired_relay::relay_identity::RelayIdentity;
        let identity = RelayIdentity::new(None, "test");
        let (btx, _) = tokio::sync::broadcast::channel(16);
        db.create_group("g-priv", "Private", &alice.pubkey).await.unwrap();
        db.set_group_flags("g-priv", true, false).await.unwrap();
        publish_group_metadata(db, &identity, &btx, "g-priv").await;
        publish_group_metadata(db, &identity, &btx, "g1").await; // public, has alice + bob
    }
    let lists = |gid: &str| filt(serde_json::json!({ "kinds": [39001, 39002], "#d": [gid] }));
    let kinds = |evs: Vec<thewired_relay::nostr::event::Event>| sorted(evs.iter().map(|e| e.kind.to_string()).collect());
    let private_lists_anon = kinds(db.query_events(&lists("g-priv"), None).await.unwrap());
    let private_lists_stranger = kinds(db.query_events(&lists("g-priv"), Some(&bob.pubkey)).await.unwrap());
    let private_lists_member = kinds(db.query_events(&lists("g-priv"), Some(&alice.pubkey)).await.unwrap());
    let private_meta_anon = kinds(
        db.query_events(&filt(serde_json::json!({ "kinds": [39000], "#d": ["g-priv"] })), None)
            .await
            .unwrap(),
    );
    let public_lists_anon = kinds(db.query_events(&lists("g1"), None).await.unwrap());

    db.remove_member("g1", &bob.pubkey).await.unwrap();
    let members_after_remove = sorted(db.get_members("g1").await.unwrap());
    let group_has_bob_after_remove = db.group_has_member("g1", &bob.pubkey).await.unwrap();

    // --- delete round-trip; a tombstoned event stays gone (audit 2026-10) ---
    let existed_before_delete = db.get_event_by_id(&note_a.id).await.unwrap().is_some();
    db.record_deleted_event(&note_a.id, &alice.pubkey, &alice.pubkey).await.unwrap();
    db.delete_event(&note_a.id).await.unwrap();
    let exists_after_delete = db.get_event_by_id(&note_a.id).await.unwrap().is_some();
    let deleted_is_flagged = db.is_deleted(&note_a).await.unwrap();
    let deleted_reinsert = db.store_event(&note_a).await.unwrap();
    let deleted_reinsert_row = db.get_event_by_id(&note_a.id).await.unwrap().is_some();
    let other_is_flagged = db.is_deleted(&note_b).await.unwrap();
    db.record_deleted_address(30023, &alice.pubkey, "p", 100, &alice.pubkey).await.unwrap();
    let addr_old = sign_event(alice, 30023, vec![vec!["d".into(), "p".into()]], "old", 100);
    let addr_new = sign_event(alice, 30023, vec![vec!["d".into(), "p".into()]], "new", 101);
    let deleted_address_old_inserted = db.store_event(&addr_old).await.unwrap();
    let deleted_address_new_inserted = db.store_event(&addr_new).await.unwrap();

    // --- gift wraps: served only to the authenticated recipient (or ingest) ---
    use thewired_relay::nostr::wrap_gate::ReadCtx;
    let ephemeral = TestIdentity::from_seed(9);
    let wrap = sign_event(&ephemeral, 1059, vec![vec!["p".into(), bob.pubkey.clone()]], "cipher", 200);
    db.store_event_flagged(&wrap, true).await.unwrap();
    let wrap_filter = filt(serde_json::json!({ "kinds": [1059], "#p": [bob.pubkey] }));
    let ctx = |authed: Option<&'static str>, all: bool| ReadCtx { authed, serve_all_wraps: all, serve_all_reports: all, serve_all_spaces: all, now: 300 };
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
        .query_events_ctx(&exp_filter, &ReadCtx { authed: None, serve_all_wraps: false, serve_all_reports: false, serve_all_spaces: false, now: 400 })
        .await
        .unwrap()
        .len();
    let expired_swept = db.delete_expired(400).await.unwrap();

    // --- space-scoped events: the ingest role reads every space's h-only
    //     events without membership; a visibility-tagged one stays closed to it ---
    let chat = sign_event(alice, 9, vec![vec!["h".into(), "g1".into()]], "hi", 201);
    db.store_event(&chat).await.unwrap();
    let private_track = sign_event(
        alice,
        31683,
        vec![
            vec!["d".into(), "t".into()],
            vec!["title".into(), "T".into()],
            vec!["h".into(), "g1".into()],
            vec!["visibility".into(), "private".into()],
        ],
        "",
        202,
    );
    db.store_event(&private_track).await.unwrap();
    let space_filter = filt(serde_json::json!({ "#h": ["g1"] }));
    let alice_pk: &'static str = Box::leak(alice.pubkey.clone().into_boxed_str());
    let space_anon_count = db.query_events_ctx(&space_filter, &ctx(None, false)).await.unwrap().len();
    let space_stranger_count = db.query_events_ctx(&space_filter, &ctx(Some(carol_pk), false)).await.unwrap().len();
    let space_author_count = db.query_events_ctx(&space_filter, &ctx(Some(alice_pk), false)).await.unwrap().len();
    let space_ingest: Vec<String> = db
        .query_events_ctx(&space_filter, &ctx(Some(carol_pk), true))
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.id)
        .collect();
    let space_ingest_count = space_ingest.len();
    let space_ingest_sees_only_chat = space_ingest == vec![chat.id.clone()];

    Obs {
        inserted_first,
        inserted_dup,
        inserted_second,
        by_id_count: by_id.len(),
        by_author_count: by_author.len(),
        by_kind_ids_newest_first: by_kind.iter().map(|e| e.id.clone()).collect(),
        tie_lower_replaces_higher,
        tie_higher_refused_after_lower,
        tie_survivor_is_lowest,
        dless_addressable_count,
        group_created,
        group_recreated,
        recreate_made_bob_admin,
        admin_alice,
        member_alice_native,
        members_after_create,
        members_after_add,
        group_has_bob,
        unified_member_alice,
        members_of_alice_has_g1,
        any_private_default,
        private_lists_anon,
        private_lists_stranger,
        private_lists_member,
        private_meta_anon,
        public_lists_anon,
        members_after_remove,
        group_has_bob_after_remove,
        existed_before_delete,
        exists_after_delete,
        deleted_is_flagged,
        deleted_reinsert,
        deleted_reinsert_row,
        other_is_flagged,
        deleted_address_old_inserted,
        deleted_address_new_inserted,
        wrap_anon_count,
        wrap_recipient_count,
        wrap_stranger_count,
        wrap_ingest_count,
        wrap_self_published,
        wrap_ids_for_neg,
        expiring_visible_before,
        expiring_visible_after,
        expired_swept,
        space_anon_count,
        space_stranger_count,
        space_author_count,
        space_ingest_count,
        space_ingest_sees_only_chat,
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
        tie_lower_replaces_higher: true,
        tie_higher_refused_after_lower: false,
        tie_survivor_is_lowest: true,
        dless_addressable_count: 1,
        group_created: true,
        group_recreated: false,
        recreate_made_bob_admin: false,
        admin_alice: true,
        member_alice_native: true,
        members_after_create: vec![alice.pubkey.clone()],
        members_after_add: sorted(vec![alice.pubkey.clone(), bob.pubkey.clone()]),
        group_has_bob: true,
        unified_member_alice: true,
        members_of_alice_has_g1: true,
        any_private_default: false,
        private_lists_anon: vec![],
        private_lists_stranger: vec![],
        private_lists_member: vec!["39001".into(), "39002".into()],
        private_meta_anon: vec!["39000".into()],
        public_lists_anon: vec!["39001".into(), "39002".into()],
        members_after_remove: vec![alice.pubkey.clone()],
        group_has_bob_after_remove: false,
        existed_before_delete: true,
        exists_after_delete: false,
        deleted_is_flagged: true,
        deleted_reinsert: false,
        deleted_reinsert_row: false,
        other_is_flagged: false,
        deleted_address_old_inserted: false,
        deleted_address_new_inserted: true,
        wrap_anon_count: 0,
        wrap_recipient_count: 1,
        wrap_stranger_count: 0,
        wrap_ingest_count: 1,
        wrap_self_published: true,
        wrap_ids_for_neg: 1,
        expiring_visible_before: 1,
        expiring_visible_after: 0,
        expired_swept: 1,
        space_anon_count: 0,
        space_stranger_count: 0,
        space_author_count: 2,
        space_ingest_count: 1,
        space_ingest_sees_only_chat: true,
    }
}

#[tokio::test]
async fn sqlite_matches_expected_and_postgres() {
    let _serial = SERIAL.lock().await;
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

/// What a relay-native group admin's 9005s did, in order (see
/// `mod_delete_scope`). `(accepted, target still stored)` per attempt.
type ScopeObs = Vec<(bool, bool)>;

/// Kind-9005 scope (relay-native semantics, the only kind the embedded relay
/// has): a group admin may delete their group's events and nothing else.
async fn mod_delete_scope(db: &Db, alice: &TestIdentity, bob: &TestIdentity) -> ScopeObs {
    use thewired_relay::nostr::nip29::moderation::handle_delete_event;

    db.create_group("g-scope", "Scope", &alice.pubkey).await.unwrap();
    db.create_group("g-other", "Other", &bob.pubkey).await.unwrap();
    let h = |g: &str| vec![vec!["h".to_string(), g.to_string()]];
    let in_group = sign_event(bob, 9, h("g-scope"), "in scope", 500);
    let other_group = sign_event(bob, 9, h("g-other"), "other group", 501);
    let note = sign_event(bob, 1, vec![], "public note", 502);
    for e in [&in_group, &other_group, &note] {
        db.store_event(e).await.unwrap();
    }

    let mut obs = Vec::new();
    let attempts: [(&TestIdentity, Vec<&str>); 5] = [
        (alice, vec![&note.id]),                    // not in any group
        (alice, vec![&other_group.id]),             // another group
        (alice, vec![&in_group.id, &note.id]),      // mixed → all-or-nothing
        (bob, vec![&in_group.id]),                  // not an admin of g-scope
        (alice, vec![&in_group.id]),                // the legitimate delete
    ];
    for (i, (who, targets)) in attempts.iter().enumerate() {
        let mut tags = h("g-scope");
        tags.extend(targets.iter().map(|id| vec!["e".to_string(), id.to_string()]));
        let del = sign_event(who, 9005, tags, &format!("attempt {i}"), 600 + i as i64);
        let reply = handle_delete_event(db, &del).await.unwrap();
        let frame: serde_json::Value = serde_json::from_str(&reply[0]).unwrap();
        let accepted = frame.get(2).and_then(|v| v.as_bool()).unwrap_or(false);
        let still_there = db.get_event_by_id(targets[0]).await.unwrap().is_some();
        obs.push((accepted, still_there));
    }
    obs
}

#[tokio::test]
async fn mod_delete_scope_matches_across_backends() {
    let _serial = SERIAL.lock().await;
    let alice = TestIdentity::from_seed(1);
    let bob = TestIdentity::from_seed(2);
    let want: ScopeObs = vec![(false, true), (false, true), (false, true), (false, true), (true, false)];

    let sqlite_db = Db::Sqlite(sqlite::connect_memory().await.unwrap());
    let sqlite_obs = mod_delete_scope(&sqlite_db, &alice, &bob).await;
    assert_eq!(sqlite_obs, want, "SQLite: 9005 scope diverged from expected");

    match common::setup_test_pool().await {
        Ok(pool) => {
            let pg_obs = mod_delete_scope(&Db::Pg(pool), &alice, &bob).await;
            assert_eq!(pg_obs, sqlite_obs, "Postgres and SQLite disagree on 9005 scope");
        }
        Err(e) => eprintln!("⚠ skipping Postgres arm of the 9005 scope parity test: {e}"),
    }
}
