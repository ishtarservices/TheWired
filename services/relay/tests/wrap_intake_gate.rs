//! Kind-1059 intake gate (`RELAY_WRAP_INTAKE_GATE`) on the Postgres backend,
//! driven through `handle_message`: the three modes, the kind-10050 /
//! kind-10002 admission rules, replaceable-event edge cases, deletion, and
//! the abuse cases (lookalike URLs, forged recipient tags, recipient caps,
//! pre-AUTH publishing, the ingest role). The pure decision has its own unit
//! tests in `nostr::wrap_gate`; the read-side AUTH gate, self-wrap flag,
//! NIP-40 and NIP-77 regressions live in `gift_wrap_gate.rs`.
//!
//! Needs the test Postgres (`pnpm dev:infra`); skips with a warning otherwise.

mod common;

use common::{make_app_state_with, setup_test_pool, sign_event, TestIdentity};
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use thewired_relay::config::Config;
use thewired_relay::db::dm_relay_list;
use thewired_relay::nostr::event::Event;
use thewired_relay::nostr::wrap_gate::{
    IntakeRefuse, WrapIntakeGate, KIND_DM_RELAY_LIST, KIND_RELAY_LIST, MAX_WRAP_RECIPIENTS,
    WRAP_INTAKE_BLOCKED_PREFIX,
};
use thewired_relay::protocol::handler::handle_message;
use thewired_relay::protocol::subscription::SubscriptionManager;
use thewired_relay::server::AppState;
use tokio::sync::{broadcast, Mutex};

/// The test relay's own URL (`make_app_state_with`), and other spellings of
/// it a client might write into a kind 10050.
const RELAY: &str = "ws://localhost:7777";
const RELAY_SPELLINGS: [&str; 4] = ["ws://localhost:7777", "WS://LOCALHOST:7777/", "ws://127.0.0.1:7777", "ws://[::1]:7777/"];

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// A kind-1059 wrap addressed to `recipient`, signed by a throwaway key.
fn wrap_for(recipient: &str, seed: u8, created_at: i64, extra: Vec<Vec<String>>) -> Event {
    let ephemeral = TestIdentity::from_seed(seed);
    let mut tags = vec![vec!["p".to_string(), recipient.to_string()]];
    tags.extend(extra);
    sign_event(&ephemeral, 1059, tags, "ciphertext", created_at)
}

struct Conn {
    subs: Arc<Mutex<SubscriptionManager>>,
    authed: Option<String>,
    memberships: HashSet<String>,
}

impl Conn {
    fn new(authed: Option<&str>) -> Self {
        Conn {
            subs: Arc::new(Mutex::new(SubscriptionManager::new())),
            authed: authed.map(str::to_string),
            memberships: HashSet::new(),
        }
    }

    async fn send(&mut self, state: &Arc<AppState>, tx: &broadcast::Sender<Event>, msg: &str) -> Vec<serde_json::Value> {
        handle_message(msg, state, &self.subs, &mut self.authed, &mut self.memberships, "c", tx)
            .await
            .into_iter()
            .map(|r| serde_json::from_str(&r).expect("json frame"))
            .collect()
    }
}

fn frame_type(v: &serde_json::Value) -> &str {
    v.get(0).and_then(|x| x.as_str()).unwrap_or("")
}

fn event_ids(frames: &[serde_json::Value]) -> Vec<String> {
    frames
        .iter()
        .filter(|f| frame_type(f) == "EVENT")
        .filter_map(|f| f.get(2).and_then(|e| e.get("id")).and_then(|v| v.as_str()).map(String::from))
        .collect()
}

