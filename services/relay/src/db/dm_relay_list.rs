//! Write-path relay-list lookup (Postgres only) for the gift-wrap intake gate
//! (`nostr::wrap_gate::intake_verdict`). One round trip per inbound kind-1059
//! that is not a self-wrap, whatever the number of recipients (capped at
//! `MAX_WRAP_RECIPIENTS` before the call).

use crate::nostr::wrap_gate::{StoredRelayList, KIND_DM_RELAY_LIST, KIND_RELAY_LIST};
use sqlx::PgPool;

/// The kind-10002 and kind-10050 events stored here for ANY of `pubkeys`,
/// with the `relay` tag values of each 10050. Both kinds are replaceable, so
/// this is at most two rows per pubkey, found through `(pubkey, kind)`; the
/// `relay` entries come out of the jsonb `tags` array as stored, string
/// values only (a malformed tag with a number or a missing value is skipped,
/// never an error). The URL comparison is left to the caller: a relay URL
/// matches under `nip42::normalize_relay_url` (scheme, case, trailing slash,
/// default port, loopback aliases), which cannot be expressed as a jsonb
/// containment test without re-implementing the normalizer in SQL and
/// letting the two drift.
pub async fn relay_lists_for(pool: &PgPool, pubkeys: &[String]) -> anyhow::Result<Vec<StoredRelayList>> {
    if pubkeys.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(String, i32, Vec<String>)> = sqlx::query_as(
        "SELECT e.pubkey, e.kind, \
                COALESCE((SELECT array_agg(t->>1) \
                            FROM jsonb_array_elements(e.tags) t \
                           WHERE e.kind = $1 \
                             AND t->>0 = 'relay' \
                             AND jsonb_typeof(t->1) = 'string'), '{}') \
           FROM relay.events e \
          WHERE e.kind IN ($1, $2) AND e.pubkey = ANY($3) \
            AND jsonb_typeof(e.tags) = 'array'",
    )
    .bind(KIND_DM_RELAY_LIST)
    .bind(KIND_RELAY_LIST)
    .bind(pubkeys)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(pubkey, kind, relay_urls)| StoredRelayList { pubkey, kind, relay_urls })
        .collect())
}
