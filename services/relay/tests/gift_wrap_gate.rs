//! DM wire contract §7 on the Postgres backend: the kind-1059 AUTH gate on the
//! stored-query path, the self-wrap flag, NIP-40 expiration, and a full NIP-77
//! negentropy round trip driven through `handle_message`.
//!
//! Needs the test Postgres (`pnpm dev:infra`); skips with a warning otherwise.

mod common;

use common::{make_app_state_with, setup_test_pool, sign_event, TestIdentity};
use std::collections::HashSet;
use std::sync::Arc;
use thewired_relay::config::Config;
use thewired_relay::nostr::event::Event;
use thewired_relay::nostr::filter::Filter;
use thewired_relay::nostr::wrap_gate::{ReadCtx, WrapAuthGate};
use thewired_relay::protocol::handler::handle_message;
use thewired_relay::protocol::subscription::SubscriptionManager;
use thewired_relay::server::AppState;
use tokio::sync::{broadcast, Mutex};

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

    async fn send(
        &mut self,
        state: &Arc<AppState>,
        tx: &broadcast::Sender<Event>,
        msg: &str,
    ) -> Vec<serde_json::Value> {
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

#[tokio::test]
async fn anonymous_req_for_wraps_is_closed_auth_required() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |_| {});
    let bob = TestIdentity::from_seed(2);
    let mut publisher = Conn::new(None);
    publish(&state, &tx, &mut publisher, &wrap_for(&bob.pubkey, 10, now(), vec![])).await;

    let mut anon = Conn::new(None);
    let frames = anon
        .send(&state, &tx, &format!(r##"["REQ","s1",{{"kinds":[1059],"#p":["{}"]}}]"##, bob.pubkey))
        .await;
    assert_eq!(frames.len(), 1, "{frames:?}");
    assert_eq!(frame_type(&frames[0]), "CLOSED");
    assert!(frames[0][2].as_str().unwrap().starts_with("auth-required:"), "{frames:?}");
}

#[tokio::test]
async fn anonymous_req_without_kinds_silently_excludes_wraps() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |_| {});
    let alice = TestIdentity::from_seed(1);
    let bob = TestIdentity::from_seed(2);
    let mut publisher = Conn::new(None);
    let wrap = wrap_for(&bob.pubkey, 10, now(), vec![]);
    publish(&state, &tx, &mut publisher, &wrap).await;
    let note = sign_event(&alice, 1, vec![vec!["p".into(), bob.pubkey.clone()]], "hi bob", now());
    publish(&state, &tx, &mut publisher, &note).await;

    let mut anon = Conn::new(None);
    let frames = anon
        .send(&state, &tx, &format!(r##"["REQ","s1",{{"#p":["{}"]}}]"##, bob.pubkey))
        .await;
    let ids = event_ids(&frames);
    assert_eq!(ids, vec![note.id.clone()], "wrap leaked to an anonymous #p query: {frames:?}");
    assert_eq!(frame_type(frames.last().unwrap()), "EOSE");
}

#[tokio::test]
async fn wraps_served_only_to_authenticated_recipient_or_ingest() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let backend = TestIdentity::from_seed(9);
    let (state, tx) = make_app_state_with(pool, |c: &mut Config| {
        c.ingest_pubkeys = vec![backend.pubkey.clone()];
    });
    let bob = TestIdentity::from_seed(2);
    let carol = TestIdentity::from_seed(3);
    let mut publisher = Conn::new(None);
    let wrap = wrap_for(&bob.pubkey, 10, now(), vec![]);
    publish(&state, &tx, &mut publisher, &wrap).await;

    let req = format!(r##"["REQ","s1",{{"kinds":[1059],"#p":["{}"]}}]"##, bob.pubkey);

    let mut as_bob = Conn::new(Some(&bob.pubkey));
    assert_eq!(event_ids(&as_bob.send(&state, &tx, &req).await), vec![wrap.id.clone()]);

    let mut as_carol = Conn::new(Some(&carol.pubkey));
    let frames = as_carol.send(&state, &tx, &req).await;
    assert!(event_ids(&frames).is_empty(), "stranger received bob's wrap: {frames:?}");
    assert_eq!(frame_type(&frames[0]), "EOSE");

    // The ingest role reads every wrap (metadata only — content is opaque).
    let mut as_backend = Conn::new(Some(&backend.pubkey));
    let all = format!(r#"["REQ","s2",{{"kinds":[1059]}}]"#);
    assert_eq!(event_ids(&as_backend.send(&state, &tx, &all).await), vec![wrap.id.clone()]);
}

#[tokio::test]
async fn warn_mode_serves_wraps_to_anonymous_but_enforce_does_not() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |c: &mut Config| c.wrap_auth_gate = WrapAuthGate::Warn);
    let bob = TestIdentity::from_seed(2);
    let mut publisher = Conn::new(None);
    let wrap = wrap_for(&bob.pubkey, 10, now(), vec![]);
    publish(&state, &tx, &mut publisher, &wrap).await;
    let mut anon = Conn::new(None);
    let frames = anon
        .send(&state, &tx, &format!(r##"["REQ","s1",{{"kinds":[1059],"#p":["{}"]}}]"##, bob.pubkey))
        .await;
    assert_eq!(event_ids(&frames), vec![wrap.id.clone()], "warn mode must keep serving: {frames:?}");
}

#[tokio::test]
async fn self_wrap_is_flagged_only_when_published_by_its_recipient() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |_| {});
    let alice = TestIdentity::from_seed(1);
    let bob = TestIdentity::from_seed(2);

    // Alice's self-wrap, published over a socket authenticated as alice.
    let self_wrap = wrap_for(&alice.pubkey, 11, now(), vec![]);
    let mut as_alice = Conn::new(Some(&alice.pubkey));
    let ok = publish(&state, &tx, &mut as_alice, &self_wrap).await;
    assert_eq!(ok[2], true, "{ok}");
    assert!(state.pool.is_self_published(&self_wrap.id).await.unwrap());

    // The recipient wrap (p = bob) from the same socket is NOT a self-wrap.
    let to_bob = wrap_for(&bob.pubkey, 12, now(), vec![]);
    publish(&state, &tx, &mut as_alice, &to_bob).await;
    assert!(!state.pool.is_self_published(&to_bob.id).await.unwrap());

    // A wrap for alice published anonymously (pre-AUTH) is not flagged either.
    let anon_wrap = wrap_for(&alice.pubkey, 13, now(), vec![]);
    let mut anon = Conn::new(None);
    publish(&state, &tx, &mut anon, &anon_wrap).await;
    assert!(!state.pool.is_self_published(&anon_wrap.id).await.unwrap());
}

