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
        tracing::warn!("Event ID mismatch: expected {}, got {}", hash, event.id);
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
