//! Write-path kind-10050 lookup (Postgres only) for the gift-wrap intake gate
//! (`nostr::wrap_gate::wrap_intake`). One round trip per inbound kind-1059
//! that is not a self-wrap.

use sqlx::PgPool;

/// Every `["relay", url]` value from the kind-10050 DM relay lists stored
/// here for ANY of `pubkeys`. Kind 10050 is replaceable, so this is at most
/// one row per pubkey, found through `(pubkey, kind)`; the `relay` entries
/// come out of the jsonb `tags` array as stored. The URL comparison is left
/// to the caller: a relay URL matches under `nip42::normalize_relay_url`
/// (scheme, case, trailing slash, default port, loopback aliases), which
/// cannot be expressed as a jsonb containment test without re-implementing
/// the normalizer in SQL and letting the two drift.
pub async fn dm_relays_listed_by(pool: &PgPool, pubkeys: &[String]) -> anyhow::Result<Vec<String>> {
    if pubkeys.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT t->>1 \
           FROM relay.events e, jsonb_array_elements(e.tags) t \
          WHERE e.kind = $1 AND e.pubkey = ANY($2) \
            AND t->>0 = 'relay' AND t->>1 IS NOT NULL",
    )
    .bind(crate::nostr::wrap_gate::KIND_DM_RELAY_LIST)
    .bind(pubkeys)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(u,)| u).collect())
}
