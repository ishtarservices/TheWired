//! App Store 1.2 on the Postgres backend: the kind-1984 report read gate
//! (served only to the reporter and the ingest role, never gated by space
//! membership on publish) and the operator moderation write-block
//! (`relay.suspended_pubkeys`, `relay.tombstones`, migration 006).
//!
//! Needs the test Postgres (`pnpm dev:infra`); skips with a warning otherwise.

mod common;

use common::{insert_space, make_app_state_with, setup_test_pool, sign_event, TestIdentity};
use sqlx::PgPool;
use std::collections::HashSet;
use std::sync::Arc;
use thewired_relay::config::Config;
use thewired_relay::nostr::event::Event;
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

/// A report in the soot client's NIP-56 layout (see the backend's
/// `lib/reports/reportInput.ts`).
fn report(reporter: &TestIdentity, target_event: &Event, created_at: i64) -> Event {
    sign_event(
        reporter,
        1984,
        vec![
            vec!["p".into(), target_event.pubkey.clone(), "spam".into()],
            vec!["e".into(), target_event.id.clone(), "spam".into()],
            vec!["k".into(), target_event.kind.to_string()],
            vec!["L".into(), "app.soot.report".into()],
            vec!["l".into(), "spam".into(), "app.soot.report".into()],
            vec!["L".into(), "app.soot.report.target".into()],
            vec!["l".into(), "event".into(), "app.soot.report.target".into()],
            vec!["alt".into(), "report: spam".into()],
        ],
        "",
        created_at,
    )
}

async fn suspend(pool: &PgPool, pubkey: &str) {
    sqlx::query("INSERT INTO relay.suspended_pubkeys (pubkey, suspended_by) VALUES ($1, 'admin')")
        .bind(pubkey)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn reports_are_served_only_to_their_author_and_the_ingest_role() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let backend = TestIdentity::from_seed(9);
    let (state, tx) = make_app_state_with(pool, |c: &mut Config| {
        c.ingest_pubkeys = vec![backend.pubkey.clone()];
    });
    let alice = TestIdentity::from_seed(1);
    let mallory = TestIdentity::from_seed(2);
    let carol = TestIdentity::from_seed(3);

    let mut anon = Conn::new(None);
    let note = sign_event(&mallory, 1, vec![], "buy my coin", now());
    publish(&state, &tx, &mut anon, &note).await;
    // Published WITHOUT AUTH: the signature already proves the reporter.
    let r = report(&alice, &note, now());
    let ok = publish(&state, &tx, &mut anon, &r).await;
    assert_eq!(ok[2], true, "{ok}");

    let req = r#"["REQ","s1",{"kinds":[1984]}]"#;

    // Anonymous: told to AUTH, nothing served.
    let frames = anon.send(&state, &tx, req).await;
    assert_eq!(frames.len(), 1, "{frames:?}");
    assert_eq!(frame_type(&frames[0]), "CLOSED");
    assert!(frames[0][2].as_str().unwrap().starts_with("auth-required:"), "{frames:?}");

    // The reported account must never learn who reported it.
    let mut as_mallory = Conn::new(Some(&mallory.pubkey));
    let by_p = format!(r##"["REQ","s2",{{"kinds":[1984],"#p":["{}"]}}]"##, mallory.pubkey);
    assert!(event_ids(&as_mallory.send(&state, &tx, &by_p).await).is_empty());
    let mut as_carol = Conn::new(Some(&carol.pubkey));
    assert!(event_ids(&as_carol.send(&state, &tx, req).await).is_empty());

    // The reporter reads their own; the backend reads every report.
    let mut as_alice = Conn::new(Some(&alice.pubkey));
    assert_eq!(event_ids(&as_alice.send(&state, &tx, req).await), vec![r.id.clone()]);
    let mut as_backend = Conn::new(Some(&backend.pubkey));
    assert_eq!(event_ids(&as_backend.send(&state, &tx, req).await), vec![r.id.clone()]);
}

#[tokio::test]
async fn kindless_filters_silently_exclude_reports() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |_| {});
    let alice = TestIdentity::from_seed(1);
    let mallory = TestIdentity::from_seed(2);
    let mut anon = Conn::new(None);
    let note = sign_event(&mallory, 1, vec![], "hello", now());
    publish(&state, &tx, &mut anon, &note).await;
    let r = report(&alice, &note, now());
    publish(&state, &tx, &mut anon, &r).await;

    // `#e` on the reported note would match the report; it must not leak.
    let by_e = format!(r##"["REQ","s1",{{"#e":["{}"]}}]"##, note.id);
    let frames = anon.send(&state, &tx, &by_e).await;
    assert!(event_ids(&frames).is_empty(), "report leaked to an anonymous #e query: {frames:?}");
    let by_author = format!(r#"["REQ","s2",{{"authors":["{}"]}}]"#, alice.pubkey);
    let mut as_mallory = Conn::new(Some(&mallory.pubkey));
    assert!(event_ids(&as_mallory.send(&state, &tx, &by_author).await).is_empty());
}

#[tokio::test]
async fn a_non_member_can_report_space_content() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    insert_space(&pool, "closed-space").await.unwrap();
    let (state, tx) = make_app_state_with(pool, |_| {});
    let outsider = TestIdentity::from_seed(4);
    let mut conn = Conn::new(Some(&outsider.pubkey));

    // An ordinary h-tagged post from a non-member is refused...
    let post = sign_event(&outsider, 9, vec![vec!["h".into(), "closed-space".into()]], "hi", now());
    assert_eq!(publish(&state, &tx, &mut conn, &post).await[2], false);
    // ...but a report carrying the same h tag is not gated on membership.
    let target = sign_event(&TestIdentity::from_seed(5), 9, vec![], "x", now());
    let mut r = report(&outsider, &target, now());
    r = sign_event(&outsider, 1984, {
        let mut t = r.tags.clone();
        t.push(vec!["h".into(), "closed-space".into()]);
        t
    }, "", now());
    let ok = publish(&state, &tx, &mut conn, &r).await;
    assert_eq!(ok[2], true, "{ok}");
}

