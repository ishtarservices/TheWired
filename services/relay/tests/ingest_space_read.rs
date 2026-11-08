//! The backend ingest role reads space-scoped (`h`-only) events on the
//! Postgres backend without being a member — that is how the backend indexes
//! live space activity and plans space-mention pushes from kind-9 chat.
//! Everyone else keeps the ordinary policy (docs/MUSIC_VISIBILITY.md §"Who may
//! view"), and the role never widens a `visibility`-tagged event.
//!
//! Needs the test Postgres (`pnpm dev:infra`); skips with a warning otherwise.

mod common;

use common::{
    add_member, insert_space, make_app_state_with, setup_test_pool, sign_event, sign_h_tagged,
    TestIdentity,
};
use std::collections::HashSet;
use std::sync::Arc;
use thewired_relay::config::Config;
use thewired_relay::nostr::event::Event;
use thewired_relay::protocol::handler::handle_message;
use thewired_relay::protocol::subscription::SubscriptionManager;
use thewired_relay::server::AppState;
use tokio::sync::{broadcast, Mutex};

const SPACE: &str = "space-ingest-read";

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
    let mut ids: Vec<String> = frames
        .iter()
        .filter(|f| frame_type(f) == "EVENT")
        .filter_map(|f| f.get(2).and_then(|e| e.get("id")).and_then(|v| v.as_str()).map(String::from))
        .collect();
    ids.sort();
    ids
}

async fn publish(state: &Arc<AppState>, tx: &broadcast::Sender<Event>, conn: &mut Conn, ev: &Event) {
    let msg = format!(r#"["EVENT",{}]"#, serde_json::to_string(ev).unwrap());
    let ok = conn.send(state, tx, &msg).await.into_iter().next().expect("OK frame");
    assert_eq!(ok[2], true, "{ok}");
}

#[tokio::test]
async fn ingest_role_reads_space_chat_but_nobody_else_and_never_private_events() {
    let pool = match setup_test_pool().await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("skip: {e}");
            return;
        }
    };
    let backend = TestIdentity::from_seed(9);
    let (state, tx) = make_app_state_with(pool.clone(), |c: &mut Config| {
        c.ingest_pubkeys = vec![backend.pubkey.clone()];
    });
    let alice = TestIdentity::from_seed(1);
    let carol = TestIdentity::from_seed(3);
    insert_space(&pool, SPACE).await.unwrap();
    add_member(&pool, SPACE, &alice.pubkey).await.unwrap();

    // Alice, a member, publishes chat and a private track shared into the space.
    let mut as_alice = Conn::new(Some(&alice.pubkey));
    let chat = sign_h_tagged(&alice, 9, SPACE, "hello space");
    publish(&state, &tx, &mut as_alice, &chat).await;
    let private_track = sign_event(
        &alice,
        31683,
        vec![
            vec!["d".into(), "secret".into()],
            vec!["title".into(), "Secret".into()],
            vec!["h".into(), SPACE.into()],
            vec!["visibility".into(), "private".into()],
        ],
        "",
        1_700_000_001,
    );
    publish(&state, &tx, &mut as_alice, &private_track).await;

    let req = format!(r##"["REQ","s",{{"#h":["{SPACE}"]}}]"##);

    // Anonymous: nothing — and no auth-required CLOSED (space chat is not a
    // gated kind; it is simply invisible, as before).
    let mut anon = Conn::new(None);
    let frames = anon.send(&state, &tx, &req).await;
    assert!(event_ids(&frames).is_empty(), "{frames:?}");
    assert!(frames.iter().all(|f| frame_type(f) != "CLOSED"), "{frames:?}");

    // An authenticated non-member: nothing.
    let mut as_carol = Conn::new(Some(&carol.pubkey));
    assert!(event_ids(&as_carol.send(&state, &tx, &req).await).is_empty());

    // The author/member sees both (rules 3 and 6).
    let mut both = vec![chat.id.clone(), private_track.id.clone()];
    both.sort();
    assert_eq!(event_ids(&as_alice.send(&state, &tx, &req).await), both);

    // The ingest role sees the chat — and NOT the private track (rule 5).
    let mut as_backend = Conn::new(Some(&backend.pubkey));
    assert_eq!(event_ids(&as_backend.send(&state, &tx, &req).await), vec![chat.id.clone()]);

    // The ROLE grants it, not the key: the same pubkey on a relay that does not
    // list it is an ordinary non-member.
    let (unlisted_state, unlisted_tx) = make_app_state_with(pool.clone(), |_| {});
    let mut as_unlisted_backend = Conn::new(Some(&backend.pubkey));
    assert!(event_ids(&as_unlisted_backend.send(&unlisted_state, &unlisted_tx, &req).await).is_empty());
}
