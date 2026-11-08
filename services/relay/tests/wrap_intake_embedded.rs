//! The kind-1059 intake gate on the embedded SQLite backend: there is none.
//! A personal relay's own write policy (hosted-only: only events for groups
//! it hosts, plus the owner's own management events) decides what it
//! stores, and the intake gate must neither refuse nor admit anything there,
//! whatever `RELAY_WRAP_INTAKE_GATE` says. Proven by driving the same
//! `handle_message` against `Db::Sqlite` in every gate mode and checking the
//! answer is the hosted-only one, never an intake `blocked:`.
//!
//! Gated to `--features embedded` (it names `Db::Sqlite`).
#![cfg(feature = "embedded")]

mod common;

use common::{sign_event, TestIdentity};
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use thewired_relay::config::Config;
use thewired_relay::db::{sqlite, Db};
use thewired_relay::nostr::event::Event;
use thewired_relay::nostr::wrap_gate::{WrapIntakeGate, WRAP_INTAKE_BLOCKED_PREFIX};
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

/// An embedded-shaped AppState: in-memory SQLite, hosted-only, `owner` may
/// create groups, loopback relay URL.
async fn embedded_state(gate: WrapIntakeGate, owner: &TestIdentity) -> (Arc<AppState>, broadcast::Sender<Event>) {
    let (tx, _) = broadcast::channel::<Event>(64);
    let config = Config { wrap_intake_gate: gate, rust_env: "test".into(), ..Config::default() };
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

async fn publish(state: &Arc<AppState>, tx: &broadcast::Sender<Event>, authed: Option<&str>, ev: &Event) -> serde_json::Value {
    let subs = Arc::new(Mutex::new(SubscriptionManager::new()));
    let mut authed = authed.map(str::to_string);
    let mut memberships: HashSet<String> = HashSet::new();
    let msg = format!(r#"["EVENT",{}]"#, serde_json::to_string(ev).unwrap());
    let frames = handle_message(&msg, state, &subs, &mut authed, &mut memberships, "c", tx).await;
    serde_json::from_str(&frames[0]).unwrap()
}

fn wrap_for(recipient: &str, seed: u8) -> Event {
    sign_event(&TestIdentity::from_seed(seed), 1059, vec![vec!["p".into(), recipient.into()]], "cipher", now())
}

#[tokio::test]
async fn embedded_relay_answers_wraps_the_same_in_every_intake_mode() {
    let alice = TestIdentity::from_seed(7);
    let bob = TestIdentity::from_seed(2);
    let mut answers: Vec<String> = Vec::new();
    for gate in [WrapIntakeGate::Off, WrapIntakeGate::Warn, WrapIntakeGate::Enforce] {
        let (state, tx) = embedded_state(gate, &alice).await;

        // Even a 10050 naming the embedded relay is stored or refused by the
        // hosted-only policy alone; its presence is irrelevant to wraps here.
        let list = sign_event(&bob, 10050, vec![vec!["relay".into(), "ws://127.0.0.1:7787".into()]], "", now());
        let list_ok = publish(&state, &tx, Some(&bob.pubkey), &list).await;

        // Anonymous wrap for bob, self-wrap by alice (the owner), self-wrap by bob.
        let anon = publish(&state, &tx, None, &wrap_for(&bob.pubkey, 10 + gate as u8)).await;
        let owner_self = publish(&state, &tx, Some(&alice.pubkey), &wrap_for(&alice.pubkey, 20 + gate as u8)).await;
        let bob_self = publish(&state, &tx, Some(&bob.pubkey), &wrap_for(&bob.pubkey, 30 + gate as u8)).await;

        for ok in [&list_ok, &anon, &owner_self, &bob_self] {
            let reason = ok[3].as_str().unwrap_or("");
            assert!(!reason.starts_with(WRAP_INTAKE_BLOCKED_PREFIX), "{gate:?}: intake gate ran on the embedded relay: {ok}");
            assert!(!reason.contains("DM relay list"), "{gate:?}: {ok}");
        }
        assert_eq!(state.metrics.wrap_intake_refused.load(Ordering::Relaxed), 0, "{gate:?}");
        assert_eq!(state.metrics.wrap_intake_would_refuse.load(Ordering::Relaxed), 0, "{gate:?}");

        // The answer pattern (accepted / hosted-only reason) is identical
        // across modes: the gate changes nothing on this backend.
        let pattern = [&anon, &owner_self, &bob_self]
            .iter()
            .map(|ok| format!("{}:{}", ok[2], ok[3].as_str().unwrap_or("")))
            .collect::<Vec<_>>()
            .join("|");
        answers.push(pattern);
    }
    assert!(answers.windows(2).all(|w| w[0] == w[1]), "{answers:?}");
}