async fn publish(state: &Arc<AppState>, tx: &broadcast::Sender<Event>, conn: &mut Conn, ev: &Event) -> serde_json::Value {
    let msg = format!(r#"["EVENT",{}]"#, serde_json::to_string(ev).unwrap());
    conn.send(state, tx, &msg).await.into_iter().next().expect("OK frame")
}

/// Publish `who`'s kind-10050 (`relay` tags) or kind-10002 (`r` tags).
async fn publish_list(state: &Arc<AppState>, tx: &broadcast::Sender<Event>, who: &TestIdentity, kind: i32, relays: &[&str], created_at: i64) -> (Event, serde_json::Value) {
    let tag = if kind == KIND_DM_RELAY_LIST { "relay" } else { "r" };
    let tags = relays.iter().map(|r| vec![tag.to_string(), r.to_string()]).collect();
    let list = sign_event(who, kind, tags, "", created_at);
    let mut conn = Conn::new(Some(&who.pubkey));
    let ok = publish(state, tx, &mut conn, &list).await;
    (list, ok)
}

async fn stored(state: &Arc<AppState>, id: &str) -> bool {
    state.pool.get_event_by_id(id).await.unwrap().is_some()
}

fn counters(state: &AppState) -> (u64, u64) {
    (
        state.metrics.wrap_intake_refused.load(Ordering::Relaxed),
        state.metrics.wrap_intake_would_refuse.load(Ordering::Relaxed),
    )
}

fn assert_blocked(ok: &serde_json::Value, why: IntakeRefuse) {
    assert_eq!(ok[2], false, "{ok}");
    let reason = ok[3].as_str().unwrap();
    assert!(reason.starts_with(WRAP_INTAKE_BLOCKED_PREFIX), "{ok}");
    assert_eq!(reason, why.message(), "{ok}");
}

fn enforce(c: &mut Config) {
    c.wrap_intake_gate = WrapIntakeGate::Enforce;
}

// ── admission rules ─────────────────────────────────────────────────────

#[tokio::test]
async fn enforce_stores_when_a_recipient_10050_names_this_relay_in_any_spelling() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let mut anon = Conn::new(None);
    for (i, spelling) in RELAY_SPELLINGS.iter().enumerate() {
        let user = TestIdentity::from_seed(20 + i as u8);
        let (_, ok) = publish_list(&state, &tx, &user, KIND_DM_RELAY_LIST, &["wss://nos.lol", spelling], now()).await;
        assert_eq!(ok[2], true, "{ok}");
        let wrap = wrap_for(&user.pubkey, 100 + i as u8, now(), vec![]);
        let ok = publish(&state, &tx, &mut anon, &wrap).await;
        assert_eq!(ok[2], true, "{spelling}: {ok}");
        assert!(stored(&state, &wrap.id).await, "{spelling}");
    }
    assert_eq!(counters(&state), (0, 0), "accepted wraps are not counted");
}

#[tokio::test]
async fn enforce_stores_when_the_recipient_has_only_a_10002_here() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let bob = TestIdentity::from_seed(2);
    // The 10002 need not even name this relay: its presence here says the
    // account logged in through our apps (both publish 10002 + 10050 here).
    let (_, ok) = publish_list(&state, &tx, &bob, KIND_RELAY_LIST, &["wss://nos.lol"], now()).await;
    assert_eq!(ok[2], true, "{ok}");
    let mut anon = Conn::new(None);
    let wrap = wrap_for(&bob.pubkey, 110, now(), vec![]);
    let ok = publish(&state, &tx, &mut anon, &wrap).await;
    assert_eq!(ok[2], true, "{ok}");
    assert!(stored(&state, &wrap.id).await);
}

#[tokio::test]
async fn multi_recipient_wrap_is_admitted_by_any_qualifying_recipient() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let bob = TestIdentity::from_seed(2);
    let carol = TestIdentity::from_seed(3);
    let dave = TestIdentity::from_seed(4);
    publish_list(&state, &tx, &dave, KIND_DM_RELAY_LIST, &[RELAY], now()).await;
    let mut anon = Conn::new(None);
    // dave is the LAST p tag; bob and carol have nothing here.
    let wrap = wrap_for(&bob.pubkey, 120, now(), vec![vec!["p".into(), carol.pubkey.clone()], vec!["p".into(), dave.pubkey.clone()]]);
    let ok = publish(&state, &tx, &mut anon, &wrap).await;
    assert_eq!(ok[2], true, "{ok}");
    // Without dave, nobody qualifies.
    let wrap = wrap_for(&bob.pubkey, 121, now(), vec![vec!["p".into(), carol.pubkey.clone()]]);
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap).await, IntakeRefuse::NoListHere);
    assert!(!stored(&state, &wrap.id).await);
}

