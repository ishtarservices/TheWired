use rand::Rng;

/// Generate a NIP-42 AUTH challenge
pub fn generate_challenge() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(bytes)
}

/// How far the AUTH event's `created_at` may be from now (seconds).
const AUTH_MAX_SKEW: i64 = 600;

/// Normalize a relay URL for comparison (#71): drop the scheme (ws≡wss — the
/// random per-connection challenge is the real replay binding, and TLS
/// termination behind a proxy often differs from the client's view), lowercase,
/// strip trailing slashes, drop default ports. nostr-tools' `normalizeURL`
/// appends a trailing slash, so the previous un-normalized exact match rejected
/// every real client.
pub fn normalize_relay_url(raw: &str) -> String {
    let s = raw.trim();
    let rest = match s.split_once("://") {
        Some((_, r)) => r,
        None => s,
    };
    let mut hp = rest.trim_end_matches('/').to_ascii_lowercase();
    if let Some(stripped) = hp.strip_suffix(":80") {
        hp = stripped.to_string();
    } else if let Some(stripped) = hp.strip_suffix(":443") {
        hp = stripped.to_string();
    }
    hp
}

/// Verify a NIP-42 AUTH response (kind:22242 event).
///
/// `strict_relay_url`: when true (the multi-tenant production relay), the event's
/// `relay` tag must MATCH (after normalization) `relay_url`. When false (a
/// single-tenant *embedded* relay reachable via many addresses), the URL value is
/// not checked; a `relay` tag must still be present, and the random per-connection
/// `challenge` remains the real replay binding. `now` is the current unix time,
/// for the ±10-minute `created_at` freshness window.
pub fn verify_auth_event(
    event: &crate::nostr::event::Event,
    challenge: &str,
    relay_url: &str,
    strict_relay_url: bool,
    now: i64,
) -> bool {
    if event.kind != 22242 {
        return false;
    }
    if (now - event.created_at).abs() > AUTH_MAX_SKEW {
        return false;
    }

    let want = normalize_relay_url(relay_url);
    let has_relay = event.tags.iter().any(|t| {
        t.get(0).map(|s| s.as_str()) == Some("relay")
            && match t.get(1) {
                Some(u) => !strict_relay_url || normalize_relay_url(u) == want,
                None => false,
            }
    });

    let has_challenge = event
        .tags
        .iter()
        .any(|t| t.get(0).map(|s| s.as_str()) == Some("challenge") && t.get(1).map(|s| s.as_str()) == Some(challenge));

    has_relay && has_challenge && crate::nostr::verify::verify_event(event)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_handles_case_slash_port_scheme() {
        assert_eq!(
            normalize_relay_url("wss://Relay.TheWired.app/"),
            normalize_relay_url("ws://relay.thewired.app")
        );
        assert_eq!(normalize_relay_url("wss://relay.thewired.app:443"), "relay.thewired.app");
        assert_ne!(
            normalize_relay_url("ws://relay:7777"),
            normalize_relay_url("ws://relay:7778")
        );
    }
}
