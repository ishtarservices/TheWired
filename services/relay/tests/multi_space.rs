//! DB-backed integration tests for multi-space (several `h` tags) events.
//!
//! Contract (docs/MUSIC_VISIBILITY.md):
//!   - PUBLISH: the author must be a member of EVERY listed space the relay
//!     resolves; the stored row keeps `h_tag = h_tags[1]`.
//!   - READ: a member of ANY listed space (or the author) sees the event;
//!     non-members and anonymous readers do not. `#h` hits on any tag.
//!
//! Drives `protocol::handler::handle_message` directly against the test
//! Postgres database (skipped with a warning if unreachable — see
//! `tests/common/mod.rs`).

mod common;

use std::collections::HashSet;
use std::sync::Arc;

use common::{
    add_member, insert_space, make_app_state, send_event, setup_test_pool, sign_multi_h,
    sign_music_track, TestIdentity,
};
use thewired_relay::protocol::handler::handle_message;
use thewired_relay::protocol::subscription::SubscriptionManager;
use thewired_relay::server::AppState;

const S1: &str = "space-multi-1";
const S2: &str = "space-multi-2";

fn parse_ok(value: &serde_json::Value) -> (bool, String) {
    assert_eq!(
        value.get(0).and_then(|v| v.as_str()),
        Some("OK"),
        "expected OK frame, got {value:?}"
    );
    let ok = value.get(2).and_then(|v| v.as_bool()).unwrap_or(false);
    let msg = value
        .get(3)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    (ok, msg)
}

macro_rules! pool_or_skip {
    () => {
        match setup_test_pool().await {
            Ok(p) => p,
            Err(e) => {
                eprintln!(
                    "SKIP: relay integration test — DB unreachable ({e}). \
                     Run `pnpm dev:infra` and ensure `thewired_relay_test` exists."
                );
                return;
            }
        }
    };
}