// ── modes ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn enforce_refuses_with_blocked_prefix_stores_nothing_and_counts() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let bob = TestIdentity::from_seed(2);
    let carol = TestIdentity::from_seed(3);
    // carol's 10050 names other relays only; bob has nothing.
    publish_list(&state, &tx, &carol, KIND_DM_RELAY_LIST, &["wss://nos.lol", "wss://relay.damus.io"], now()).await;
    let mut anon = Conn::new(None);

    let wrap = wrap_for(&bob.pubkey, 130, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap).await, IntakeRefuse::NoListHere);
    assert!(!stored(&state, &wrap.id).await, "refused wrap must not be stored");

    let wrap = wrap_for(&carol.pubkey, 131, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap).await, IntakeRefuse::ListExcludesThisRelay);
    assert!(!stored(&state, &wrap.id).await);

    // A refused wrap also never reaches live subscribers.
    let mut as_bob = Conn::new(Some(&bob.pubkey));
    let frames = as_bob.send(&state, &tx, &format!(r##"["REQ","s1",{{"kinds":[1059],"#p":["{}"]}}]"##, bob.pubkey)).await;
    assert!(event_ids(&frames).is_empty(), "{frames:?}");

    // Non-wraps are untouched by the intake gate.
    let note = sign_event(&carol, 1, vec![vec!["p".into(), bob.pubkey.clone()]], "hi", now());
    assert_eq!(publish(&state, &tx, &mut anon, &note).await[2], true);

    assert_eq!(counters(&state), (2, 0));
}

#[tokio::test]
async fn warn_stores_everything_and_counts_what_enforce_would_refuse() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |c| c.wrap_intake_gate = WrapIntakeGate::Warn);
    assert_eq!(Config::default().wrap_intake_gate, WrapIntakeGate::Warn, "warn is the default");
    let bob = TestIdentity::from_seed(2);
    let carol = TestIdentity::from_seed(3);
    publish_list(&state, &tx, &carol, KIND_DM_RELAY_LIST, &[RELAY], now()).await;
    let mut anon = Conn::new(None);

    let unlisted = wrap_for(&bob.pubkey, 140, now(), vec![]);
    let ok = publish(&state, &tx, &mut anon, &unlisted).await;
    assert_eq!(ok[2], true, "{ok}");
    assert!(stored(&state, &unlisted.id).await);
    assert_eq!(counters(&state), (0, 1));

    let listed = wrap_for(&carol.pubkey, 141, now(), vec![]);
    assert_eq!(publish(&state, &tx, &mut anon, &listed).await[2], true);
    assert_eq!(counters(&state), (0, 1), "an admitted wrap is not a would-refuse");

    let again = wrap_for(&bob.pubkey, 142, now(), vec![]);
    assert_eq!(publish(&state, &tx, &mut anon, &again).await[2], true);
    assert_eq!(counters(&state), (0, 2));
}

#[tokio::test]
async fn off_stores_everything_without_counting() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |c| c.wrap_intake_gate = WrapIntakeGate::Off);
    let bob = TestIdentity::from_seed(2);
    let mut anon = Conn::new(None);
    let wrap = wrap_for(&bob.pubkey, 150, now(), vec![]);
    assert_eq!(publish(&state, &tx, &mut anon, &wrap).await[2], true);
    assert!(stored(&state, &wrap.id).await);
    let orphan = sign_event(&TestIdentity::from_seed(151), 1059, vec![], "c", now());
    assert_eq!(publish(&state, &tx, &mut anon, &orphan).await[2], true, "off stores even a recipient-less wrap, as before");
    assert_eq!(counters(&state), (0, 0));
}

// ── self-wraps and AUTH ─────────────────────────────────────────────────

#[tokio::test]
async fn self_wrap_by_the_authenticated_recipient_stores_in_every_mode() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let alice = TestIdentity::from_seed(1);
    for gate in [WrapIntakeGate::Enforce, WrapIntakeGate::Warn, WrapIntakeGate::Off] {
        let (state, tx) = make_app_state_with(pool.clone(), move |c| c.wrap_intake_gate = gate);
        // No list of any kind anywhere: alice's own copy still lands on her AUTH.
        let mut as_alice = Conn::new(Some(&alice.pubkey));
        let self_wrap = wrap_for(&alice.pubkey, 160 + gate as u8, now(), vec![]);
        let ok = publish(&state, &tx, &mut as_alice, &self_wrap).await;
        assert_eq!(ok[2], true, "{gate:?}: {ok}");
        assert!(stored(&state, &self_wrap.id).await, "{gate:?}");
        assert!(state.pool.is_self_published(&self_wrap.id).await.unwrap(), "{gate:?}");
        assert_eq!(counters(&state), (0, 0), "{gate:?}");
    }
}

