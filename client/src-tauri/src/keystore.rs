use hex;
use keyring::Entry;
use rand::rngs::OsRng;
use secp256k1::{Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

const SERVICE_NAME: &str = "app.thewired.desktop";

fn get_account_name() -> String {
    match std::env::var("WIRED_INSTANCE") {
        Ok(id) if !id.is_empty() && id != "0" => format!("nostr_private_key_{}", id),
        _ => "nostr_private_key".to_string(),
    }
}

/// In-memory cache so we only hit the OS keychain once per session.
static CACHED_SECRET: Mutex<Option<SecretKey>> = Mutex::new(None);

/// Load the secret key from cache or keychain, optionally generating a new one.
fn load_secret_key(generate: bool) -> Result<SecretKey, String> {
    let mut cache = CACHED_SECRET.lock().map_err(|e| e.to_string())?;
    if let Some(sk) = *cache {
        return Ok(sk);
    }

    let entry = Entry::new(SERVICE_NAME, &get_account_name()).map_err(|e| e.to_string())?;

    let secret_hex = match entry.get_password() {
        Ok(hex) => hex,
        Err(keyring::Error::NoEntry) if generate => {
            let secp = Secp256k1::new();
            let (secret_key, _) = secp.generate_keypair(&mut OsRng);
            let hex_str = hex::encode(secret_key.secret_bytes());
            entry.set_password(&hex_str).map_err(|e| e.to_string())?;
            hex_str
        }
        Err(keyring::Error::NoEntry) => return Err("No key found".to_string()),
        Err(e) => return Err(e.to_string()),
    };

    let secret_bytes = hex::decode(&secret_hex).map_err(|e| e.to_string())?;
    let sk = SecretKey::from_slice(&secret_bytes).map_err(|e| e.to_string())?;
    *cache = Some(sk);
    Ok(sk)
}

/// Clear the in-memory cache (called on delete/import).
fn invalidate_cache() {
    if let Ok(mut cache) = CACHED_SECRET.lock() {
        *cache = None;
    }
}

/// Get the public key from the stored private key, or generate a new keypair
#[tauri::command]
pub fn keystore_get_public_key() -> Result<String, String> {
    let secret_key = load_secret_key(true)?;
    let secp = Secp256k1::new();
    let (xonly, _parity) = secret_key.x_only_public_key(&secp);
    Ok(hex::encode(xonly.serialize()))
}

/// Sign a Nostr event (compute id + schnorr signature)
/// Takes the serialized event array: [0, pubkey, created_at, kind, tags, content]
#[tauri::command]
pub fn keystore_sign_event(serialized_event: String) -> Result<SignedEventResult, String> {
    let secret_key = load_secret_key(false)?;

    // Compute event ID = SHA256 of canonical serialization
    let mut hasher = Sha256::new();
    hasher.update(serialized_event.as_bytes());
    let id_bytes = hasher.finalize();
    let event_id = hex::encode(id_bytes);

    // Sign with schnorr
    let secp = Secp256k1::new();
    let msg = secp256k1::Message::from_digest_slice(&id_bytes).map_err(|e| e.to_string())?;
    let keypair = secp256k1::Keypair::from_secret_key(&secp, &secret_key);
    let sig = secp.sign_schnorr_no_aux_rand(&msg, &keypair);

    Ok(SignedEventResult {
        id: event_id,
        sig: hex::encode(sig.as_ref()),
    })
}

/// Return the hex-encoded secret key (errors if no key exists)
#[tauri::command]
pub fn keystore_get_secret_key() -> Result<String, String> {
    let sk = load_secret_key(false)?;
    Ok(hex::encode(sk.secret_bytes()))
}

/// Check if a private key exists in the keystore
#[tauri::command]
pub fn keystore_has_key() -> Result<bool, String> {
    // Check cache first
    if let Ok(cache) = CACHED_SECRET.lock() {
        if cache.is_some() {
            return Ok(true);
        }
    }
    let entry = Entry::new(SERVICE_NAME, &get_account_name()).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Import a hex-encoded secret key into the keystore, replacing any existing key
#[tauri::command]
pub fn keystore_import_key(secret_hex: String) -> Result<String, String> {
    let secret_bytes = hex::decode(&secret_hex).map_err(|e| format!("Invalid hex: {e}"))?;
    let secret_key =
        SecretKey::from_slice(&secret_bytes).map_err(|e| format!("Invalid secret key: {e}"))?;

    let entry = Entry::new(SERVICE_NAME, &get_account_name()).map_err(|e| e.to_string())?;
    entry.set_password(&secret_hex).map_err(|e| e.to_string())?;

    // Update cache with the new key
    invalidate_cache();
    if let Ok(mut cache) = CACHED_SECRET.lock() {
        *cache = Some(secret_key);
    }

    let secp = Secp256k1::new();
    let (xonly, _parity) = secret_key.x_only_public_key(&secp);
    Ok(hex::encode(xonly.serialize()))
}

/// Delete the private key from the keystore
#[tauri::command]
pub fn keystore_delete_key() -> Result<(), String> {
    invalidate_cache();
    let entry = Entry::new(SERVICE_NAME, &get_account_name()).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())?;
    Ok(())
}

/// NIP-44 encrypt plaintext for a recipient.
/// Uses the stored secret key + recipient's x-only pubkey to derive a conversation key.
#[tauri::command]
pub fn keystore_nip44_encrypt(recipient_pubkey: String, plaintext: String) -> Result<String, String> {
    let secret_key = load_secret_key(false)?;
    let pubkey = crate::nip44::xonly_to_pubkey(&recipient_pubkey)?;
    let conversation_key = crate::nip44::get_conversation_key(&secret_key, &pubkey)?;
    crate::nip44::encrypt(&plaintext, &conversation_key)
}

/// NIP-44 decrypt a payload from a sender.
/// Uses the stored secret key + sender's x-only pubkey to derive a conversation key.
#[tauri::command]
pub fn keystore_nip44_decrypt(sender_pubkey: String, ciphertext: String) -> Result<String, String> {
    let secret_key = load_secret_key(false)?;
    let pubkey = crate::nip44::xonly_to_pubkey(&sender_pubkey)?;
    let conversation_key = crate::nip44::get_conversation_key(&secret_key, &pubkey)?;
    crate::nip44::decrypt(&ciphertext, &conversation_key)
}

#[derive(serde::Serialize)]
pub struct SignedEventResult {
    pub id: String,
    pub sig: String,
}