/// Run a REQ as `authed` (None = anonymous) and return the ids of the EVENT
/// frames that came back.
async fn req_ids(
    state: &Arc<AppState>,
    filter: serde_json::Value,
    authed: Option<&str>,
) -> Vec<String> {
    let subs = Arc::new(tokio::sync::Mutex::new(SubscriptionManager::new()));
    let mut authed_pubkey = authed.map(String::from);
    let mut memberships: HashSet<String> = HashSet::new();
    let (tx, _) = tokio::sync::broadcast::channel(8);
    let msg = format!(r#"["REQ","sub-{}",{}]"#, authed.unwrap_or("anon"), filter);
    let responses = handle_message(
        &msg,
        state,
        &subs,
        &mut authed_pubkey,
        &mut memberships,
        "challenge",
        &tx,
    )
    .await;
    responses
        .iter()
        .filter_map(|r| serde_json::from_str::<serde_json::Value>(r).ok())
        .filter(|v| v.get(0).and_then(|t| t.as_str()) == Some("EVENT"))
        .filter_map(|v| v.get(2)?.get("id")?.as_str().map(String::from))
        .collect()
}

#[tokio::test]
async fn member_of_all_spaces_publish_accepted_and_row_mirrors_both() {
    let pool = pool_or_skip!();
    let artist = TestIdentity::from_seed(0x61);
    insert_space(&pool, S1).await.unwrap();
    insert_space(&pool, S2).await.unwrap();
    add_member(&pool, S1, &artist.pubkey).await.unwrap();
    add_member(&pool, S2, &artist.pubkey).await.unwrap();

    let (state, tx) = make_app_state(pool.clone());
    let track = sign_music_track(&artist, &[S1, S2], "both");
    let (ok, msg) = parse_ok(&send_event(&state, &tx, &track).await);
    assert!(ok, "member of both spaces must be accepted, got {msg:?}");

    let row: (Option<String>, Vec<String>) =
        sqlx::query_as("SELECT h_tag, h_tags FROM relay.events WHERE id = $1")
            .bind(&track.id)
            .fetch_one(&pool)
            .await
            .expect("stored row");
    assert_eq!(row.0.as_deref(), Some(S1), "h_tag is the first h tag");
    assert_eq!(row.1, vec![S1.to_string(), S2.to_string()], "h_tags holds every h tag");
}

#[tokio::test]
async fn non_member_of_one_space_publish_rejected() {
    let pool = pool_or_skip!();
    let artist = TestIdentity::from_seed(0x62);
    insert_space(&pool, S1).await.unwrap();
    insert_space(&pool, S2).await.unwrap();
    add_member(&pool, S1, &artist.pubkey).await.unwrap();
    // NOT a member of S2.

    let (state, tx) = make_app_state(pool.clone());
    let track = sign_music_track(&artist, &[S1, S2], "half");
    let (ok, msg) = parse_ok(&send_event(&state, &tx, &track).await);
    assert!(!ok, "sharing into a space you are not in must be rejected");
    assert!(msg.starts_with("auth-required:"), "got {msg:?}");

    let row: Option<(String,)> = sqlx::query_as("SELECT id FROM relay.events WHERE id = $1")
        .bind(&track.id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(row.is_none(), "rejected event must not be stored");
}

#[tokio::test]
async fn unknown_space_id_ignored_when_member_of_another() {
    let pool = pool_or_skip!();
    let artist = TestIdentity::from_seed(0x63);
    insert_space(&pool, S1).await.unwrap();
    add_member(&pool, S1, &artist.pubkey).await.unwrap();

    let (state, tx) = make_app_state(pool.clone());
    let track = sign_music_track(&artist, &[S1, "hosted-elsewhere"], "remote");
    let (ok, msg) = parse_ok(&send_event(&state, &tx, &track).await);
    assert!(ok, "an id this relay does not host is ignored, got {msg:?}");

    let only_unknown = sign_music_track(&artist, &["hosted-elsewhere"], "remote-only");
    let (ok, _) = parse_ok(&send_event(&state, &tx, &only_unknown).await);
    assert!(!ok, "all-unknown h tags must be rejected");
}

#[tokio::test]
async fn multi_space_event_visible_to_member_of_second_space_only() {
    let pool = pool_or_skip!();
    let artist = TestIdentity::from_seed(0x64);
    let listener = TestIdentity::from_seed(0x65);
    let stranger = TestIdentity::from_seed(0x66);
    insert_space(&pool, S1).await.unwrap();
    insert_space(&pool, S2).await.unwrap();
    add_member(&pool, S1, &artist.pubkey).await.unwrap();
    add_member(&pool, S2, &artist.pubkey).await.unwrap();
    add_member(&pool, S2, &listener.pubkey).await.unwrap(); // second space only

    let (state, tx) = make_app_state(pool.clone());
    let track = sign_music_track(&artist, &[S1, S2], "shared");
    assert!(parse_ok(&send_event(&state, &tx, &track).await).0);

    let by_kind = serde_json::json!({"kinds": [31683]});
    assert_eq!(
        req_ids(&state, by_kind.clone(), Some(&listener.pubkey)).await,
        vec![track.id.clone()],
        "member of the second space reads the track"
    );
    assert_eq!(
        req_ids(&state, by_kind.clone(), Some(&artist.pubkey)).await,
        vec![track.id.clone()],
        "author reads own track"
    );
    assert!(
        req_ids(&state, by_kind.clone(), Some(&stranger.pubkey)).await.is_empty(),
        "member of neither space must not read"
    );
    assert!(
        req_ids(&state, by_kind, None).await.is_empty(),
        "anonymous must not read"
    );

    // `#h` on the second id hits (h_tags overlap, not the scalar h_tag).
    assert_eq!(
        req_ids(&state, serde_json::json!({"#h": [S2]}), Some(&listener.pubkey)).await,
        vec![track.id.clone()]
    );
    // NIP-50 search applies the same any-of gate (search_tsv covers `content`,
    // so use a chat message rather than the content-less track).
    let chat = sign_multi_h(&artist, 9, &[S1, S2], "quick brown fox in two spaces");
    assert!(parse_ok(&send_event(&state, &tx, &chat).await).0);
    let searched = serde_json::json!({"search": "fox"});
    assert_eq!(
        req_ids(&state, searched.clone(), Some(&listener.pubkey)).await,
        vec![chat.id.clone()],
        "member of the second space finds it via search"
    );
    assert!(
        req_ids(&state, searched.clone(), Some(&stranger.pubkey)).await.is_empty(),
        "non-member search hides"
    );
    assert!(req_ids(&state, searched, None).await.is_empty(), "anon search hides");
}