#[tokio::test]
async fn publishing_before_auth_completes_does_not_bypass_the_gate() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let alice = TestIdentity::from_seed(1);
    let bob = TestIdentity::from_seed(2);

    // Same socket, before AUTH: alice's own wrap is just an anonymous wrap
    // for an account with no list here.
    let mut conn = Conn::new(None);
    let early = wrap_for(&alice.pubkey, 170, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut conn, &early).await, IntakeRefuse::NoListHere);
    assert!(!stored(&state, &early.id).await);

    // After AUTH as alice the self-wrap lands…
    conn.authed = Some(alice.pubkey.clone());
    let late = wrap_for(&alice.pubkey, 171, now(), vec![]);
    assert_eq!(publish(&state, &tx, &mut conn, &late).await[2], true);
    // …but her AUTH does nothing for a wrap addressed to bob.
    let to_bob = wrap_for(&bob.pubkey, 172, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut conn, &to_bob).await, IntakeRefuse::NoListHere);
    assert!(!stored(&state, &to_bob.id).await);
}

#[tokio::test]
async fn ingest_role_reads_admitted_wraps_but_gets_no_write_privilege() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let backend = TestIdentity::from_seed(9);
    let (state, tx) = make_app_state_with(pool, |c| {
        c.wrap_intake_gate = WrapIntakeGate::Enforce;
        c.ingest_pubkeys = vec![backend.pubkey.clone()];
    });
    let bob = TestIdentity::from_seed(2);
    let carol = TestIdentity::from_seed(3);
    publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &[RELAY], now()).await;
    let mut anon = Conn::new(None);
    let wrap = wrap_for(&bob.pubkey, 180, now(), vec![]);
    assert_eq!(publish(&state, &tx, &mut anon, &wrap).await[2], true);

    // The push planner still sees every stored wrap.
    let mut as_backend = Conn::new(Some(&backend.pubkey));
    let frames = as_backend.send(&state, &tx, r#"["REQ","s2",{"kinds":[1059]}]"#).await;
    assert_eq!(event_ids(&frames), vec![wrap.id.clone()], "{frames:?}");

    // The ingest role is a READ role: a wrap it publishes for an unlisted
    // recipient is refused like anyone else's.
    let foreign = wrap_for(&carol.pubkey, 181, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut as_backend, &foreign).await, IntakeRefuse::NoListHere);
}

// ── replaceable-event edge cases ────────────────────────────────────────

#[tokio::test]
async fn newer_10050_without_this_relay_revokes_and_an_older_one_does_not_resurrect() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let bob = TestIdentity::from_seed(2);
    let mut anon = Conn::new(None);
    let t = now() - 100;

    publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &[RELAY], t).await;
    assert_eq!(publish(&state, &tx, &mut anon, &wrap_for(&bob.pubkey, 190, now(), vec![])).await[2], true);

    // Bob saves a newer list without us: refused from the very next wrap (no
    // cache, so no stale-accept window at all).
    let (_, ok) = publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &["wss://nos.lol"], t + 1).await;
    assert_eq!(ok[2], true, "{ok}");
    let wrap = wrap_for(&bob.pubkey, 191, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap).await, IntakeRefuse::ListExcludesThisRelay);
    assert!(!stored(&state, &wrap.id).await);

    // A stale (older created_at) list naming us arrives late: superseded,
    // not stored, and acceptance does not come back.
    let (old_list, ok) = publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &[RELAY], t - 5).await;
    assert_eq!(ok[2], true, "superseded replaceables are acked, not stored: {ok}");
    assert!(!stored(&state, &old_list.id).await);
    let wrap = wrap_for(&bob.pubkey, 192, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap).await, IntakeRefuse::ListExcludesThisRelay);

    // Bob adds us back in a newer list: accepted again at once.
    publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &["wss://nos.lol", RELAY], t + 2).await;
    assert_eq!(publish(&state, &tx, &mut anon, &wrap_for(&bob.pubkey, 193, now(), vec![])).await[2], true);
}

