use secp256k1::{Secp256k1, XOnlyPublicKey};
use sha2::{Digest, Sha256};

/// Verify a Nostr event's id and signature
pub fn verify_event(event: &super::event::Event) -> bool {
    // 1. Verify event ID = SHA-256 of canonical serialization
    let serialized = event.serialize_for_id();
    let mut hasher = Sha256::new();
    hasher.update(serialized.as_bytes());
    let hash = hex::encode(hasher.finalize());

    if hash != event.id {
        tracing::debug!("Event ID mismatch: expected {}, got {}", hash, event.id);
        return false;
    }

    // 2. Verify schnorr signature
    let secp = Secp256k1::verification_only();

    let id_bytes = match hex::decode(&event.id) {
        Ok(b) if b.len() == 32 => b,
        _ => return false,
    };

    let sig_bytes = match hex::decode(&event.sig) {
        Ok(b) if b.len() == 64 => b,
        _ => return false,
    };

    let pubkey_bytes = match hex::decode(&event.pubkey) {
        Ok(b) if b.len() == 32 => b,
        _ => return false,
    };

    let sig = match secp256k1::schnorr::Signature::from_slice(&sig_bytes) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let xonly = match XOnlyPublicKey::from_slice(&pubkey_bytes) {
        Ok(pk) => pk,
        Err(_) => return false,
    };

    secp.verify_schnorr(&sig, &id_bytes, &xonly).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nostr::event::Event;
    use secp256k1::{Secp256k1, SecretKey, Keypair};
    use sha2::{Digest, Sha256};

    /// Helper: create a valid signed Nostr event
    fn make_signed_event(content: &str, kind: i32) -> Event {
        let secp = Secp256k1::new();
        let secret_key = SecretKey::from_slice(&[0xcd; 32]).unwrap();
        let keypair = Keypair::from_secret_key(&secp, &secret_key);
        let (xonly, _parity) = keypair.x_only_public_key();
        let pubkey = hex::encode(xonly.serialize());

        let tags: Vec<Vec<String>> = vec![vec!["h".to_string(), "test-group".to_string()]];
        let created_at: i64 = 1700000000;

        // Build canonical serialization
        let tags_json = serde_json::to_value(&tags).unwrap();
        let canonical = serde_json::to_string(&serde_json::json!([
            0, &pubkey, created_at, kind, tags_json, content
        ]))
        .unwrap();

        // SHA-256 hash
        let mut hasher = Sha256::new();
        hasher.update(canonical.as_bytes());
        let hash = hasher.finalize();
        let id = hex::encode(&hash);

        // Schnorr sign (secp256k1 v0.30 takes &[u8], not &Message)
        let sig = secp.sign_schnorr_no_aux_rand(&hash, &keypair);

        Event {
            id,
            pubkey,
            created_at,
            kind,
            tags,
            content: content.to_string(),
            sig: hex::encode(sig.to_byte_array()),
        }
    }

    #[test]
    fn test_verify_valid_event() {
        let event = make_signed_event("hello", 1);
        assert!(verify_event(&event), "Valid event should pass verification");
    }

    #[test]
    fn test_verify_invalid_id() {
        let mut event = make_signed_event("hello", 1);
        event.id = "0".repeat(64); // Wrong hash
        assert!(!verify_event(&event), "Tampered ID should fail");
    }

    #[test]
    fn test_verify_invalid_sig() {
        let mut event = make_signed_event("hello", 1);
        event.sig = "0".repeat(128); // Wrong signature
        assert!(!verify_event(&event), "Tampered signature should fail");
    }

    #[test]
    fn test_verify_wrong_pubkey() {
        let mut event = make_signed_event("hello", 1);
        // Use a different valid pubkey (all 1s)
        event.pubkey = "1".repeat(64);
        // Re-hash the id to match the new canonical form
        let tags_json = serde_json::to_value(&event.tags).unwrap();
        let canonical = serde_json::to_string(&serde_json::json!([
            0, &event.pubkey, event.created_at, event.kind, tags_json, &event.content
        ]))
        .unwrap();
        let mut hasher = Sha256::new();
        hasher.update(canonical.as_bytes());
        event.id = hex::encode(hasher.finalize());
        assert!(!verify_event(&event), "Wrong pubkey should fail sig check");
    }

    #[test]
    fn test_verify_invalid_pubkey_hex() {
        let mut event = make_signed_event("hello", 1);
        event.pubkey = "not_hex".to_string();
        assert!(!verify_event(&event));
    }

    #[test]
    fn test_verify_invalid_sig_hex() {
        let mut event = make_signed_event("hello", 1);
        event.sig = "zzzz".to_string();
        assert!(!verify_event(&event));
    }

    #[test]
    fn test_verify_short_id() {
        let mut event = make_signed_event("hello", 1);
        event.id = "abcd".to_string(); // Too short
        assert!(!verify_event(&event));
    }

    #[test]
    fn test_verify_different_kinds() {
        // Verify works across different event kinds
        for kind in &[0, 1, 3, 5, 7, 9, 10002, 30023] {
            let event = make_signed_event("test", *kind);
            assert!(verify_event(&event), "Kind {} should verify", kind);
        }
    }
}
