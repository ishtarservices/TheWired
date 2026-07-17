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
    collapse_loopback(&hp)
}

/// Collapse loopback aliases (localhost, 127.0.0.0/8, [::1]) to `127.0.0.1` —
/// one interface, many names. Dev clients derive their relay URL from the
/// bundler host (`ws://127.0.0.1:7777`) while the relay is configured as
/// `ws://localhost:7777`; a textual compare would reject every such AUTH.
/// Strict IPv4 parse so a hostile hostname like `127.evil.com` never aliases.
fn collapse_loopback(hp: &str) -> String {
    let (host, port) = if let Some(rest) = hp.strip_prefix('[') {
        match rest.split_once(']') {
            Some((h, p)) => (format!("[{h}]"), p.to_string()),
            None => (hp.to_string(), String::new()),
        }
    } else if let Some((h, p)) = hp.rsplit_once(':') {
        if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) {
            (h.to_string(), format!(":{p}"))
        } else {
            (hp.to_string(), String::new())
        }
    } else {
        (hp.to_string(), String::new())
    };

    let is_v4_loopback = {
        let octets: Vec<&str> = host.split('.').collect();
        octets.len() == 4
            && octets[0] == "127"
            && octets
                .iter()
                .all(|o| !o.is_empty() && o.len() <= 3 && o.parse::<u16>().map(|n| n <= 255).unwrap_or(false))
    };
    if host == "localhost" || host == "[::1]" || is_v4_loopback {
        format!("127.0.0.1{port}")
    } else {
        hp.to_string()
    }
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

    #[test]
    fn normalize_collapses_loopback_aliases() {
        // Dev clients dial 127.0.0.1 (Metro host) while the relay is
        // configured as localhost — both must normalize identically.
        assert_eq!(
            normalize_relay_url("ws://localhost:7777"),
            normalize_relay_url("ws://127.0.0.1:7777")
        );
        assert_eq!(
            normalize_relay_url("ws://[::1]:7777"),
            normalize_relay_url("ws://127.0.0.1:7777")
        );
        assert_eq!(normalize_relay_url("ws://127.255.0.1:7777"), "127.0.0.1:7777");
        // Different ports stay distinct; hostile 127-prefixed DOMAINS never alias.
        assert_ne!(
            normalize_relay_url("ws://localhost:7777"),
            normalize_relay_url("ws://localhost:7778")
        );
        assert_ne!(
            normalize_relay_url("ws://127.evil.com:7777"),
            normalize_relay_url("ws://127.0.0.1:7777")
        );
        // Public urls untouched.
        assert_eq!(normalize_relay_url("wss://relay.thewired.app"), "relay.thewired.app");
    }
}
