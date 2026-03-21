use hex;
use rand::rngs::OsRng;
use secp256k1::{Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

const SERVICE_NAME: &str = "app.thewired.desktop";

fn get_key_account() -> String {
    match std::env::var("WIRED_INSTANCE") {
        Ok(id) if !id.is_empty() && id != "0" => format!("nostr_private_key_{}", id),
        _ => "nostr_private_key".to_string(),
    }
}

fn get_marker_account() -> String {
    match std::env::var("WIRED_INSTANCE") {
        Ok(id) if !id.is_empty() && id != "0" => format!("nostr_key_marker_{}", id),
        _ => "nostr_key_marker".to_string(),
    }
}

/// In-memory cache so we only hit the OS keychain once per session.
static CACHED_SECRET: Mutex<Option<SecretKey>> = Mutex::new(None);

// ─── macOS: Touch ID via security-framework ──────────────────────────────
//
// Uses the modern Data Protection keychain (kSecUseDataProtectionKeychain)
// with USER_PRESENCE access control, which triggers Touch ID with a
// device passcode fallback. A separate "marker" item stored WITHOUT
// biometric protection allows `has_key()` to check for key existence
// without triggering any auth prompt.
//
// Migration: on first run, if an old keyring-stored item exists in the
// legacy keychain, it is read (one final macOS password dialog), then
// re-stored in the Data Protection keychain with biometric protection,
// and the legacy item is deleted. Subsequent launches use Touch ID only.
// ─────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod platform {
    use security_framework::passwords::{
        delete_generic_password_options, generic_password, set_generic_password_options,
        AccessControlOptions, PasswordOptions,
    };

    /// errSecItemNotFound
    const ITEM_NOT_FOUND: i32 = -25300;

    fn is_not_found(e: &security_framework::base::Error) -> bool {
        e.code() == ITEM_NOT_FOUND
    }

    /// Check if the key marker exists in the Data Protection keychain.
    /// The marker has no biometric access control — no auth prompt is triggered.
    /// Returns false (not an error) if the DP keychain is unavailable.
    pub fn marker_exists(service: &str, account: &str) -> Result<bool, String> {
        let mut opts = PasswordOptions::new_generic_password(service, account);
        opts.use_protected_keychain();
        match generic_password(opts) {
            Ok(_) => Ok(true),
            Err(e) if is_not_found(&e) => Ok(false),
            Err(e) => {
                // DP keychain may not be available (unsigned dev build, missing entitlement, etc.)
                // Treat as "marker not found" so we fall through to legacy check.
                log::warn!("Data Protection keychain marker check failed ({}): {e}", e.code());
                Ok(false)
            }
        }
    }

    /// Read the private key from the Data Protection keychain.
    /// Triggers Touch ID / passcode because the item has USER_PRESENCE access control.
    /// Returns None (not an error) if the DP keychain is unavailable,
    /// so callers can fall through to legacy storage.
    pub fn read_key(service: &str, account: &str) -> Result<Option<Vec<u8>>, String> {
        let mut opts = PasswordOptions::new_generic_password(service, account);
        opts.use_protected_keychain();
        match generic_password(opts) {
            Ok(data) => Ok(Some(data)),
            Err(e) if is_not_found(&e) => Ok(None),
            Err(e) => {
                let code = e.code();
                match code {
                    // User explicitly cancelled — propagate so we don't re-prompt
                    -128 => Err("Authentication cancelled".to_string()),
                    // All other errors (missing entitlement, DP keychain unavailable, etc.)
                    // → treat as "not found" so we fall through to legacy storage
                    _ => {
                        log::warn!("Data Protection keychain read failed ({}): {e}", code);
                        Ok(None)
                    }
                }
            }
        }
    }

    /// Store private key with Touch ID + passcode access control, plus an unprotected marker.
    /// Falls back to non-biometric DP keychain, then legacy keychain if biometric fails.
    pub fn store_key(
        service: &str,
        key_account: &str,
        marker_account: &str,
        key_data: &[u8],
    ) -> Result<(), String> {
        // Delete any existing items to avoid errSecDuplicateItem
        let _ = delete_items(service, key_account, marker_account);
        let _ = delete_legacy_key(service, key_account);

        // Try 1: Data Protection keychain WITH biometric (ideal)
        {
            let mut key_opts = PasswordOptions::new_generic_password(service, key_account);
            key_opts.set_access_control_options(AccessControlOptions::USER_PRESENCE);
            key_opts.use_protected_keychain();
            if let Ok(()) = set_generic_password_options(key_data, key_opts) {
                // Store marker (no access control — readable without auth)
                let mut marker_opts =
                    PasswordOptions::new_generic_password(service, marker_account);
                marker_opts.use_protected_keychain();
                let _ = set_generic_password_options(b"1", marker_opts);
                return Ok(());
            }
        }
        log::warn!("Biometric keychain store failed, trying without biometric");

        // Try 2: Data Protection keychain WITHOUT biometric
        {
            let mut key_opts = PasswordOptions::new_generic_password(service, key_account);
            key_opts.use_protected_keychain();
            if let Ok(()) = set_generic_password_options(key_data, key_opts) {
                let mut marker_opts =
                    PasswordOptions::new_generic_password(service, marker_account);
                marker_opts.use_protected_keychain();
                let _ = set_generic_password_options(b"1", marker_opts);
                return Ok(());
            }
        }
        log::warn!("Data Protection keychain store failed, trying legacy keychain");

        // Try 3: Legacy keychain (no DP flag, no biometric)
        let key_opts = PasswordOptions::new_generic_password(service, key_account);
        set_generic_password_options(key_data, key_opts)
            .map_err(|e| format!("Failed to store key in any keychain: {e}"))?;

        // Marker in legacy too
        let marker_opts = PasswordOptions::new_generic_password(service, marker_account);
        let _ = set_generic_password_options(b"1", marker_opts);

        Ok(())
    }

    /// Delete key and marker from Data Protection keychain.
    pub fn delete_items(
        service: &str,
        key_account: &str,
        marker_account: &str,
    ) -> Result<(), String> {
        let mut key_opts = PasswordOptions::new_generic_password(service, key_account);
        key_opts.use_protected_keychain();
        let _ = delete_generic_password_options(key_opts);

        let mut marker_opts = PasswordOptions::new_generic_password(service, marker_account);
        marker_opts.use_protected_keychain();
        let _ = delete_generic_password_options(marker_opts);

        Ok(())
    }

    /// Read key from the legacy keychain (old keyring crate storage).
    /// Does NOT set use_protected_keychain so it searches the legacy keychain.
    /// On unsigned dev builds this may trigger one macOS password dialog.
    /// Returns None (not an error) on any failure so the caller can proceed.
    pub fn read_legacy_key(service: &str, account: &str) -> Result<Option<Vec<u8>>, String> {
        let opts = PasswordOptions::new_generic_password(service, account);
        match generic_password(opts) {
            Ok(data) => Ok(Some(data)),
            Err(e) if is_not_found(&e) => Ok(None),
            Err(e) => {
                // User denied, legacy keychain unavailable, etc. — don't block startup.
                log::warn!("Legacy keychain read failed ({}): {e}", e.code());
                Ok(None)
            }
        }
    }

    /// Delete key from the legacy keychain.
    pub fn delete_legacy_key(service: &str, account: &str) -> Result<(), String> {
        let opts = PasswordOptions::new_generic_password(service, account);
        let _ = delete_generic_password_options(opts);
        Ok(())
    }
}