#[tokio::test]
async fn report_gate_off_serves_reports_like_any_event() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |c: &mut Config| c.report_read_gate = false);
    let alice = TestIdentity::from_seed(1);
    let mut anon = Conn::new(None);
    let note = sign_event(&TestIdentity::from_seed(2), 1, vec![], "x", now());
    let r = report(&alice, &note, now());
    publish(&state, &tx, &mut anon, &r).await;
    let frames = anon.send(&state, &tx, r#"["REQ","s1",{"kinds":[1984]}]"#).await;
    assert_eq!(event_ids(&frames), vec![r.id.clone()]);
}

#[tokio::test]
async fn a_suspended_account_cannot_write_but_may_delete_its_own_content() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool.clone(), |_| {});
    let mallory = TestIdentity::from_seed(2);
    let mut conn = Conn::new(None);

    let before = sign_event(&mallory, 1, vec![], "before", now() - 10);
    assert_eq!(publish(&state, &tx, &mut conn, &before).await[2], true);

    suspend(&pool, &mallory.pubkey).await;
    let after = sign_event(&mallory, 1, vec![], "after", now());
    let ok = publish(&state, &tx, &mut conn, &after).await;
    assert_eq!(ok[2], false, "{ok}");
    assert!(ok[3].as_str().unwrap().starts_with("blocked:"), "{ok}");
    // Reports and NIP-29 joins are writes too.
    let join = sign_event(&mallory, 9021, vec![vec!["h".into(), "s".into()]], "", now());
    assert_eq!(publish(&state, &tx, &mut conn, &join).await[2], false);

    // A NIP-09 deletion of its own note still goes through.
    let deletion = sign_event(&mallory, 5, vec![vec!["e".into(), before.id.clone()]], "", now());
    let ok = publish(&state, &tx, &mut conn, &deletion).await;
    assert_eq!(ok[2], true, "{ok}");

    // Lifting restores write access; the row stays as the record.
    sqlx::query("UPDATE relay.suspended_pubkeys SET lifted_at = NOW(), lifted_by = 'admin' WHERE pubkey = $1")
        .bind(&mallory.pubkey)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(publish(&state, &tx, &mut conn, &after).await[2], true);
}

#[tokio::test]
async fn a_tombstoned_event_is_never_stored_again_until_restored() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool.clone(), |_| {});
    let author = TestIdentity::from_seed(6);
    let mut conn = Conn::new(None);
    let note = sign_event(&author, 1, vec![], "removed", now());
    assert_eq!(publish(&state, &tx, &mut conn, &note).await[2], true);

    // What the backend's remove_event does: delete the row, tombstone the id.
    sqlx::query("DELETE FROM relay.events WHERE id = $1").bind(&note.id).execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO relay.tombstones (event_id, pubkey, kind, event, removed_by) VALUES ($1, $2, 1, $3, 'admin')",
    )
    .bind(&note.id)
    .bind(&author.pubkey)
    .bind(serde_json::to_value(&note).unwrap())
    .execute(&pool)
    .await
    .unwrap();

    // Anyone holding a copy — the author included — is refused.
    let ok = publish(&state, &tx, &mut conn, &note).await;
    assert_eq!(ok[2], false, "{ok}");
    assert!(ok[3].as_str().unwrap().contains("removed by the relay operator"), "{ok}");
    let frames = conn.send(&state, &tx, &format!(r#"["REQ","s1",{{"ids":["{}"]}}]"#, note.id)).await;
    assert!(event_ids(&frames).is_empty());

    // The author is not suspended by a removal: other writes still land.
    let other = sign_event(&author, 1, vec![], "fine", now());
    assert_eq!(publish(&state, &tx, &mut conn, &other).await[2], true);

    // Restored → it may be stored again.
    sqlx::query("UPDATE relay.tombstones SET restored_at = NOW(), restored_by = 'admin' WHERE event_id = $1")
        .bind(&note.id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(publish(&state, &tx, &mut conn, &note).await[2], true);
}