#[tokio::test]
async fn a_10050_excluding_this_relay_overrides_a_10002_here() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let bob = TestIdentity::from_seed(2);
    let mut anon = Conn::new(None);
    publish_list(&state, &tx, &bob, KIND_RELAY_LIST, &[RELAY], now()).await;
    assert_eq!(publish(&state, &tx, &mut anon, &wrap_for(&bob.pubkey, 200, now(), vec![])).await[2], true);
    // The user deliberately saves a DM relay list without us.
    publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &["wss://nos.lol"], now()).await;
    let wrap = wrap_for(&bob.pubkey, 201, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap).await, IntakeRefuse::ListExcludesThisRelay);
}

#[tokio::test]
async fn deleting_the_10050_with_a_kind_5_revokes_acceptance() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let bob = TestIdentity::from_seed(2);
    let mut anon = Conn::new(None);
    let (list, _) = publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &[RELAY], now()).await;
    assert_eq!(publish(&state, &tx, &mut anon, &wrap_for(&bob.pubkey, 210, now(), vec![])).await[2], true);

    // NIP-09: bob deletes his own list by id.
    let deletion = sign_event(&bob, 5, vec![vec!["e".into(), list.id.clone()]], "", now());
    let mut as_bob = Conn::new(Some(&bob.pubkey));
    let ok = publish(&state, &tx, &mut as_bob, &deletion).await;
    assert_eq!(ok[2], true, "{ok}");
    assert!(!stored(&state, &list.id).await, "the relay honors kind-5 deletion of a replaceable");

    let wrap = wrap_for(&bob.pubkey, 211, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap).await, IntakeRefuse::NoListHere);
    assert!(!stored(&state, &wrap.id).await);

    // Someone else's kind 5 naming bob's list id changes nothing.
    let (list2, _) = publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &[RELAY], now() + 1).await;
    let mallory = TestIdentity::from_seed(66);
    let forged = sign_event(&mallory, 5, vec![vec!["e".into(), list2.id.clone()]], "", now());
    let mut as_mallory = Conn::new(Some(&mallory.pubkey));
    publish(&state, &tx, &mut as_mallory, &forged).await;
    assert!(stored(&state, &list2.id).await);
    assert_eq!(publish(&state, &tx, &mut anon, &wrap_for(&bob.pubkey, 212, now(), vec![])).await[2], true);
}

// ── abuse cases ─────────────────────────────────────────────────────────

#[tokio::test]
async fn lookalike_relay_urls_in_a_10050_do_not_admit() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let mut anon = Conn::new(None);
    let lookalikes = [
        "ws://localhost:7777.evil.com",
        "ws://localhost:7777@evil.com",
        "ws://127.0.0.1:7777@evil.com",
        "ws://evil.com/localhost:7777",
        "ws://evil.com?u=ws://localhost:7777",
        "ws://localhost:7778",
        "ws://localhost:7777/inbox",
        "ws://localhost",
        "ws://127.evil.com:7777",
    ];
    for (i, url) in lookalikes.iter().enumerate() {
        let user = TestIdentity::from_seed(30 + i as u8);
        publish_list(&state, &tx, &user, KIND_DM_RELAY_LIST, &["wss://nos.lol", url], now()).await;
        let wrap = wrap_for(&user.pubkey, 220 + i as u8, now(), vec![]);
        let ok = publish(&state, &tx, &mut anon, &wrap).await;
        assert_eq!(ok[2], false, "{url}: {ok}");
        assert_eq!(ok[3].as_str().unwrap(), IntakeRefuse::ListExcludesThisRelay.message(), "{url}");
        assert!(!stored(&state, &wrap.id).await, "{url}");
    }
}

