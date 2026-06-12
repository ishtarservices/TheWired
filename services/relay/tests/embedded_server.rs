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

/// Current unix time — AUTH events (kind:22242) must be fresh (±10 min).
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
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
    let auth_frame = read_until(&mut rx, "AUTH").await.expect("no AUTH challenge");
    let challenge = auth_frame
        .get(1)
        .and_then(|v| v.as_str())
        .expect("AUTH challenge string")
        .to_string();

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

    // Authenticate as the member (alice) — group-scoped history is no longer
    // readable anonymously (#18/#73). Respond to the NIP-42 challenge.
    let auth_event = sign_event(
        &alice,
        22242,
        vec![
            vec!["relay".into(), relay.ws_url().to_string()],
            vec!["challenge".into(), challenge.clone()],
        ],
        "",
        now(),
    );
    tx.send(Message::Text(
        format!(r#"["AUTH",{}]"#, serde_json::to_string(&auth_event).unwrap()).into(),
    ))
    .await
    .unwrap();
    let auth_ok = read_until(&mut rx, "OK").await.expect("no OK for AUTH");
    assert_eq!(
        auth_ok.get(2).and_then(|v| v.as_bool()),
        Some(true),
        "AUTH rejected: {auth_ok}"
    );

    // REQ the group's chat history back (now authenticated as a member).
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

/// #112 — kind 39000-39009 (NIP-29 group metadata) is relay-generated. An inbound
/// one is a forgery trying to spoof who the admins/members are; it must be rejected.
#[tokio::test]
async fn embedded_relay_rejects_forged_group_metadata() {
    let owner = TestIdentity::from_seed(7);
    let mallory = TestIdentity::from_seed(42);
    let db = Db::Sqlite(sqlite::connect_memory().await.unwrap());
    let relay = server::run_embedded(db, 0, "t".into(), None, Some(owner.pubkey.clone()), false)
        .await
        .unwrap();
    let (ws, _) = connect_async(relay.ws_url()).await.unwrap();
    let (mut tx, mut rx) = ws.split();
    assert!(read_until(&mut rx, "AUTH").await.is_some());

    // Forged 39001 admin list claiming mallory is an admin of group "g".
    let forged = sign_event(
        &mallory,
        39001,
        vec![
            vec!["d".into(), "g".into()],
            vec!["p".into(), mallory.pubkey.clone()],
        ],
        "",
        1_700_000_000,
    );
    tx.send(event_frame(&forged)).await.unwrap();
    let ok = read_until(&mut rx, "OK").await.expect("no OK for forged 39001");
    assert_eq!(
        ok.get(2).and_then(|v| v.as_bool()),
        Some(false),
        "forged 39001 must be rejected: {ok}"
    );

    relay.stop().await;
}

/// #68 — a non-admin's management event (e.g. 9005 moderator-delete) must be
/// rejected AND not stored/broadcast. Previously it was stored+broadcast even
/// though the OK frame said false.
#[tokio::test]
async fn embedded_relay_nonadmin_moddelete_not_stored() {
    let owner = TestIdentity::from_seed(7);
    let mallory = TestIdentity::from_seed(42);
    let db = Db::Sqlite(sqlite::connect_memory().await.unwrap());
    let relay = server::run_embedded(db, 0, "t".into(), None, Some(owner.pubkey.clone()), false)
        .await
        .unwrap();

    // Owner connection: create the group + authenticate (so it can read back).
    let (ws1, _) = connect_async(relay.ws_url()).await.unwrap();
    let (mut tx1, mut rx1) = ws1.split();
    let ch1 = read_until(&mut rx1, "AUTH").await.unwrap();
    let challenge1 = ch1.get(1).and_then(|v| v.as_str()).unwrap().to_string();
    let create = sign_event(&owner, 9007, vec![vec!["h".into(), "g".into()]], "G", 1_700_000_000);
    tx1.send(event_frame(&create)).await.unwrap();
    assert_eq!(read_until(&mut rx1, "OK").await.unwrap().get(2).and_then(|v| v.as_bool()), Some(true));
    let auth = sign_event(&owner, 22242, vec![vec!["relay".into(), relay.ws_url().to_string()], vec!["challenge".into(), challenge1]], "", now());
    tx1.send(Message::Text(format!(r#"["AUTH",{}]"#, serde_json::to_string(&auth).unwrap()).into())).await.unwrap();
    assert_eq!(read_until(&mut rx1, "OK").await.unwrap().get(2).and_then(|v| v.as_bool()), Some(true));

    // Mallory (not an admin) sends a 9005 moderator-delete on a separate conn.
    let (ws2, _) = connect_async(relay.ws_url()).await.unwrap();
    let (mut tx2, mut rx2) = ws2.split();
    assert!(read_until(&mut rx2, "AUTH").await.is_some());
    let mod_del = sign_event(
        &mallory,
        9005,
        vec![vec!["h".into(), "g".into()], vec!["e".into(), "someid".into()]],
        "",
        1_700_000_002,
    );
    tx2.send(event_frame(&mod_del)).await.unwrap();
    let ok = read_until(&mut rx2, "OK").await.expect("no OK for 9005");
    assert_eq!(ok.get(2).and_then(|v| v.as_bool()), Some(false), "non-admin 9005 must be rejected: {ok}");

    // It must NOT have been stored: owner REQs kind:9005 and gets none.
    tx1.send(Message::Text(r##"["REQ","s",{"kinds":[9005],"#h":["g"]}]"##.into())).await.unwrap();
    // Either an EVENT (bad) or EOSE (good) comes next.
    loop {
        match read_until(&mut rx1, "EVENT").await {
            Some(_) => panic!("rejected 9005 was stored + returned by REQ"),
            None => break, // timed out waiting for EVENT — none stored
        }
    }

    relay.stop().await;
}
