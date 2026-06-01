use rand::Rng;

/// Generate a NIP-42 AUTH challenge
pub fn generate_challenge() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(bytes)
}

/// Verify a NIP-42 AUTH response (kind:22242 event).
///
/// `strict_relay_url`: when true (the multi-tenant production relay), the event's
/// `relay` tag must exactly equal `relay_url` — the standard NIP-42 anti-replay
/// binding. When false (a single-tenant *embedded* relay reachable via many
/// addresses — loopback, LAN, tunnel — where one canonical URL can't match), the
/// URL value is not checked; a `relay` tag must still be present, and the random
/// per-connection `challenge` (verified below) remains the real replay binding.
pub fn verify_auth_event(
    event: &crate::nostr::event::Event,
    challenge: &str,
    relay_url: &str,
    strict_relay_url: bool,
) -> bool {
    if event.kind != 22242 {
        return false;
    }

    let has_relay = event.tags.iter().any(|t| {
        t.get(0).map(|s| s.as_str()) == Some("relay")
            && match t.get(1) {
                Some(u) => !strict_relay_url || u.as_str() == relay_url,
                None => false,
            }
    });

    let has_challenge = event
        .tags
        .iter()
        .any(|t| t.get(0).map(|s| s.as_str()) == Some("challenge") && t.get(1).map(|s| s.as_str()) == Some(challenge));

    has_relay && has_challenge && crate::nostr::verify::verify_event(event)
}