#[tokio::test]
async fn recipient_pubkey_in_a_non_p_tag_does_not_admit() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let bob = TestIdentity::from_seed(2);
    let stranger = TestIdentity::from_seed(5);
    publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &[RELAY], now()).await;
    publish_list(&state, &tx, &bob, KIND_RELAY_LIST, &[RELAY], now()).await;
    let mut anon = Conn::new(None);
    let wrap = wrap_for(
        &stranger.pubkey,
        230,
        now(),
        vec![
            vec!["e".into(), bob.pubkey.clone()],
            vec!["P".into(), bob.pubkey.clone()],
            vec!["recipient".into(), bob.pubkey.clone()],
            vec!["p".into()],
            vec!["p".into(), String::new()],
        ],
    );
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap).await, IntakeRefuse::NoListHere);
    assert!(!stored(&state, &wrap.id).await);
}

#[tokio::test]
async fn wrap_addressed_to_the_relays_own_pubkey_is_refused() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let relay_pubkey = state.relay_identity.pubkey.clone();
    let mut anon = Conn::new(None);
    let wrap = wrap_for(&relay_pubkey, 240, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap).await, IntakeRefuse::NoListHere);
    assert!(!stored(&state, &wrap.id).await);
}

#[tokio::test]
async fn malformed_10050_rows_never_match_and_never_error() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool.clone(), enforce);
    let mut anon = Conn::new(None);

    // Rows a well-behaved relay would never store (no `relay` tags, non-string
    // values, scalar junk inside the array, an `r` tag where NIP-17 says
    // `relay`), inserted straight into the table.
    let cases: [(u8, &str); 5] = [
        (60, r#"[]"#),
        (61, r#"[["r","ws://localhost:7777"]]"#),
        (62, r#"[["relay",123],["relay"],["relay",{"url":"ws://localhost:7777"}],["relay",["ws://localhost:7777"]],["relay",null]]"#),
        (63, r#"["junk",42,null,{"relay":"ws://localhost:7777"}]"#),
        (64, r#"[["relay","wss://nos.lol"],[],[""],["relay"]]"#),
    ];
    for (seed, tags) in cases {
        let user = TestIdentity::from_seed(seed);
        sqlx::query(
            "INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, p_tags, e_tags, h_tags) \
             VALUES ($1, $2, $3, 10050, $4::jsonb, '', $5, '{}', '{}', '{}')",
        )
        .bind(format!("{seed:02x}").repeat(32))
        .bind(&user.pubkey)
        .bind(now())
        .bind(tags)
        .bind("0".repeat(128))
        .execute(&pool)
        .await
        .unwrap();
        let wrap = wrap_for(&user.pubkey, 250 + (seed - 60), now(), vec![]);
        let ok = publish(&state, &tx, &mut anon, &wrap).await;
        assert_eq!(ok[2], false, "{tags}: {ok}");
        assert_eq!(ok[3].as_str().unwrap(), IntakeRefuse::ListExcludesThisRelay.message(), "{tags}: {ok}");
    }
    // A non-array `tags` value is skipped by the lookup rather than erroring.
    let odd = TestIdentity::from_seed(65);
    sqlx::query(
        "INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, p_tags, e_tags, h_tags) \
         VALUES ($1, $2, $3, 10050, '\"ws://localhost:7777\"'::jsonb, '', $4, '{}', '{}', '{}')",
    )
    .bind("65".repeat(32))
    .bind(&odd.pubkey)
    .bind(now())
    .bind("0".repeat(128))
    .execute(&pool)
    .await
    .unwrap();
    let wrap = wrap_for(&odd.pubkey, 199, now(), vec![]);
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap).await, IntakeRefuse::NoListHere);
}

#[tokio::test]
async fn oversized_10050_is_handled_in_linear_time() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let bob = TestIdentity::from_seed(2);
    // 5,000 relay tags with ours last. (A real socket caps the frame size
    // before this; the gate itself must stay linear whatever gets through.)
    let mut relays: Vec<String> = (0..5_000).map(|i| format!("wss://relay{i}.example.com")).collect();
    relays.push(RELAY.to_string());
    let refs: Vec<&str> = relays.iter().map(String::as_str).collect();
    let (_, ok) = publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &refs, now()).await;
    assert_eq!(ok[2], true, "{ok}");
    let mut anon = Conn::new(None);
    let started = std::time::Instant::now();
    let wrap = wrap_for(&bob.pubkey, 1, now(), vec![]);
    assert_eq!(publish(&state, &tx, &mut anon, &wrap).await[2], true);
    assert!(started.elapsed() < std::time::Duration::from_secs(2), "{:?}", started.elapsed());
}

