use rand::Rng;

/// Generate a NIP-42 AUTH challenge
pub fn generate_challenge() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(bytes)
}

/// Verify a NIP-42 AUTH response (kind:22242 event)
pub fn verify_auth_event(
    event: &crate::nostr::event::Event,
    challenge: &str,
    relay_url: &str,
) -> bool {
    if event.kind != 22242 {
        return false;
    }

    let has_relay = event
        .tags
        .iter()
        .any(|t| t.get(0).map(|s| s.as_str()) == Some("relay") && t.get(1).map(|s| s.as_str()) == Some(relay_url));

    let has_challenge = event
        .tags
        .iter()
        .any(|t| t.get(0).map(|s| s.as_str()) == Some("challenge") && t.get(1).map(|s| s.as_str()) == Some(challenge));

    has_relay && has_challenge && crate::nostr::verify::verify_event(event)
}
