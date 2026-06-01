//! End-to-end test for the embedded SQLite relay (Decentralized Spaces M6).
//!
//! Boots `server::run_embedded` in-process (loopback + in-memory SQLite),
//! connects a real WebSocket client, and round-trips a full NIP-29 lifecycle:
//! create a group (9007), post a chat message (kind:9) as the creator/member,
//! and read it back via REQ. This proves the SAME protocol handler that serves
//! production Postgres also serves the embedded SQLite backend — no Postgres,
//! no external relay process.
//!
//! Gated to `--features embedded` (it names `run_embedded` / `Db::Sqlite`).
#![cfg(feature = "embedded")]

mod common;

use common::{sign_event, TestIdentity};
use futures::{SinkExt, Stream, StreamExt};
use std::time::Duration;
use thewired_relay::db::{sqlite, Db};
use thewired_relay::server;
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Error as WsError, tungstenite::Message};

const T: Duration = Duration::from_secs(5);

/// Read frames until one whose type (`[0]`) equals `typ`, or time out.
async fn read_until<S>(rx: &mut S, typ: &str) -> Option<serde_json::Value>
where
    S: Stream<Item = Result<Message, WsError>> + Unpin,
{
    loop {
        let msg = match timeout(T, rx.next()).await {
            Ok(Some(Ok(m))) => m,
            _ => return None,
        };
        if let Message::Text(t) = msg {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                if v.get(0).and_then(|x| x.as_str()) == Some(typ) {
                    return Some(v);
                }
            }
        }
    }
}

