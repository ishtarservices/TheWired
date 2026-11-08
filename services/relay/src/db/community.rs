//! Community authors (Postgres only): the pubkeys whose notes a firehose REQ
//! returns under `RELAY_FIREHOSE_POLICY=community` (`nostr::firehose`).
//!
//! An account is a community author when it
//!   (a) appears in `app.account_clients` (an authenticated API call from one
//!       of our clients; the table may not exist yet, see `to_regclass`), or
//!   (b) has a row in `app.nip05_identities`, `app.push_devices` or
//!       `app.space_members`, or
//!   (c) stored its NEWEST kind 10002 here with an `r` tag naming this relay
//!       (no marker, or marker `write`), or its newest kind 10050 naming it —
//!       compared through `nip42::normalize_relay_url`, as a NIP-42 `relay`
//!       tag is, so scheme, case, a trailing slash or a default port never
//!       matter and a lookalike host never matches.
//! Suspended and shadowed accounts are excluded whatever the sources say.
//!
//! Both relay-list kinds are replaceable, so the stored row IS the newest:
//! an older list that named us is gone once a newer one that does not
//! arrives (`event_store::store_event`), and an older one arriving late is
//! refused as superseded.
//!
//! The set is recomputed by `server::spawn_community_refresh` and lives in
//! two places that must agree: `AppState::community` (the live fan-out's
//! copy) and `relay.community_authors` (migration 009), which the stored
//! query joins. Benchmarked on a 200k-row table with 5k community authors
//! posting 2% of recent rows (the shape the policy exists for): `EXISTS`
//! against the table as a hashed subplan answered the firehose in ~8.5 ms
//! with 0.1 ms of planning and nothing extra on the wire, the same ~8 ms as
//! `pubkey = ANY($n)` but without that shape's 320 KB array per REQ and its
//! ~6 ms re-plan of the literal; a plain `IN (SELECT …)` semi-join took ~23 ms
//! (one index probe per scanned row). The diff upsert costs ~35 ms per
//! refresh.

use sqlx::PgPool;
use std::collections::HashSet;

use crate::nostr::wrap_gate::{KIND_DM_RELAY_LIST, KIND_RELAY_LIST};
use crate::protocol::nip42::{normalize_relay_url, relay_url_allowed};

/// SQL predicate for a firehose filter under the `community` policy: the
/// row's author is the reader (`pk_array_expr` is a `text[]` bind holding
/// the authenticated pubkey, or empty for an anonymous connection) or a
/// community author. The `OR` is load-bearing: it keeps the planner from
/// pulling the subquery up into a semi-join and makes it a hashed subplan
/// probed once per scanned row (see the module doc).
pub fn pg_community_firehose_predicate(pk_array_expr: &str) -> String {
    format!(
        "(pubkey = ANY({pk_array_expr}) OR EXISTS (SELECT 1 FROM relay.community_authors c \
         WHERE c.pubkey = relay.events.pubkey))"
    )
}