#[tokio::test]
async fn recipient_cap_refuses_over_sixteen_and_sixteen_costs_one_lookup() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool.clone(), enforce);
    let mut anon = Conn::new(None);
    let users: Vec<TestIdentity> = (0..MAX_WRAP_RECIPIENTS as u8 + 1).map(|i| TestIdentity::from_seed(70 + i)).collect();
    // Only the 16th recipient has a list here.
    publish_list(&state, &tx, &users[MAX_WRAP_RECIPIENTS - 1], KIND_DM_RELAY_LIST, &[RELAY], now()).await;

    let p_tags = |n: usize| -> Vec<Vec<String>> {
        users[1..n].iter().map(|u| vec!["p".to_string(), u.pubkey.clone()]).collect()
    };
    // 17 distinct recipients: refused as invalid before any lookup, even
    // though the 16th would qualify.
    let too_many = wrap_for(&users[0].pubkey, 2, now(), p_tags(MAX_WRAP_RECIPIENTS + 1));
    let ok = publish(&state, &tx, &mut anon, &too_many).await;
    assert_eq!(ok[2], false, "{ok}");
    assert_eq!(ok[3].as_str().unwrap(), IntakeRefuse::TooManyRecipients.message());
    assert!(!stored(&state, &too_many.id).await);

    // Exactly 16: admitted through the last one.
    let at_cap = wrap_for(&users[0].pubkey, 3, now(), p_tags(MAX_WRAP_RECIPIENTS));
    assert_eq!(publish(&state, &tx, &mut anon, &at_cap).await[2], true);

    // The lookup behind it is ONE statement for all 16 pubkeys and returns
    // only their rows; there is no per-recipient query to multiply.
    let pubkeys: Vec<String> = users[..MAX_WRAP_RECIPIENTS].iter().map(|u| u.pubkey.clone()).collect();
    let lists = dm_relay_list::relay_lists_for(&pool, &pubkeys).await.unwrap();
    assert_eq!(lists.len(), 1);
    assert_eq!(lists[0].pubkey, users[MAX_WRAP_RECIPIENTS - 1].pubkey);
    assert_eq!(lists[0].kind, KIND_DM_RELAY_LIST);
    assert_eq!(lists[0].relay_urls, vec![RELAY.to_string()]);
    assert!(dm_relay_list::relay_lists_for(&pool, &[]).await.unwrap().is_empty());
}

#[tokio::test]
async fn concurrent_wraps_during_list_replacement_never_panic_and_settle_at_once() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, enforce);
    let bob = TestIdentity::from_seed(2);
    publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &[RELAY], now() - 10).await;

    // 32 anonymous publishers race while bob replaces his list twice.
    let mut tasks = Vec::new();
    for i in 0..32u8 {
        let (state, tx) = (state.clone(), tx.clone());
        let bob_pk = bob.pubkey.clone();
        tasks.push(tokio::spawn(async move {
            let mut conn = Conn::new(None);
            let ok = publish(&state, &tx, &mut conn, &wrap_for(&bob_pk, 100 + i, now(), vec![])).await;
            ok[2].as_bool().unwrap()
        }));
    }
    let (_, ok) = publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &["wss://nos.lol"], now() - 5).await;
    assert_eq!(ok[2], true);
    let (_, ok) = publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &[RELAY], now()).await;
    assert_eq!(ok[2], true);
    for t in tasks {
        // Each racer saw whichever list was current — never a panic or an error frame.
        let _accepted: bool = t.await.expect("publisher task panicked");
    }
    // With the lookup done per wrap there is no cache to go stale: the state
    // right after the last replacement is what the next wrap sees.
    let mut anon = Conn::new(None);
    assert_eq!(publish(&state, &tx, &mut anon, &wrap_for(&bob.pubkey, 200, now(), vec![])).await[2], true);
    publish_list(&state, &tx, &bob, KIND_DM_RELAY_LIST, &["wss://nos.lol"], now() + 1).await;
    assert_blocked(&publish(&state, &tx, &mut anon, &wrap_for(&bob.pubkey, 201, now(), vec![])).await, IntakeRefuse::ListExcludesThisRelay);
}
