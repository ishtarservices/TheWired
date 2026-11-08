//! The community firehose (`RELAY_FIREHOSE_POLICY=community`, Postgres): an
//! untargeted kind-1 REQ returns community authors only, every targeted
//! request is served as before, and the community set is built from each of
//! its sources (`src/db/community.rs`) with operator moderation on top.
//!
//! Needs the test Postgres (`pnpm dev:infra`); skips with a warning otherwise.

mod common;

use common::{add_member, insert_space, make_app_state_with, setup_test_pool, sign_event, TestIdentity};
use sqlx::PgPool;
use std::collections::HashSet;
use std::sync::Arc;
use thewired_relay::config::Config;
use thewired_relay::connection::live_matching_subs;
use thewired_relay::nostr::event::Event;
use thewired_relay::nostr::filter::Filter;
use thewired_relay::nostr::firehose::FirehosePolicy;
use thewired_relay::nostr::wrap_gate::ReadCtx;
use thewired_relay::protocol::handler::{handle_message, read_ctx};
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

    async fn send(&mut self, state: &Arc<AppState>, tx: &broadcast::Sender<Event>, msg: &str) -> Vec<serde_json::Value> {
        handle_message(msg, state, &self.subs, &mut self.authed, &mut self.memberships, "c", tx)
            .await
            .into_iter()
            .map(|r| serde_json::from_str(&r).expect("json frame"))
            .collect()
    }

    /// The ids a REQ with this filter JSON returns, as a set.
    async fn req(&mut self, state: &Arc<AppState>, tx: &broadcast::Sender<Event>, filter: &str) -> HashSet<String> {
        let frames = self.send(state, tx, &format!(r#"["REQ","s",{filter}]"#)).await;
        assert!(
            frames.iter().any(|f| f[0] == "EOSE"),
            "REQ {filter} did not end in EOSE: {frames:?}"
        );
        frames
            .iter()
            .filter(|f| f[0] == "EVENT")
            .filter_map(|f| f[2]["id"].as_str().map(String::from))
            .collect()
    }
}

async fn publish(state: &Arc<AppState>, tx: &broadcast::Sender<Event>, ev: &Event) {
    let mut conn = Conn::new(None);
    let msg = format!(r#"["EVENT",{}]"#, serde_json::to_string(ev).unwrap());
    let ok = conn.send(state, tx, &msg).await.into_iter().next().expect("OK frame");
    assert_eq!(ok[2], true, "{ok}");
}

fn community_state(pool: PgPool) -> (Arc<AppState>, broadcast::Sender<Event>) {
    make_app_state_with(pool, |c: &mut Config| c.firehose_policy = FirehosePolicy::Community)
}

fn note(author: &TestIdentity, content: &str) -> Event {
    sign_event(author, 1, vec![], content, now())
}

/// A kind 10002 with one `r` tag per `(url, marker)`.
fn relay_list(author: &TestIdentity, entries: &[(&str, Option<&str>)], created_at: i64) -> Event {
    let tags = entries
        .iter()
        .map(|(url, marker)| {
            let mut t = vec!["r".to_string(), url.to_string()];
            if let Some(m) = marker {
                t.push(m.to_string());
            }
            t
        })
        .collect();
    sign_event(author, 10002, tags, "", created_at)
}

/// A kind 10050 naming `urls`.
fn dm_relay_list(author: &TestIdentity, urls: &[&str], created_at: i64) -> Event {
    let tags = urls.iter().map(|u| vec!["relay".to_string(), u.to_string()]).collect();
    sign_event(author, 10050, tags, "", created_at)
}

async fn insert_nip05(pool: &PgPool, pubkey: &str) {
    sqlx::query("INSERT INTO app.nip05_identities (username, pubkey) VALUES ($1, $2)")
        .bind(format!("user-{}", &pubkey[..8]))
        .bind(pubkey)
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_push_device(pool: &PgPool, pubkey: &str) {
    sqlx::query("INSERT INTO app.push_devices (id, pubkey, token) VALUES ($1, $2, $1)")
        .bind(format!("dev-{}", &pubkey[..8]))
        .bind(pubkey)
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_account_client(pool: &PgPool, pubkey: &str) {
    sqlx::query("INSERT INTO app.account_clients (pubkey, client, platform, version) VALUES ($1, 'mobile', 'ios', '1.0.0')")
        .bind(pubkey)
        .execute(pool)
        .await
        .unwrap();
}

async fn make_space_member(pool: &PgPool, pubkey: &str) {
    insert_space(pool, "the-space").await.unwrap();
    add_member(pool, "the-space", pubkey).await.unwrap();
}

async fn suspend(pool: &PgPool, pubkey: &str, mode: &str) {
    sqlx::query("INSERT INTO relay.suspended_pubkeys (pubkey, suspended_by, mode) VALUES ($1, 'admin', $2)")
        .bind(pubkey)
        .bind(mode)
        .execute(pool)
        .await
        .unwrap();
}

/// Every row of `relay.community_authors` except the relay's own signing
/// key, which is always present (see `the_relay_identity_is_always_a_community_author`).
async fn table_rows(pool: &PgPool, state: &AppState) -> HashSet<String> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT pubkey FROM relay.community_authors").fetch_all(pool).await.unwrap();
    rows.into_iter().map(|r| r.0).filter(|pk| *pk != state.relay_identity.pubkey).collect()
}

const FIREHOSE: &str = r#"{"kinds":[1],"limit":50}"#;

#[tokio::test]
async fn policy_all_serves_every_author_in_the_firehose() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool, |_| {});
    let stranger = TestIdentity::from_seed(1);
    let n = note(&stranger, "from outside");
    publish(&state, &tx, &n).await;

    let mut anon = Conn::new(None);
    assert!(anon.req(&state, &tx, FIREHOSE).await.contains(&n.id));
    assert!(anon.req(&state, &tx, "{}").await.contains(&n.id));
    assert!(state.firehose_serves(&stranger.pubkey, None), "policy all never consults the set");
}

#[tokio::test]
async fn community_policy_restricts_the_firehose_and_nothing_else() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let member = TestIdentity::from_seed(1);
    let stranger = TestIdentity::from_seed(2);
    let reader = TestIdentity::from_seed(3);
    make_space_member(&pool, &member.pubkey).await;
    let (state, tx) = community_state(pool.clone());
    state.refresh_community().await;

    let ours = sign_event(&member, 1, vec![vec!["t".into(), "x".into()]], "hello from the community", now());
    // The stranger's note replies to ours, shares its hashtag, mentions the
    // reader, carries an address and a d tag, and has searchable content.
    let theirs = sign_event(
        &stranger,
        1,
        vec![
            vec!["e".into(), ours.id.clone(), "".into(), "reply".into()],
            vec!["t".into(), "x".into()],
            vec!["p".into(), reader.pubkey.clone()],
            vec!["a".into(), format!("30023:{}:post", member.pubkey)],
            vec!["d".into(), "slug".into()],
        ],
        "zebra from outside",
        now(),
    );
    let their_reaction = sign_event(&stranger, 7, vec![vec!["e".into(), ours.id.clone()]], "+", now());
    for e in [&ours, &theirs, &their_reaction] {
        publish(&state, &tx, e).await;
    }

    let mut anon = Conn::new(None);
    // Firehose shapes: ours only.
    for f in [FIREHOSE, "{}", r#"{"kinds":[1,7]}"#, &format!(r#"{{"since":{},"limit":10}}"#, now() - 60), r##"{"kinds":[1],"#t":["x"]}"##] {
        let got = anon.req(&state, &tx, f).await;
        assert!(got.contains(&ours.id), "{f}: {got:?}");
        assert!(!got.contains(&theirs.id), "{f} leaked the stranger: {got:?}");
        assert!(!got.contains(&their_reaction.id), "{f} leaked the stranger's reaction: {got:?}");
    }
    // Targeted shapes: served exactly as before.
    let targeted = [
        format!(r#"{{"kinds":[1],"authors":["{}"]}}"#, stranger.pubkey),
        format!(r#"{{"ids":["{}"]}}"#, theirs.id),
        format!(r##"{{"kinds":[1],"#e":["{}"]}}"##, ours.id),
        format!(r##"{{"kinds":[1],"#p":["{}"]}}"##, reader.pubkey),
        format!(r##"{{"kinds":[1],"#a":["30023:{}:post"]}}"##, member.pubkey),
        r##"{"kinds":[1],"#d":["slug"]}"##.to_string(),
        r#"{"kinds":[1],"search":"zebra"}"#.to_string(),
    ];
    for f in &targeted {
        let got = anon.req(&state, &tx, f).await;
        assert!(got.contains(&theirs.id), "{f} must still return the stranger's note: {got:?}");
    }
    // Reactions alone are not a timeline: the stranger's reaction is served.
    assert!(anon.req(&state, &tx, r#"{"kinds":[7]}"#).await.contains(&their_reaction.id));

    // NIP-77 reconciliation of a firehose filter sees the same rows as the REQ.
    let ctx = ReadCtx { firehose_policy: FirehosePolicy::Community, ..ReadCtx::plain(None) };
    let filter: Filter = serde_json::from_str(FIREHOSE).unwrap();
    let ids: Vec<String> = state.pool.query_event_ids(&filter, &ctx, 100).await.unwrap().into_iter().map(|(_, id)| id).collect();
    assert_eq!(ids, vec![ours.id.clone()]);
}

#[tokio::test]
async fn every_source_makes_a_community_author() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let by_client = TestIdentity::from_seed(1);
    let by_nip05 = TestIdentity::from_seed(2);
    let by_device = TestIdentity::from_seed(3);
    let by_space = TestIdentity::from_seed(4);
    let by_10002 = TestIdentity::from_seed(5);
    let by_10002_write = TestIdentity::from_seed(6);
    let by_10050 = TestIdentity::from_seed(7);
    let stranger = TestIdentity::from_seed(8);
    insert_account_client(&pool, &by_client.pubkey).await;
    insert_nip05(&pool, &by_nip05.pubkey).await;
    insert_push_device(&pool, &by_device.pubkey).await;
    make_space_member(&pool, &by_space.pubkey).await;
    let (state, tx) = community_state(pool.clone());
    // Mixed spellings of the test relay's URL (`ws://localhost:7777`).
    publish(&state, &tx, &relay_list(&by_10002, &[("wss://nos.lol", None), ("WS://LOCALHOST:7777/", None)], now())).await;
    publish(&state, &tx, &relay_list(&by_10002_write, &[("ws://127.0.0.1:7777", Some("write"))], now())).await;
    publish(&state, &tx, &dm_relay_list(&by_10050, &["wss://relay.damus.io", "ws://[::1]:7777"], now())).await;
    // A stranger whose lists name other relays only.
    publish(&state, &tx, &relay_list(&stranger, &[("wss://nos.lol", None)], now())).await;
    publish(&state, &tx, &dm_relay_list(&stranger, &["wss://nos.lol"], now())).await;

    state.refresh_community().await;
    let members = [&by_client, &by_nip05, &by_device, &by_space, &by_10002, &by_10002_write, &by_10050];
    for m in members {
        assert!(state.firehose_serves(&m.pubkey, None), "{}", &m.pubkey[..8]);
    }
    assert!(!state.firehose_serves(&stranger.pubkey, None));
    let expected: HashSet<String> = members.iter().map(|m| m.pubkey.clone()).collect();
    assert_eq!(table_rows(&pool, &state).await, expected, "the table mirrors the set");

    // And the firehose agrees, stored.
    let notes: Vec<Event> = members.iter().map(|m| note(m, "hi")).collect();
    let foreign = note(&stranger, "hi");
    for n in notes.iter().chain(std::iter::once(&foreign)) {
        publish(&state, &tx, n).await;
    }
    let got = Conn::new(None).req(&state, &tx, FIREHOSE).await;
    for n in &notes {
        assert!(got.contains(&n.id));
    }
    assert!(!got.contains(&foreign.id));
}

#[tokio::test]
async fn the_newest_relay_list_decides() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = community_state(pool.clone());
    let leaving = TestIdentity::from_seed(1);
    let joining = TestIdentity::from_seed(2);
    let t = now() - 10;
    // Named us, then saved a list without us.
    publish(&state, &tx, &relay_list(&leaving, &[("ws://localhost:7777", None)], t)).await;
    publish(&state, &tx, &relay_list(&leaving, &[("wss://nos.lol", None)], t + 1)).await;
    // The other way round, with the older list arriving late (refused as superseded).
    publish(&state, &tx, &relay_list(&joining, &[("ws://localhost:7777", None)], t + 1)).await;
    let late = relay_list(&joining, &[("wss://nos.lol", None)], t);
    let mut conn = Conn::new(None);
    let ok = conn.send(&state, &tx, &format!(r#"["EVENT",{}]"#, serde_json::to_string(&late).unwrap())).await;
    assert_eq!(ok[0][2], true, "a superseded replaceable is acknowledged, not stored: {ok:?}");

    state.refresh_community().await;
    assert!(!state.firehose_serves(&leaving.pubkey, None), "the newer list does not name us");
    assert!(state.firehose_serves(&joining.pubkey, None), "the newer list names us");

    // A 10050 is judged on its own: naming us there is enough even when the
    // 10002 does not, and the reverse.
    let dm_only = TestIdentity::from_seed(3);
    publish(&state, &tx, &relay_list(&dm_only, &[("wss://nos.lol", None)], t)).await;
    publish(&state, &tx, &dm_relay_list(&dm_only, &["ws://localhost:7777"], t)).await;
    state.refresh_community().await;
    assert!(state.firehose_serves(&dm_only.pubkey, None));
}

#[tokio::test]
async fn read_markers_and_lookalike_urls_do_not_count() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = community_state(pool.clone());
    let read_only = TestIdentity::from_seed(1);
    publish(&state, &tx, &relay_list(&read_only, &[("ws://localhost:7777", Some("read"))], now())).await;
    let lookalikes = [
        "ws://localhost:7778",             // another port
        "ws://localhost.example.com:7777", // our host as a prefix of another
        "ws://xlocalhost:7777",            // our host as a suffix of another
        "ws://127.0.0.1.nip.io:7777",      // loopback literal inside a hostname
        "wss://relay.thewired.app",        // the production relay is not this test relay
    ];
    let mut identities = Vec::new();
    for (i, url) in lookalikes.iter().enumerate() {
        let id = TestIdentity::from_seed(10 + i as u8);
        publish(&state, &tx, &relay_list(&id, &[(url, None)], now())).await;
        publish(&state, &tx, &dm_relay_list(&TestIdentity::from_seed(30 + i as u8), &[url], now())).await;
        identities.push(id);
    }
    state.refresh_community().await;
    assert!(!state.firehose_serves(&read_only.pubkey, None), "a read-only entry is not membership");
    for (i, id) in identities.iter().enumerate() {
        assert!(!state.firehose_serves(&id.pubkey, None), "{}", lookalikes[i]);
        assert!(!state.firehose_serves(&TestIdentity::from_seed(30 + i as u8).pubkey, None), "{}", lookalikes[i]);
    }
    assert!(table_rows(&pool, &state).await.is_empty());

    // Marker spellings that do count: none, `write`, and an empty marker.
    let w1 = TestIdentity::from_seed(40);
    let w2 = TestIdentity::from_seed(41);
    publish(&state, &tx, &relay_list(&w1, &[("ws://localhost:7777", Some("write"))], now())).await;
    publish(&state, &tx, &relay_list(&w2, &[("ws://localhost:7777", Some(""))], now())).await;
    state.refresh_community().await;
    assert!(state.firehose_serves(&w1.pubkey, None));
    assert!(state.firehose_serves(&w2.pubkey, None));
}

#[tokio::test]
async fn shadowed_and_suspended_community_authors_are_excluded() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let shadowed = TestIdentity::from_seed(1);
    let suspended = TestIdentity::from_seed(2);
    let fine = TestIdentity::from_seed(3);
    for id in [&shadowed, &suspended, &fine] {
        make_space_member(&pool, &id.pubkey).await;
        insert_nip05(&pool, &id.pubkey).await;
    }
    suspend(&pool, &shadowed.pubkey, "shadowed").await;
    suspend(&pool, &suspended.pubkey, "suspended").await;
    let (state, tx) = community_state(pool.clone());
    state.refresh_community().await;
    assert!(state.firehose_serves(&fine.pubkey, None));
    assert!(!state.firehose_serves(&shadowed.pubkey, None));
    assert!(!state.firehose_serves(&suspended.pubkey, None));
    assert_eq!(table_rows(&pool, &state).await, HashSet::from([fine.pubkey.clone()]));
    // The shadowed author still sees their own note in the firehose.
    let n = note(&shadowed, "still here for me");
    publish(&state, &tx, &n).await;
    assert!(Conn::new(Some(&shadowed.pubkey)).req(&state, &tx, FIREHOSE).await.contains(&n.id));
    assert!(!Conn::new(None).req(&state, &tx, FIREHOSE).await.contains(&n.id));

    // Lifting the suspension readmits on the next refresh.
    sqlx::query("UPDATE relay.suspended_pubkeys SET lifted_at = NOW() WHERE pubkey = $1")
        .bind(&suspended.pubkey)
        .execute(&pool)
        .await
        .unwrap();
    state.refresh_community().await;
    assert!(state.firehose_serves(&suspended.pubkey, None));
}

#[tokio::test]
async fn an_authenticated_author_sees_their_own_notes_in_the_firehose() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let member = TestIdentity::from_seed(1);
    let stranger = TestIdentity::from_seed(2);
    let other_stranger = TestIdentity::from_seed(3);
    make_space_member(&pool, &member.pubkey).await;
    let (state, tx) = community_state(pool.clone());
    state.refresh_community().await;
    let ours = note(&member, "community");
    let mine = note(&stranger, "my own");
    let theirs = note(&other_stranger, "someone else's");
    for e in [&ours, &mine, &theirs] {
        publish(&state, &tx, e).await;
    }

    let got = Conn::new(Some(&stranger.pubkey)).req(&state, &tx, FIREHOSE).await;
    assert!(got.contains(&ours.id));
    assert!(got.contains(&mine.id), "the author sees their own note");
    assert!(!got.contains(&theirs.id), "but not another stranger's");

    let got = Conn::new(None).req(&state, &tx, FIREHOSE).await;
    assert_eq!(got, HashSet::from([ours.id.clone()]));
    assert!(state.firehose_serves(&stranger.pubkey, Some(&stranger.pubkey)));
    assert!(!state.firehose_serves(&stranger.pubkey, Some(&other_stranger.pubkey)));
}

#[tokio::test]
async fn live_broadcast_skips_strangers_on_firehose_filters_only() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let member = TestIdentity::from_seed(1);
    let stranger = TestIdentity::from_seed(2);
    let reader = TestIdentity::from_seed(3);
    make_space_member(&pool, &member.pubkey).await;
    let (state, _tx) = community_state(pool.clone());
    state.refresh_community().await;

    let f = |json: serde_json::Value| -> Filter { serde_json::from_value(json).unwrap() };
    let mut subs = SubscriptionManager::new();
    subs.add("fire".into(), vec![f(serde_json::json!({"kinds": [1]}))]).unwrap();
    subs.add("by-author".into(), vec![f(serde_json::json!({"authors": [stranger.pubkey]}))]).unwrap();
    subs.add("mixed".into(), vec![f(serde_json::json!({"kinds": [1]})), f(serde_json::json!({"#p": [reader.pubkey]}))]).unwrap();
    subs.add("reactions".into(), vec![f(serde_json::json!({"kinds": [7]}))]).unwrap();

    let sorted = |mut v: Vec<String>| { v.sort(); v };
    let mention = sign_event(&stranger, 1, vec![vec!["p".into(), reader.pubkey.clone()]], "hey", now());
    let plain = note(&stranger, "shouting into the void");
    let reaction = sign_event(&stranger, 7, vec![], "+", now());
    let ours = note(&member, "community");

    // Anonymous reader: the stranger reaches only targeted filters.
    assert_eq!(sorted(live_matching_subs(&state, &subs, &mention, &read_ctx(&state, &None))), vec!["by-author", "mixed"]);
    assert_eq!(sorted(live_matching_subs(&state, &subs, &plain, &read_ctx(&state, &None))), vec!["by-author"]);
    assert_eq!(sorted(live_matching_subs(&state, &subs, &reaction, &read_ctx(&state, &None))), vec!["by-author", "reactions"], "kinds [7] is not a firehose");
    // A community author reaches everything that matches.
    assert_eq!(sorted(live_matching_subs(&state, &subs, &ours, &read_ctx(&state, &None))), vec!["fire", "mixed"]);
    // The stranger, authenticated, receives their own note on the firehose.
    assert_eq!(sorted(live_matching_subs(&state, &subs, &plain, &read_ctx(&state, &Some(stranger.pubkey.clone())))), vec!["by-author", "fire", "mixed"]);
    // Another authenticated reader does not.
    assert_eq!(sorted(live_matching_subs(&state, &subs, &plain, &read_ctx(&state, &Some(reader.pubkey.clone())))), vec!["by-author"]);

    // Policy `all`: today's fan-out.
    let (all, _) = make_app_state_with(pool, |_| {});
    assert_eq!(sorted(live_matching_subs(&all, &subs, &plain, &read_ctx(&all, &None))), vec!["by-author", "fire", "mixed"]);
}

#[tokio::test]
async fn a_missing_account_clients_table_does_not_fail_the_refresh() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let member = TestIdentity::from_seed(1);
    make_space_member(&pool, &member.pubkey).await;
    sqlx::raw_sql("DROP TABLE app.account_clients").execute(&pool).await.unwrap();
    let (state, _tx) = community_state(pool.clone());
    state.refresh_community().await;
    let served = state.firehose_serves(&member.pubkey, None);
    let table = table_rows(&pool, &state).await;
    // Put the table back before asserting so a failure here cannot cascade.
    sqlx::raw_sql(
        "CREATE TABLE app.account_clients (pubkey TEXT NOT NULL, client TEXT NOT NULL, platform TEXT NOT NULL DEFAULT '', \
         version TEXT NOT NULL DEFAULT '', first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), \
         PRIMARY KEY (pubkey, client, platform))",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(served, "the other sources still count");
    assert_eq!(table, HashSet::from([member.pubkey.clone()]));
}

#[tokio::test]
async fn a_failed_refresh_keeps_the_previous_set() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let member = TestIdentity::from_seed(1);
    let stranger = TestIdentity::from_seed(2);
    make_space_member(&pool, &member.pubkey).await;
    let (state, _tx) = community_state(pool.clone());
    assert!(state.firehose_serves(&stranger.pubkey, None), "before the first refresh there is no set: everyone");
    state.refresh_community().await;
    assert!(state.firehose_serves(&member.pubkey, None));
    assert!(!state.firehose_serves(&stranger.pubkey, None));

    // The database goes away: the refresh fails and the set stays.
    pool.close().await;
    state.refresh_community().await;
    assert!(state.firehose_serves(&member.pubkey, None));
    assert!(!state.firehose_serves(&stranger.pubkey, None));
}

// ── Edge cases ──────────────────────────────────────────────────────────

/// A REQ may carry a firehose filter next to a targeted one: the targeted
/// filter's rows (a stranger's reply, their profile) come through merged,
/// the firehose filter stays restricted.
#[tokio::test]
async fn a_multi_filter_req_keeps_its_targeted_results() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let member = TestIdentity::from_seed(1);
    let stranger = TestIdentity::from_seed(2);
    make_space_member(&pool, &member.pubkey).await;
    let (state, tx) = community_state(pool.clone());
    state.refresh_community().await;
    let ours = note(&member, "ours");
    let theirs = note(&stranger, "theirs");
    let other = note(&TestIdentity::from_seed(3), "someone else");
    for e in [&ours, &theirs, &other] {
        publish(&state, &tx, e).await;
    }
    let mut anon = Conn::new(None);
    let frames = anon
        .send(&state, &tx, &format!(r#"["REQ","s",{{"kinds":[1]}},{{"authors":["{}"]}}]"#, stranger.pubkey))
        .await;
    let ids: HashSet<String> = frames.iter().filter(|f| f[0] == "EVENT").filter_map(|f| f[2]["id"].as_str().map(String::from)).collect();
    assert_eq!(ids, HashSet::from([ours.id.clone(), theirs.id.clone()]), "{frames:?}");
    // Newest first across the merged filters, one EOSE.
    let order: Vec<&str> = frames.iter().filter_map(|f| f[0].as_str()).collect();
    assert_eq!(order, vec!["EVENT", "EVENT", "EOSE"]);
}

/// `limit` counts what the client gets: hidden strangers do not eat into it,
/// `since`/`until` still bound the window, and newest-first ordering holds.
#[tokio::test]
async fn limit_and_window_apply_to_community_notes_only() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let member = TestIdentity::from_seed(1);
    let stranger = TestIdentity::from_seed(2);
    make_space_member(&pool, &member.pubkey).await;
    let (state, tx) = community_state(pool.clone());
    state.refresh_community().await;
    let base = now() - 100;
    // Five community notes at t, t+2, …; ten stranger notes interleaved and
    // newer than every one of ours.
    let ours: Vec<Event> = (0..5).map(|i| sign_event(&member, 1, vec![], &format!("c{i}"), base + 2 * i)).collect();
    let theirs: Vec<Event> = (0..10).map(|i| sign_event(&stranger, 1, vec![], &format!("s{i}"), base + 20 + i)).collect();
    for e in ours.iter().chain(theirs.iter()) {
        publish(&state, &tx, e).await;
    }
    let mut anon = Conn::new(None);
    let frames = anon.send(&state, &tx, r#"["REQ","s",{"kinds":[1],"limit":3}]"#).await;
    let ids: Vec<&str> = frames.iter().filter(|f| f[0] == "EVENT").filter_map(|f| f[2]["id"].as_str()).collect();
    let newest_three: Vec<&str> = ours.iter().rev().take(3).map(|e| e.id.as_str()).collect();
    assert_eq!(ids, newest_three, "three community notes, newest first, strangers not counted");

    let windowed = anon
        .req(&state, &tx, &format!(r#"{{"kinds":[1],"since":{},"until":{}}}"#, base + 2, base + 6))
        .await;
    assert_eq!(windowed, ours[1..=3].iter().map(|e| e.id.clone()).collect::<HashSet<_>>());
    assert!(anon.req(&state, &tx, &format!(r#"{{"kinds":[1],"since":{}}}"#, base + 20)).await.is_empty(), "the window holds only strangers");
}

/// A connection that lagged is resynced from storage over its open
/// subscriptions: the firehose one gets community notes only, the targeted
/// one its stranger.
#[tokio::test]
async fn the_lag_resync_applies_the_same_restriction() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let member = TestIdentity::from_seed(1);
    let stranger = TestIdentity::from_seed(2);
    make_space_member(&pool, &member.pubkey).await;
    let (state, tx) = community_state(pool.clone());
    state.refresh_community().await;
    let ours = note(&member, "ours");
    let theirs = note(&stranger, "theirs");
    publish(&state, &tx, &ours).await;
    publish(&state, &tx, &theirs).await;

    let f = |json: serde_json::Value| -> Filter { serde_json::from_value(json).unwrap() };
    let subs = Arc::new(Mutex::new(SubscriptionManager::new()));
    subs.lock().await.add("fire".into(), vec![f(serde_json::json!({"kinds": [1]}))]).unwrap();
    subs.lock().await.add("author".into(), vec![f(serde_json::json!({"authors": [stranger.pubkey]}))]).unwrap();
    let frames = thewired_relay::protocol::handler::resync_subscriptions(&state, &subs, &None, now() - 60).await;
    let mut got: Vec<(String, String)> = frames
        .iter()
        .map(|s| serde_json::from_str::<serde_json::Value>(s).unwrap())
        .map(|f| (f[1].as_str().unwrap().to_string(), f[2]["id"].as_str().unwrap().to_string()))
        .collect();
    got.sort();
    assert_eq!(got, vec![("author".to_string(), theirs.id.clone()), ("fire".to_string(), ours.id.clone())]);

    // The stranger's own connection is resynced with their note on the firehose.
    let frames = thewired_relay::protocol::handler::resync_subscriptions(&state, &subs, &Some(stranger.pubkey.clone()), now() - 60).await;
    assert_eq!(frames.len(), 3, "{frames:?}");
}

/// Reposts (6) and picture posts (20) are part of the timeline; a kind-6
/// REQ alone is a firehose too. Reactions on their own are not.
#[tokio::test]
async fn reposts_and_picture_posts_follow_the_policy() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let member = TestIdentity::from_seed(1);
    let stranger = TestIdentity::from_seed(2);
    make_space_member(&pool, &member.pubkey).await;
    let (state, tx) = community_state(pool.clone());
    state.refresh_community().await;
    let our_repost = sign_event(&member, 6, vec![], "{}", now());
    let their_repost = sign_event(&stranger, 6, vec![], "{}", now());
    let our_pic = sign_event(&member, 20, vec![vec!["imeta".into(), "url https://x/a.jpg".into()]], "", now());
    let their_pic = sign_event(&stranger, 20, vec![vec!["imeta".into(), "url https://x/b.jpg".into()]], "", now());
    let their_reaction = sign_event(&stranger, 7, vec![], "+", now());
    for e in [&our_repost, &their_repost, &our_pic, &their_pic, &their_reaction] {
        publish(&state, &tx, e).await;
    }
    let mut anon = Conn::new(None);
    for f in [r#"{"kinds":[6]}"#, r#"{"kinds":[20]}"#, r#"{"kinds":[1,6,20]}"#, r#"{"kinds":[6,7]}"#] {
        let got = anon.req(&state, &tx, f).await;
        assert!(!got.contains(&their_repost.id) && !got.contains(&their_pic.id), "{f}: {got:?}");
        assert!(got.contains(&our_repost.id) || got.contains(&our_pic.id), "{f}: {got:?}");
    }
    assert!(anon.req(&state, &tx, r#"{"kinds":[7]}"#).await.contains(&their_reaction.id));
    assert!(anon.req(&state, &tx, &format!(r#"{{"kinds":[6,20],"authors":["{}"]}}"#, stranger.pubkey)).await.contains(&their_pic.id));

    let f = |json: serde_json::Value| -> Filter { serde_json::from_value(json).unwrap() };
    let mut subs = SubscriptionManager::new();
    subs.add("pics".into(), vec![f(serde_json::json!({"kinds": [20]}))]).unwrap();
    assert!(live_matching_subs(&state, &subs, &their_pic, &read_ctx(&state, &None)).is_empty());
    assert_eq!(live_matching_subs(&state, &subs, &our_pic, &read_ctx(&state, &None)), vec!["pics"]);
}

/// Relay-list oddities: a URL with userinfo or a path is not ours, a tag
/// without a URL is skipped, a long list still matches on its last entry,
/// an empty list is nothing, and `PUBLIC_RELAY_URL` is recognised as us.
#[tokio::test]
async fn relay_list_oddities_are_handled() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, tx) = make_app_state_with(pool.clone(), |c: &mut Config| {
        c.firehose_policy = FirehosePolicy::Community;
        c.public_relay_url = Some("wss://relay.example.test".into());
    });
    let userinfo = TestIdentity::from_seed(1);
    let with_path = TestIdentity::from_seed(2);
    let no_url = TestIdentity::from_seed(3);
    let long_list = TestIdentity::from_seed(4);
    let empty_list = TestIdentity::from_seed(5);
    let via_public = TestIdentity::from_seed(6);
    publish(&state, &tx, &relay_list(&userinfo, &[("ws://user@localhost:7777", None)], now())).await;
    publish(&state, &tx, &relay_list(&with_path, &[("ws://localhost:7777/nostr", None)], now())).await;
    publish(&state, &tx, &sign_event(&no_url, 10002, vec![vec!["r".into()], vec!["relay".into(), "ws://localhost:7777".into()]], "", now())).await;
    let mut many: Vec<(&str, Option<&str>)> = vec![("wss://nos.lol", None); 60];
    many.push(("ws://localhost:7777", None));
    publish(&state, &tx, &relay_list(&long_list, &many, now())).await;
    publish(&state, &tx, &relay_list(&empty_list, &[], now())).await;
    publish(&state, &tx, &relay_list(&via_public, &[("WSS://Relay.Example.test:443/", Some("write"))], now())).await;

    state.refresh_community().await;
    assert!(!state.firehose_serves(&userinfo.pubkey, None), "userinfo");
    assert!(!state.firehose_serves(&with_path.pubkey, None), "path");
    assert!(!state.firehose_serves(&no_url.pubkey, None), "a `relay` tag on a 10002 and an `r` without a URL are nothing");
    assert!(state.firehose_serves(&long_list.pubkey, None), "last of 61 entries");
    assert!(!state.firehose_serves(&empty_list.pubkey, None));
    assert!(state.firehose_serves(&via_public.pubkey, None), "PUBLIC_RELAY_URL counts as us");
    assert_eq!(table_rows(&pool, &state).await, HashSet::from([long_list.pubkey.clone(), via_public.pubkey.clone()]));
}

/// Leaving every source removes an author on the next refresh — from the
/// set, from the table, and from the firehose: a kicked space member, and a
/// relay list the author deleted with a kind 5.
#[tokio::test]
async fn leaving_every_source_removes_the_author_on_the_next_refresh() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let kicked = TestIdentity::from_seed(1);
    let deleter = TestIdentity::from_seed(2);
    make_space_member(&pool, &kicked.pubkey).await;
    let (state, tx) = community_state(pool.clone());
    let list = relay_list(&deleter, &[("ws://localhost:7777", None)], now() - 5);
    publish(&state, &tx, &list).await;
    state.refresh_community().await;
    assert!(state.firehose_serves(&kicked.pubkey, None));
    assert!(state.firehose_serves(&deleter.pubkey, None));
    let n1 = note(&kicked, "before the kick");
    let n2 = note(&deleter, "before deleting my list");
    publish(&state, &tx, &n1).await;
    publish(&state, &tx, &n2).await;
    assert_eq!(Conn::new(None).req(&state, &tx, FIREHOSE).await, HashSet::from([n1.id.clone(), n2.id.clone()]));

    common::remove_member(&pool, "the-space", &kicked.pubkey).await.unwrap();
    let del = sign_event(&deleter, 5, vec![vec!["e".into(), list.id.clone()]], "", now());
    publish(&state, &tx, &del).await;
    // Until the refresh runs the old set stands…
    assert!(state.firehose_serves(&kicked.pubkey, None));
    state.refresh_community().await;
    // …then both are gone everywhere.
    assert!(!state.firehose_serves(&kicked.pubkey, None));
    assert!(!state.firehose_serves(&deleter.pubkey, None));
    assert!(table_rows(&pool, &state).await.is_empty());
    assert!(Conn::new(None).req(&state, &tx, FIREHOSE).await.is_empty());
    // Their notes are still there for anyone who asks for them.
    assert!(Conn::new(None).req(&state, &tx, &format!(r#"{{"ids":["{}","{}"]}}"#, n1.id, n2.id)).await.len() == 2);
}

/// The backend ingest role reads the relay whole: its own-relay REQ asks for
/// kinds 0/1/5/7/9/… in one filter, and indexing, deletions and moderation
/// need every author. Its stored and live reads ignore the policy; any other
/// authenticated key with the same filter does not.
#[tokio::test]
async fn the_ingest_role_is_exempt_from_the_policy() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let backend = TestIdentity::from_seed(9);
    let member = TestIdentity::from_seed(1);
    let stranger = TestIdentity::from_seed(2);
    let other = TestIdentity::from_seed(3);
    make_space_member(&pool, &member.pubkey).await;
    let (state, tx) = make_app_state_with(pool.clone(), |c: &mut Config| {
        c.firehose_policy = FirehosePolicy::Community;
        c.ingest_pubkeys = vec![backend.pubkey.clone()];
    });
    state.refresh_community().await;
    let ours = note(&member, "ours");
    let theirs = note(&stranger, "theirs");
    let their_profile = sign_event(&stranger, 0, vec![], r#"{"name":"s"}"#, now());
    let their_deletion = sign_event(&stranger, 5, vec![vec!["e".into(), "0".repeat(64)]], "", now());
    for e in [&ours, &theirs, &their_profile, &their_deletion] {
        publish(&state, &tx, e).await;
    }
    // The ingester's own-relay shape: many kinds, no authors.
    let ingest_req = r#"{"kinds":[0,1,5,7,9,31683,9735,39000]}"#;
    let got = Conn::new(Some(&backend.pubkey)).req(&state, &tx, ingest_req).await;
    for e in [&ours, &theirs, &their_profile, &their_deletion] {
        assert!(got.contains(&e.id), "the ingest role must see {}", e.kind);
    }
    let got = Conn::new(Some(&other.pubkey)).req(&state, &tx, ingest_req).await;
    assert!(got.contains(&ours.id) && !got.contains(&theirs.id) && !got.contains(&their_profile.id));
    let got = Conn::new(None).req(&state, &tx, ingest_req).await;
    assert_eq!(got, HashSet::from([ours.id.clone()]));

    let f = |json: serde_json::Value| -> Filter { serde_json::from_value(json).unwrap() };
    let mut subs = SubscriptionManager::new();
    subs.add("ingest".into(), vec![f(serde_json::from_str(ingest_req).unwrap())]).unwrap();
    let as_backend = Some(backend.pubkey.clone());
    let as_other = Some(other.pubkey.clone());
    assert_eq!(live_matching_subs(&state, &subs, &theirs, &read_ctx(&state, &as_backend)), vec!["ingest"]);
    assert_eq!(live_matching_subs(&state, &subs, &their_profile, &read_ctx(&state, &as_backend)), vec!["ingest"]);
    assert!(live_matching_subs(&state, &subs, &theirs, &read_ctx(&state, &as_other)).is_empty());
    assert!(live_matching_subs(&state, &subs, &theirs, &read_ctx(&state, &None)).is_empty());
    assert_eq!(live_matching_subs(&state, &subs, &ours, &read_ctx(&state, &None)), vec!["ingest"]);
}

/// Relay-generated events (NIP-29 group metadata signed by the relay's own
/// key) are never hidden: the relay's pubkey is always in the set.
#[tokio::test]
async fn the_relay_identity_is_always_a_community_author() {
    let pool = match setup_test_pool().await { Ok(p) => p, Err(e) => { eprintln!("skip: {e}"); return; } };
    let (state, _tx) = community_state(pool.clone());
    let relay_pk = state.relay_identity.pubkey.clone();
    state.refresh_community().await;
    assert!(state.firehose_serves(&relay_pk, None));
    let raw: Vec<(String,)> = sqlx::query_as("SELECT pubkey FROM relay.community_authors").fetch_all(&pool).await.unwrap();
    assert_eq!(raw, vec![(relay_pk.clone(),)]);
    assert!(table_rows(&pool, &state).await.is_empty());
    // …even when operator moderation names it by mistake: the relay key is
    // added after the suspension pass. (Nothing else is in the set, so a
    // stranger is still excluded.)
    assert!(!state.firehose_serves(&TestIdentity::from_seed(5).pubkey, None));
}
