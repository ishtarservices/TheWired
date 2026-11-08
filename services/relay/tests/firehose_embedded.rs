//! The firehose policy on the embedded SQLite backend: there is no community
//! there. A personal relay hosts its own groups for the people it admitted,
//! so `RELAY_FIREHOSE_POLICY=community` must change nothing — the refresh
//! yields no set, the live fan-out serves every author, and a stored
//! untargeted REQ returns a member's note to another member as before.
//!
//! Gated to `--features embedded` (it names `Db::Sqlite`).
#![cfg(feature = "embedded")]

mod common;

use common::{sign_event, TestIdentity};
use std::collections::HashSet;
use std::sync::Arc;
use thewired_relay::config::Config;
use thewired_relay::connection::live_matching_subs;
use thewired_relay::db::{sqlite, Db};
use thewired_relay::nostr::event::Event;
use thewired_relay::nostr::filter::Filter;
use thewired_relay::nostr::firehose::FirehosePolicy;
use thewired_relay::protocol::handler::handle_message;
use thewired_relay::protocol::subscription::SubscriptionManager;
use thewired_relay::relay_identity::RelayIdentity;
use thewired_relay::server::AppState;
use tokio::sync::{broadcast, Mutex};

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

async fn embedded_state(owner: &TestIdentity) -> (Arc<AppState>, broadcast::Sender<Event>) {
    let (tx, _) = broadcast::channel::<Event>(64);
    let config = Config {
        firehose_policy: FirehosePolicy::Community,
        rust_env: "test".into(),
        ..Config::default()
    };
    let state = AppState {
        pool: Db::Sqlite(sqlite::connect_memory().await.unwrap()),
        config,
        broadcast_tx: tx.clone(),
        relay_identity: RelayIdentity::new(None, "test"),
        active_connections: std::sync::atomic::AtomicUsize::new(0),
        relay_url: "ws://127.0.0.1:7787".to_string(),
        auth_relay_urls: std::sync::RwLock::new(vec!["ws://127.0.0.1:7787".to_string()]),
        hosted_only: true,
        owner_pubkey: Some(owner.pubkey.clone()),
        ip_conns: std::sync::Mutex::new(Default::default()),
        ip_last_connect: std::sync::Mutex::new(Default::default()),
        metrics: Default::default(),
        shadowed: std::sync::RwLock::new(Default::default()),
        community: std::sync::RwLock::new(None),
    };
    (Arc::new(state), tx)
}

async fn send(state: &Arc<AppState>, tx: &broadcast::Sender<Event>, authed: Option<&str>, msg: &str) -> Vec<serde_json::Value> {
    let subs = Arc::new(Mutex::new(SubscriptionManager::new()));
    let mut authed = authed.map(str::to_string);
    let mut memberships: HashSet<String> = HashSet::new();
    handle_message(msg, state, &subs, &mut authed, &mut memberships, "c", tx)
        .await
        .into_iter()
        .map(|r| serde_json::from_str(&r).unwrap())
        .collect()
}

async fn publish(state: &Arc<AppState>, tx: &broadcast::Sender<Event>, authed: Option<&str>, ev: &Event) -> serde_json::Value {
    let msg = format!(r#"["EVENT",{}]"#, serde_json::to_string(ev).unwrap());
    send(state, tx, authed, &msg).await.into_iter().next().expect("OK frame")
}

#[tokio::test]
async fn embedded_relay_has_no_community_and_serves_everyone() {
    let owner = TestIdentity::from_seed(1);
    let guest = TestIdentity::from_seed(2);
    let (state, tx) = embedded_state(&owner).await;

    // The refresh finds no community on this backend: the set stays "everyone".
    state.refresh_community().await;
    assert!(state.community.read().unwrap().is_none());
    assert!(state.firehose_serves(&guest.pubkey, None));
    assert!(state.firehose_serves(&guest.pubkey, Some(&owner.pubkey)));

    // Live: a firehose subscription receives the guest's note.
    let mut subs = SubscriptionManager::new();
    let fire: Filter = serde_json::from_value(serde_json::json!({"kinds": [1]})).unwrap();
    subs.add("fire".into(), vec![fire]).unwrap();
    let guest_note = sign_event(&guest, 1, vec![vec!["h".into(), "g1".into()]], "hi", now());
    assert_eq!(live_matching_subs(&state, &subs, &guest_note, Some(&owner.pubkey)), vec!["fire"]);

    // Stored: the owner creates a group, admits the guest, and reads the
    // guest's note back through an untargeted kind-1 REQ.
    let create = sign_event(&owner, 9007, vec![vec!["h".into(), "g1".into()]], "", now());
    assert_eq!(publish(&state, &tx, Some(&owner.pubkey), &create).await[2], true);
    let admit = sign_event(
        &owner,
        9000,
        vec![vec!["h".into(), "g1".into()], vec!["p".into(), guest.pubkey.clone()]],
        "",
        now(),
    );
    assert_eq!(publish(&state, &tx, Some(&owner.pubkey), &admit).await[2], true);
    let ok = publish(&state, &tx, Some(&guest.pubkey), &guest_note).await;
    assert_eq!(ok[2], true, "{ok}");

    let frames = send(&state, &tx, Some(&owner.pubkey), r#"["REQ","s",{"kinds":[1]}]"#).await;
    let ids: Vec<&str> = frames.iter().filter(|f| f[0] == "EVENT").filter_map(|f| f[2]["id"].as_str()).collect();
    assert_eq!(ids, vec![guest_note.id.as_str()], "{frames:?}");
}
