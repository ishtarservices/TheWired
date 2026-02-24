use secp256k1::{Secp256k1, SecretKey, Keypair, XOnlyPublicKey};
use sha2::{Digest, Sha256};

use crate::nostr::event::Event;

/// Relay identity for signing group metadata events (kind:39000, 39001, 39002)
pub struct RelayIdentity {
    pub pubkey: String,
    secret_key: SecretKey,
}

impl RelayIdentity {
    /// Create a relay identity from an optional hex-encoded secret key.
    /// If None, generates a random keypair and logs the secret key hex.
    pub fn new(secret_key_hex: Option<String>) -> Self {
        let secp = Secp256k1::new();

        let secret_key = if let Some(hex_str) = secret_key_hex {
            let bytes = hex::decode(hex_str.trim())
                .expect("RELAY_SECRET_KEY must be valid hex");
            SecretKey::from_slice(&bytes)
                .expect("RELAY_SECRET_KEY must be a valid 32-byte secret key")
        } else {
            use rand::RngCore;
            let mut rng = rand::thread_rng();
            let mut key_bytes = [0u8; 32];
            rng.fill_bytes(&mut key_bytes);
            let sk = SecretKey::from_slice(&key_bytes)
                .expect("random 32 bytes should be a valid secret key");
            tracing::warn!(
                "No RELAY_SECRET_KEY set. Generated ephemeral relay key: {}",
                hex::encode(sk.secret_bytes())
            );
            sk
        };

        let keypair = Keypair::from_secret_key(&secp, &secret_key);
        let (xonly, _parity) = XOnlyPublicKey::from_keypair(&keypair);
        let pubkey = hex::encode(xonly.serialize());

        tracing::info!("Relay identity pubkey: {pubkey}");

        Self {
            pubkey,
            secret_key,
        }
    }

    /// Sign and return a complete Nostr event with the relay's identity.
    pub fn sign_event(
        &self,
        kind: i32,
        tags: Vec<Vec<String>>,
        content: &str,
    ) -> Event {
        let secp = Secp256k1::new();
        let created_at = chrono::Utc::now().timestamp();

        // Build unsigned event for ID computation
        let tags_value = serde_json::to_value(&tags).unwrap_or_default();
        let serialized = serde_json::to_string(&serde_json::json!([
            0,
            &self.pubkey,
            created_at,
            kind,
            tags_value,
            content
        ]))
        .unwrap_or_default();

        // Compute event ID = SHA-256 of canonical serialization
        let mut hasher = Sha256::new();
        hasher.update(serialized.as_bytes());
        let id_bytes = hasher.finalize();
        let id = hex::encode(&id_bytes);

        // Sign with schnorr (secp256k1 v0.30 takes &[u8] for message, &[u8; 32] for aux_rand)
        let keypair = Keypair::from_secret_key(&secp, &self.secret_key);
        let mut aux_rand = [0u8; 32];
        {
            use rand::RngCore;
            let mut rng = rand::thread_rng();
            rng.fill_bytes(&mut aux_rand);
        }
        let sig = secp.sign_schnorr_with_aux_rand(&id_bytes, &keypair, &aux_rand);
        let sig_hex = hex::encode(sig.as_ref());

        Event {
            id,
            pubkey: self.pubkey.clone(),
            created_at,
            kind,
            tags,
            content: content.to_string(),
            sig: sig_hex,
        }
    }
}