// ─── Non-macOS: keyring fallback ─────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
mod platform {
    use keyring::Entry;

    pub fn marker_exists(service: &str, account: &str) -> Result<bool, String> {
        let entry = Entry::new(service, account).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn read_key(service: &str, account: &str) -> Result<Option<Vec<u8>>, String> {
        let entry = Entry::new(service, account).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(pw) => Ok(Some(pw.into_bytes())),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn store_key(
        service: &str,
        key_account: &str,
        marker_account: &str,
        key_data: &[u8],
    ) -> Result<(), String> {
        let pw = String::from_utf8(key_data.to_vec()).map_err(|e| e.to_string())?;
        let entry = Entry::new(service, key_account).map_err(|e| e.to_string())?;
        entry.set_password(&pw).map_err(|e| e.to_string())?;

        let marker = Entry::new(service, marker_account).map_err(|e| e.to_string())?;
        marker.set_password("1").map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn delete_items(
        service: &str,
        key_account: &str,
        marker_account: &str,
    ) -> Result<(), String> {
        if let Ok(entry) = Entry::new(service, key_account) {
            let _ = entry.delete_credential();
        }
        if let Ok(marker) = Entry::new(service, marker_account) {
            let _ = marker.delete_credential();
        }
        Ok(())
    }

    pub fn read_legacy_key(_service: &str, _account: &str) -> Result<Option<Vec<u8>>, String> {
        Ok(None) // No migration needed on non-macOS
    }

    pub fn delete_legacy_key(_service: &str, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

// ─── Core logic ──────────────────────────────────────────────────────────

fn parse_hex_secret_key(hex_str: &str) -> Result<SecretKey, String> {
    let bytes = hex::decode(hex_str.trim()).map_err(|e| format!("Invalid hex: {e}"))?;
    SecretKey::from_slice(&bytes).map_err(|e| format!("Invalid secret key: {e}"))
}

fn invalidate_cache() {
    if let Ok(mut cache) = CACHED_SECRET.lock() {
        *cache = None;
    }
}

/// Load the secret key from cache or keychain, optionally generating a new one.
/// On macOS, the first access per session triggers a single Touch ID prompt.
/// All subsequent calls use the in-memory cache.
fn load_secret_key(generate: bool) -> Result<SecretKey, String> {
    let mut cache = CACHED_SECRET.lock().map_err(|e| e.to_string())?;
    if let Some(sk) = *cache {
        return Ok(sk);
    }

    let key_account = get_key_account();
    let marker_account = get_marker_account();

    // 1. Try biometric-protected storage (Touch ID on macOS)
    if let Some(data) = platform::read_key(SERVICE_NAME, &key_account)? {
        let hex_str = String::from_utf8(data).map_err(|e| format!("Invalid key data: {e}"))?;
        let sk = parse_hex_secret_key(&hex_str)?;
        *cache = Some(sk);
        return Ok(sk);
    }

    // 2. Try legacy storage and migrate (old keyring crate → biometric)
    if let Some(data) = platform::read_legacy_key(SERVICE_NAME, &key_account)? {
        let hex_str = String::from_utf8(data).map_err(|e| format!("Invalid legacy key: {e}"))?;
        let sk = parse_hex_secret_key(&hex_str)?;

        // Cache IMMEDIATELY — migration is best-effort.
        // Without this, a failed store_key would leave the cache empty,
        // causing every subsequent NIP-44 decrypt to re-read from legacy
        // and trigger another macOS password dialog.
        *cache = Some(sk);

        // Best-effort migration: store with biometric protection, delete legacy
        match platform::store_key(
            SERVICE_NAME,
            &key_account,
            &marker_account,
            hex_str.as_bytes(),
        ) {
            Ok(()) => {
                let _ = platform::delete_legacy_key(SERVICE_NAME, &key_account);
                log::info!("Migrated keychain entry to biometric-protected storage");
            }
            Err(e) => {
                log::warn!("Could not migrate to biometric storage (will retry next session): {e}");
            }
        }

        return Ok(sk);
    }

    // 3. No key found — generate if requested
    if !generate {
        return Err("No key found".to_string());
    }

    let secp = Secp256k1::new();
    let (sk, _) = secp.generate_keypair(&mut OsRng);
    let hex_str = hex::encode(sk.secret_bytes());

    // Cache immediately so the session works even if storage fails
    *cache = Some(sk);

    if let Err(e) = platform::store_key(
        SERVICE_NAME,
        &key_account,
        &marker_account,
        hex_str.as_bytes(),
    ) {
        log::error!("Failed to persist generated key: {e}");
        // Key is in memory for this session but won't survive restart
    }

    Ok(sk)
}

// ─── Tauri commands ──────────────────────────────────────────────────────

/// Get the public key from the stored private key, or generate a new keypair
#[tauri::command]
pub fn keystore_get_public_key() -> Result<String, String> {
    let sk = load_secret_key(true)?;
    let secp = Secp256k1::new();
    let (xonly, _) = sk.x_only_public_key(&secp);
    Ok(hex::encode(xonly.serialize()))
}

/// Sign a Nostr event (compute id + schnorr signature)
#[tauri::command]
pub fn keystore_sign_event(serialized_event: String) -> Result<SignedEventResult, String> {
    let sk = load_secret_key(false)?;

    let mut hasher = Sha256::new();
    hasher.update(serialized_event.as_bytes());
    let id_bytes = hasher.finalize();
    let event_id = hex::encode(id_bytes);

    let secp = Secp256k1::new();
    let msg = secp256k1::Message::from_digest_slice(&id_bytes).map_err(|e| e.to_string())?;
    let keypair = secp256k1::Keypair::from_secret_key(&secp, &sk);
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

/// Check if a private key exists in the keystore.
/// Uses marker + cache to avoid triggering biometric auth.
#[tauri::command]
pub fn keystore_has_key() -> Result<bool, String> {
    // Check in-memory cache first (no keychain access)
    if let Ok(cache) = CACHED_SECRET.lock() {
        if cache.is_some() {
            return Ok(true);
        }
    }

    let key_account = get_key_account();
    let marker_account = get_marker_account();

    // Check marker in Data Protection keychain (no biometric prompt)
    if platform::marker_exists(SERVICE_NAME, &marker_account)? {
        return Ok(true);
    }

    // Check for legacy key and migrate if found.
    // On macOS this triggers one final password dialog for the old keychain item.
    if let Some(data) = platform::read_legacy_key(SERVICE_NAME, &key_account)? {
        let hex_str = String::from_utf8(data).map_err(|e| format!("Invalid legacy key: {e}"))?;
        let sk = parse_hex_secret_key(&hex_str)?;

        // Cache immediately regardless of migration outcome
        if let Ok(mut cache) = CACHED_SECRET.lock() {
            *cache = Some(sk);
        }

        // Best-effort migration
        match platform::store_key(SERVICE_NAME, &key_account, &marker_account, hex_str.as_bytes())
        {
            Ok(()) => {
                let _ = platform::delete_legacy_key(SERVICE_NAME, &key_account);
                log::info!("Migrated keychain entry to biometric-protected storage");
            }
            Err(e) => {
                log::warn!("Could not migrate to biometric storage: {e}");
            }
        }

        return Ok(true);
    }

    Ok(false)
}

/// Import a hex-encoded secret key into the keystore with biometric protection
#[tauri::command]
pub fn keystore_import_key(secret_hex: String) -> Result<String, String> {
    let secret_bytes = hex::decode(&secret_hex).map_err(|e| format!("Invalid hex: {e}"))?;
    let sk =
        SecretKey::from_slice(&secret_bytes).map_err(|e| format!("Invalid secret key: {e}"))?;

    let key_account = get_key_account();
    let marker_account = get_marker_account();

    platform::store_key(SERVICE_NAME, &key_account, &marker_account, secret_hex.as_bytes())?;
    // Clean up any legacy key
    let _ = platform::delete_legacy_key(SERVICE_NAME, &key_account);

    invalidate_cache();
    if let Ok(mut cache) = CACHED_SECRET.lock() {
        *cache = Some(sk);
    }

    let secp = Secp256k1::new();
    let (xonly, _) = sk.x_only_public_key(&secp);
    Ok(hex::encode(xonly.serialize()))
}

/// Delete the private key from the keystore
#[tauri::command]
pub fn keystore_delete_key() -> Result<(), String> {
    invalidate_cache();
    let key_account = get_key_account();
    let marker_account = get_marker_account();
    platform::delete_items(SERVICE_NAME, &key_account, &marker_account)?;
    let _ = platform::delete_legacy_key(SERVICE_NAME, &key_account);
    Ok(())
}

/// NIP-44 encrypt plaintext for a recipient
#[tauri::command]
pub fn keystore_nip44_encrypt(
    recipient_pubkey: String,
    plaintext: String,
) -> Result<String, String> {
    let sk = load_secret_key(false)?;
    let pubkey = crate::nip44::xonly_to_pubkey(&recipient_pubkey)?;
    let conversation_key = crate::nip44::get_conversation_key(&sk, &pubkey)?;
    crate::nip44::encrypt(&plaintext, &conversation_key)
}

/// NIP-44 decrypt a payload from a sender
#[tauri::command]
pub fn keystore_nip44_decrypt(
    sender_pubkey: String,
    ciphertext: String,
) -> Result<String, String> {
    let sk = load_secret_key(false)?;
    let pubkey = crate::nip44::xonly_to_pubkey(&sender_pubkey)?;
    let conversation_key = crate::nip44::get_conversation_key(&sk, &pubkey)?;
    crate::nip44::decrypt(&ciphertext, &conversation_key)
}

#[derive(serde::Serialize)]
pub struct SignedEventResult {
    pub id: String,
    pub sig: String,
}
