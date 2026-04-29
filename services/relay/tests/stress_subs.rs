//! Stress / load-shape regression tests for subscription handling.
//!
//! These tests connect to a running relay (default `ws://localhost:7777`)
//! and exercise the per-connection subscription cap and concurrent-client
//! behavior. They're marked `#[ignore]` so the regular `cargo test` run
//! doesn't need a live relay. Run them explicitly:
//!
//! ```sh
//! pnpm dev:infra              # postgres
//! pnpm dev:relay               # in another shell
//! cargo test --test stress_subs -- --ignored --nocapture
//! ```
//!
//! Override the target via `STRESS_RELAY_URL=ws://...`.
//!
//! What these guard against:
//! - Per-connection subscription cap regressing below the advertised value
//!   (NIP-11 `max_subscriptions`). The 9-Alpha incident — users with many
//!   joined spaces seeing no chat — was caused by an earlier 20-sub cap.
//! - Concurrent connections interfering with each other's sub state.

use futures::{SinkExt, StreamExt};
use std::time::Duration;
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const DEFAULT_RELAY: &str = "ws://localhost:7777";
const REQ_TIMEOUT: Duration = Duration::from_secs(5);

fn relay_url() -> String {
    std::env::var("STRESS_RELAY_URL").unwrap_or_else(|_| DEFAULT_RELAY.to_string())
}

/// Open one connection, send `n` REQ messages with unique sub IDs, drain
/// responses, return (eose_count, closed_count, closed_reasons).
async fn open_n_subs(prefix: &str, n: usize) -> (usize, usize, Vec<String>) {
    let (ws, _) = connect_async(&relay_url()).await.expect("connect failed");
    let (mut tx, mut rx) = ws.split();

    for i in 0..n {
        let req = format!(r#"["REQ","{prefix}_{i}",{{"limit":1}}]"#);
        tx.send(Message::Text(req.into())).await.expect("send REQ");
    }

    let mut eose_count = 0usize;
    let mut closed_count = 0usize;
    let mut closed_reasons = Vec::new();

    while eose_count + closed_count < n {
        let msg = match timeout(REQ_TIMEOUT, rx.next()).await {
            Ok(Some(Ok(m))) => m,
            _ => break,
        };
        let text = match msg {
            Message::Text(t) => t,
            _ => continue,
        };
        let parsed: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            _ => continue,
        };
        let typ = parsed.get(0).and_then(|v| v.as_str()).unwrap_or("");
        match typ {
            "EOSE" => eose_count += 1,
            "CLOSED" => {
                closed_count += 1;
                if let Some(reason) = parsed.get(2).and_then(|v| v.as_str()) {
                    closed_reasons.push(reason.to_string());
                }
            }
            _ => {} // EVENT/AUTH/NOTICE/OK aren't part of REQ accounting
        }
    }

    let _ = tx.close().await;
    (eose_count, closed_count, closed_reasons)
}

/// Per-connection cap regression test.
///
/// Opens 100 subs (the advertised cap), expects all 100 EOSEs. Opens a 101st
/// REQ on the same connection, expects CLOSED with "too many subscriptions".
#[tokio::test]
#[ignore = "requires a running relay; run with `--ignored`"]
async fn cap_accepts_100_then_rejects_101() {
    let (ws, _) = connect_async(&relay_url()).await.expect("connect failed");
    let (mut tx, mut rx) = ws.split();

    for i in 0..101 {
        let req = format!(r#"["REQ","stress_cap_{i}",{{"limit":1}}]"#);
        tx.send(Message::Text(req.into())).await.expect("send");
    }

    let mut eose_count = 0usize;
    let mut closed: Vec<(String, String)> = Vec::new();
    while eose_count + closed.len() < 101 {
        let msg = match timeout(REQ_TIMEOUT, rx.next()).await {
            Ok(Some(Ok(m))) => m,
            _ => break,
        };
        let text = match msg {
            Message::Text(t) => t,
            _ => continue,
        };
        let parsed: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            _ => continue,
        };
        let typ = parsed.get(0).and_then(|v| v.as_str()).unwrap_or("");
        match typ {
            "EOSE" => eose_count += 1,
            "CLOSED" => {
                let id = parsed
                    .get(1)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let reason = parsed
                    .get(2)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                closed.push((id, reason));
            }
            _ => {}
        }
    }

    assert_eq!(eose_count, 100, "expected 100 EOSEs, got {eose_count}");
    assert_eq!(closed.len(), 1, "expected 1 CLOSED for overflow, got {}", closed.len());
    assert!(
        closed[0].1.contains("too many subscriptions"),
        "unexpected CLOSED reason: {:?}",
        closed[0].1
    );
}

/// Concurrent connection capacity test.
///
/// Spawns 20 parallel connections, each opening 50 subs. All should fit
/// under the cap and every connection should receive 50 EOSEs.
#[tokio::test]
#[ignore = "requires a running relay; run with `--ignored`"]
async fn many_concurrent_connections_each_50_subs() {
    let n_clients = 20usize;
    let subs_per_client = 50usize;

    let mut handles = Vec::with_capacity(n_clients);
    for c in 0..n_clients {
        let prefix = format!("client_{c}");
        handles.push(tokio::spawn(async move {
            open_n_subs(&prefix, subs_per_client).await
        }));
    }

    let mut total_eose = 0usize;
    let mut total_closed = 0usize;
    for h in handles {
        let (eose, closed, reasons) = h.await.expect("client task panicked");
        total_eose += eose;
        total_closed += closed;
        if closed > 0 {
            eprintln!("client closed reasons: {reasons:?}");
        }
    }

    let expected = n_clients * subs_per_client;
    assert_eq!(
        total_closed, 0,
        "no clients should have hit cap with {subs_per_client} subs each; got {total_closed} CLOSED"
    );
    assert_eq!(
        total_eose, expected,
        "expected {expected} EOSEs across all clients, got {total_eose}"
    );
}