#[tokio::test]
async fn expired_events_are_rejected_hidden_and_swept() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |_| {});
    let alice = TestIdentity::from_seed(1);
    let mut conn = Conn::new(None);

    // Already expired on receipt → rejected.
    let stale = sign_event(&alice, 1, vec![vec!["expiration".into(), (now() - 10).to_string()]], "old", now());
    let ok = publish(&state, &tx, &mut conn, &stale).await;
    assert_eq!(ok[2], false, "{ok}");
    assert!(ok[3].as_str().unwrap().contains("expired"), "{ok}");

    // Expires in the future → stored and served now, hidden once "now" passes it.
    let exp = now() + 60;
    let live = sign_event(&alice, 1, vec![vec!["expiration".into(), exp.to_string()]], "soon", now());
    let ok = publish(&state, &tx, &mut conn, &live).await;
    assert_eq!(ok[2], true, "{ok}");
    let filter: Filter = serde_json::from_str(&format!(r#"{{"ids":["{}"]}}"#, live.id)).unwrap();
    let before = state
        .pool
        .query_events_ctx(&filter, &ReadCtx { authed: None, serve_all_wraps: false, now: exp - 1 })
        .await
        .unwrap();
    assert_eq!(before.len(), 1);
    let after = state
        .pool
        .query_events_ctx(&filter, &ReadCtx { authed: None, serve_all_wraps: false, now: exp })
        .await
        .unwrap();
    assert!(after.is_empty(), "expired event still served");

    // The sweeper deletes it.
    assert_eq!(state.pool.delete_expired(exp).await.unwrap(), 1);
    assert!(state.pool.get_event_by_id(&live.id).await.unwrap().is_none());
}

#[tokio::test]
async fn negentropy_round_trip_reports_need_and_have() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |_| {});
    let bob = TestIdentity::from_seed(2);
    let mut publisher = Conn::new(None);
    let base = now() - 1000;
    let w1 = wrap_for(&bob.pubkey, 20, base + 1, vec![]);
    let w2 = wrap_for(&bob.pubkey, 21, base + 2, vec![]);
    let w3 = wrap_for(&bob.pubkey, 22, base + 3, vec![]);
    for w in [&w1, &w2, &w3] {
        publish(&state, &tx, &mut publisher, w).await;
    }

    // The client (bob) holds w1 plus one wrap the relay never saw.
    let local_only = wrap_for(&bob.pubkey, 23, base + 4, vec![]);
    let mut client_storage = negentropy::NegentropyStorageVector::new();
    for w in [&w1, &local_only] {
        client_storage
            .insert(w.created_at as u64, negentropy::Id::from_slice(&hex::decode(&w.id).unwrap()).unwrap())
            .unwrap();
    }
    client_storage.seal().unwrap();
    let mut client = negentropy::Negentropy::borrowed(&client_storage, 60_000).unwrap();
    let initial = client.initiate().unwrap();

    let mut as_bob = Conn::new(Some(&bob.pubkey));
    let filter = format!(r##"{{"kinds":[1059],"#p":["{}"]}}"##, bob.pubkey);
    let mut frames = as_bob
        .send(&state, &tx, &format!(r#"["NEG-OPEN","n1",{},"{}"]"#, filter, hex::encode(&initial)))
        .await;

    let mut have: Vec<negentropy::Id> = Vec::new();
    let mut need: Vec<negentropy::Id> = Vec::new();
    for _round in 0..8 {
        assert_eq!(frames.len(), 1, "{frames:?}");
        assert_eq!(frame_type(&frames[0]), "NEG-MSG", "{frames:?}");
        let msg = hex::decode(frames[0][2].as_str().unwrap()).unwrap();
        match client.reconcile_with_ids(&msg, &mut have, &mut need).unwrap() {
            None => break,
            Some(next) => {
                frames = as_bob
                    .send(&state, &tx, &format!(r#"["NEG-MSG","n1","{}"]"#, hex::encode(next)))
                    .await;
            }
        }
    }
    let hex_ids = |v: &Vec<negentropy::Id>| {
        let mut out: Vec<String> = v.iter().map(|i| hex::encode(i.as_ref())).collect();
        out.sort();
        out
    };
    let mut expected_need = vec![w2.id.clone(), w3.id.clone()];
    expected_need.sort();
    assert_eq!(hex_ids(&need), expected_need, "relay-only wraps must be reported as need");
    assert_eq!(hex_ids(&have), vec![local_only.id.clone()], "client-only wrap must be reported as have");

    let closed = as_bob.send(&state, &tx, r#"["NEG-CLOSE","n1"]"#).await;
    assert!(closed.is_empty());
    let after = as_bob.send(&state, &tx, r#"["NEG-MSG","n1","61"]"#).await;
    assert_eq!(frame_type(&after[0]), "NEG-ERR");
}

#[tokio::test]
async fn negentropy_for_wraps_requires_auth() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |_| {});
    let bob = TestIdentity::from_seed(2);
    let mut anon = Conn::new(None);
    let frames = anon
        .send(&state, &tx, &format!(r##"["NEG-OPEN","n1",{{"kinds":[1059],"#p":["{}"]}},"61"]"##, bob.pubkey))
        .await;
    assert_eq!(frame_type(&frames[0]), "NEG-ERR");
    assert!(frames[0][2].as_str().unwrap().contains("auth-required"), "{frames:?}");
}