/// Compute the community author set from every source. `own_relay_urls` are
/// the addresses this relay answers to (`RELAY_URL`, `RELAY_AUTH_RELAY_URLS`,
/// `PUBLIC_RELAY_URL`). One round trip per source family; a backend table
/// that does not exist yet contributes nothing instead of failing the
/// refresh.
pub async fn community_authors(pool: &PgPool, own_relay_urls: &[String]) -> anyhow::Result<HashSet<String>> {
    let mut set: HashSet<String> = HashSet::new();

    // (a) + (b): the backend's account tables, each only if present. The
    // relay runs against the same Postgres as the backend but may boot
    // before a backend migration has created a table.
    let present: Vec<&str> = {
        let flags: (bool, bool, bool, bool) = sqlx::query_as(
            "SELECT to_regclass('app.account_clients') IS NOT NULL, \
                    to_regclass('app.nip05_identities') IS NOT NULL, \
                    to_regclass('app.push_devices') IS NOT NULL, \
                    to_regclass('app.space_members') IS NOT NULL",
        )
        .fetch_one(pool)
        .await?;
        let mut v = Vec::new();
        if flags.0 {
            v.push("app.account_clients");
        }
        if flags.1 {
            v.push("app.nip05_identities");
        }
        if flags.2 {
            v.push("app.push_devices");
        }
        if flags.3 {
            v.push("app.space_members");
        }
        v
    };
    if !present.is_empty() {
        let legs: Vec<String> = present.iter().map(|t| format!("SELECT pubkey FROM {t}")).collect();
        let sql = legs.join(" UNION ");
        let rows: Vec<(String,)> = sqlx::query_as(&sql).fetch_all(pool).await?;
        set.extend(rows.into_iter().map(|(pk,)| pk));
    }

    // (c): relay lists stored here that name this relay. The SQL keeps only
    // the tag values worth comparing (kind-10002 `r` with no marker or
    // `write`; kind-10050 `relay`) and pre-filters them on the host text so
    // the rows shipped are a small superset; the exact URL comparison is the
    // NIP-42 normalizer in Rust, so the two cannot drift.
    let fragments = host_fragments(own_relay_urls);
    if !fragments.is_empty() {
        let rows: Vec<(String, i32, Vec<String>)> = sqlx::query_as(
            "SELECT e.pubkey, e.kind, array_agg(t->>1) \
               FROM relay.events e, jsonb_array_elements(e.tags) t \
              WHERE e.kind IN ($1, $2) \
                AND jsonb_typeof(e.tags) = 'array' \
                AND jsonb_typeof(t->1) = 'string' \
                AND ((e.kind = $1 AND t->>0 = 'r' AND COALESCE(t->>2, '') IN ('', 'write')) \
                  OR (e.kind = $2 AND t->>0 = 'relay')) \
                AND EXISTS (SELECT 1 FROM unnest($3::text[]) f WHERE position(f IN lower(t->>1)) > 0) \
              GROUP BY e.pubkey, e.kind",
        )
        .bind(KIND_RELAY_LIST)
        .bind(KIND_DM_RELAY_LIST)
        .bind(&fragments)
        .fetch_all(pool)
        .await?;
        for (pubkey, _kind, urls) in rows {
            if urls.iter().any(|u| relay_url_allowed(u, own_relay_urls)) {
                set.insert(pubkey);
            }
        }
    }

    // Operator moderation wins over every source.
    let suspended: Vec<(String,)> =
        sqlx::query_as("SELECT pubkey FROM relay.suspended_pubkeys WHERE lifted_at IS NULL")
            .fetch_all(pool)
            .await?;
    for (pk,) in suspended {
        set.remove(&pk);
    }

    Ok(set)
}

/// Bring `relay.community_authors` in line with `set` in one transaction:
/// rows no longer in the set go, new ones come in, the rest are untouched.
pub async fn sync_community_table(pool: &PgPool, set: &HashSet<String>) -> anyhow::Result<()> {
    let want: Vec<String> = set.iter().cloned().collect();
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM relay.community_authors WHERE NOT (pubkey = ANY($1))")
        .bind(&want)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO relay.community_authors (pubkey) SELECT unnest($1::text[]) ON CONFLICT (pubkey) DO NOTHING",
    )
    .bind(&want)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Lowercase host substrings that any spelling of one of our URLs contains
/// after normalization — the coarse SQL pre-filter. Loopback collapses to
/// `127.0.0.1` in the normalizer, so a loopback relay also admits the
/// `localhost` and `[::1]` spellings into the candidate rows.
fn host_fragments(own_relay_urls: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for url in own_relay_urls {
        let normalized = normalize_relay_url(url);
        if normalized.is_empty() {
            continue;
        }
        let host = match normalized.rsplit_once(':') {
            Some((h, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => h.to_string(),
            _ => normalized.clone(),
        };
        let candidates: Vec<String> = if host == "127.0.0.1" {
            vec!["127.".into(), "localhost".into(), "::1".into()]
        } else {
            vec![host]
        };
        for c in candidates {
            if !out.contains(&c) {
                out.push(c);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_fragments_cover_every_spelling_of_our_addresses() {
        let got = host_fragments(&["wss://Relay.TheWired.app/".to_string(), "ws://localhost:7777".to_string()]);
        assert_eq!(got, vec!["relay.thewired.app", "127.", "localhost", "::1"]);
        assert!(host_fragments(&[String::new()]).is_empty());
        // Duplicates collapse.
        assert_eq!(
            host_fragments(&["ws://127.0.0.1:7777".to_string(), "ws://[::1]:7777".to_string()]).len(),
            3
        );
    }
}