fn event_frame(event: &thewired_relay::nostr::event::Event) -> Message {
    Message::Text(format!(r#"["EVENT",{}]"#, serde_json::to_string(event).unwrap()).into())
}

#[tokio::test]
async fn embedded_relay_round_trips_nip29_group() {
    // Boot the embedded relay: loopback bind, OS-assigned port, in-memory SQLite.
    // The relay is restricted (hosted_only) — alice is the owner, so she may
    // create groups.
    let alice = TestIdentity::from_seed(7);
    let db = Db::Sqlite(sqlite::connect_memory().await.unwrap());
    let relay = server::run_embedded(db, 0, "embedded-test".to_string(), None, Some(alice.pubkey.clone()), false)
        .await
        .expect("embedded relay should start");

    let (ws, _) = connect_async(relay.ws_url())
        .await
        .expect("connect to embedded relay");
    let (mut tx, mut rx) = ws.split();

    // The relay greets every connection with a NIP-42 AUTH challenge.
    assert!(read_until(&mut rx, "AUTH").await.is_some(), "no AUTH challenge");

    // 9007 create-group "g1" → creator becomes admin + member.
    let create = sign_event(
        &alice,
        9007,
        vec![vec!["h".into(), "g1".into()]],
        "My Group",
        1_700_000_000,
    );
    tx.send(event_frame(&create)).await.unwrap();
    let ok = read_until(&mut rx, "OK").await.expect("no OK for 9007");
    assert_eq!(ok.get(1).and_then(|v| v.as_str()), Some(create.id.as_str()));
    assert_eq!(
        ok.get(2).and_then(|v| v.as_bool()),
        Some(true),
        "9007 rejected: {ok}"
    );

    // kind:9 chat by the creator (a member → passes the publish gate).
    let chat = sign_event(
        &alice,
        9,
        vec![vec!["h".into(), "g1".into()]],
        "hello group",
        1_700_000_001,
    );
    tx.send(event_frame(&chat)).await.unwrap();
    let ok2 = read_until(&mut rx, "OK").await.expect("no OK for kind:9");
    assert_eq!(
        ok2.get(2).and_then(|v| v.as_bool()),
        Some(true),
        "kind:9 rejected: {ok2}"
    );

    // REQ the group's chat history back.
    tx.send(Message::Text(
        r##"["REQ","s1",{"#h":["g1"],"kinds":[9]}]"##.into(),
    ))
    .await
    .unwrap();
    let evt = read_until(&mut rx, "EVENT").await.expect("no EVENT for REQ");
    assert_eq!(evt.get(1).and_then(|v| v.as_str()), Some("s1"));
    assert_eq!(
        evt.get(2).and_then(|e| e.get("id")).and_then(|v| v.as_str()),
        Some(chat.id.as_str()),
        "REQ returned the wrong event: {evt}"
    );
    assert!(read_until(&mut rx, "EOSE").await.is_some(), "no EOSE");

    relay.stop().await;
}

#[tokio::test]
async fn embedded_relay_rejects_nonmember_publish() {
    let owner = TestIdentity::from_seed(7);
    let stranger = TestIdentity::from_seed(8);
    let db = Db::Sqlite(sqlite::connect_memory().await.unwrap());
    let relay = server::run_embedded(db, 0, "embedded-test".to_string(), None, Some(owner.pubkey.clone()), false)
        .await
        .unwrap();
    let (ws, _) = connect_async(relay.ws_url()).await.unwrap();
    let (mut tx, mut rx) = ws.split();
    assert!(read_until(&mut rx, "AUTH").await.is_some());

    // Owner creates the group.
    let create = sign_event(
        &owner,
        9007,
        vec![vec!["h".into(), "g2".into()]],
        "Owned",
        1_700_000_000,
    );
    tx.send(event_frame(&create)).await.unwrap();
    let ok = read_until(&mut rx, "OK").await.unwrap();
    assert_eq!(ok.get(2).and_then(|v| v.as_bool()), Some(true));

    // A non-member tries to post kind:9 → rejected by the relay-native gate.
    let chat = sign_event(
        &stranger,
        9,
        vec![vec!["h".into(), "g2".into()]],
        "i should not be here",
        1_700_000_002,
    );
    tx.send(event_frame(&chat)).await.unwrap();
    let ok2 = read_until(&mut rx, "OK").await.unwrap();
    assert_eq!(
        ok2.get(2).and_then(|v| v.as_bool()),
        Some(false),
        "non-member publish should be rejected: {ok2}"
    );

    relay.stop().await;
}

/// SECURITY: a restricted (hosted_only) relay must not be an open relay — only
/// the owner creates groups, and arbitrary non-group events are refused.
#[tokio::test]
async fn embedded_relay_is_not_an_open_relay() {
    let owner = TestIdentity::from_seed(7);
    let stranger = TestIdentity::from_seed(8);
    let db = Db::Sqlite(sqlite::connect_memory().await.unwrap());
    let relay = server::run_embedded(
        db,
        0,
        "embedded-test".to_string(),
        None,
        Some(owner.pubkey.clone()),
        false,
    )
    .await
    .unwrap();
    let (ws, _) = connect_async(relay.ws_url()).await.unwrap();
    let (mut tx, mut rx) = ws.split();
    assert!(read_until(&mut rx, "AUTH").await.is_some());

    // A stranger cannot create a group (owner-only).
    let evil_create = sign_event(
        &stranger,
        9007,
        vec![vec!["h".into(), "evilgroup".into()]],
        "",
        1_700_000_000,
    );
    tx.send(event_frame(&evil_create)).await.unwrap();
    let ok = read_until(&mut rx, "OK").await.unwrap();
    assert_eq!(
        ok.get(2).and_then(|v| v.as_bool()),
        Some(false),
        "stranger 9007 must be rejected: {ok}"
    );

    // A stranger cannot store an arbitrary non-group event (open-relay abuse).
    let spam = sign_event(&stranger, 1, vec![], "spam fills your disk", 1_700_000_001);
    tx.send(event_frame(&spam)).await.unwrap();
    let ok2 = read_until(&mut rx, "OK").await.unwrap();
    assert_eq!(
        ok2.get(2).and_then(|v| v.as_bool()),
        Some(false),
        "arbitrary non-group note must be rejected: {ok2}"
    );

    // The owner CAN create a group.
    let own_create = sign_event(
        &owner,
        9007,
        vec![vec!["h".into(), "mine".into()]],
        "Mine",
        1_700_000_002,
    );
    tx.send(event_frame(&own_create)).await.unwrap();
    let ok3 = read_until(&mut rx, "OK").await.unwrap();
    assert_eq!(
        ok3.get(2).and_then(|v| v.as_bool()),
        Some(true),
        "owner 9007 must succeed: {ok3}"
    );

    relay.stop().await;
}
