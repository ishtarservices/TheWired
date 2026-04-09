use hex;
use rand::rngs::OsRng;
use secp256k1::{Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;

const SERVICE_NAME: &str = "app.thewired.desktop";

/// Instance suffix for dev builds with multiple instances
fn instance_suffix() -> String {
    match std::env::var("WIRED_INSTANCE") {
        Ok(id) if !id.is_empty() && id != "0" => format!("_{}", id),
        _ => String::new(),
    }
}

/// Legacy key account name (single-key era)
fn get_legacy_key_account() -> String {
    format!("nostr_private_key{}", instance_suffix())
}

/// Legacy marker account name (single-key era)
fn get_legacy_marker_account() -> String {
    format!("nostr_key_marker{}", instance_suffix())
}

/// Per-account key account name
fn get_key_account_for(pubkey: &str) -> String {
    format!("nostr_pk_{}{}", pubkey, instance_suffix())
}

/// Per-account marker account name
fn get_marker_account_for(pubkey: &str) -> String {
    format!("nostr_mk_{}{}", pubkey, instance_suffix())
}

/// Account list keychain account name
fn get_account_list_account() -> String {
    format!("nostr_account_list{}", instance_suffix())
}

/// Multi-key in-memory cache: pubkey → SecretKey
static CACHED_SECRETS: Mutex<Option<HashMap<String, SecretKey>>> = Mutex::new(None);

/// Currently active pubkey for signing operations
static ACTIVE_PUBKEY: Mutex<Option<String>> = Mutex::new(None);

fn get_cache() -> std::sync::MutexGuard<'static, Option<HashMap<String, SecretKey>>> {
    CACHED_SECRETS.lock().unwrap_or_else(|e| e.into_inner())
}

fn get_active() -> std::sync::MutexGuard<'static, Option<String>> {
    ACTIVE_PUBKEY.lock().unwrap_or_else(|e| e.into_inner())
}

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

// ─── Account list persistence ───────────────────────────────────────────

fn account_list_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let mut dir = std::path::PathBuf::from(home);
    #[cfg(target_os = "macos")]
    dir.push("Library/Application Support");
    #[cfg(target_os = "linux")]
    dir.push(".local/share");
    #[cfg(target_os = "windows")]
    dir.push("AppData/Roaming");
    dir.push(SERVICE_NAME);
    dir.push(format!("account_list{}.json", instance_suffix()));
    Some(dir)
}

fn load_account_list() -> Vec<String> {
    // Try keychain first
    let acct = get_account_list_account();
    if let Ok(Some(data)) = platform::read_key(SERVICE_NAME, &acct) {
        if let Ok(json) = String::from_utf8(data) {
            if let Ok(list) = serde_json::from_str::<Vec<String>>(&json) {
                return list;
            }
        }
    }
    // Fallback file
    if let Some(path) = account_list_path() {
        if let Ok(json) = std::fs::read_to_string(&path) {
            if let Ok(list) = serde_json::from_str::<Vec<String>>(&json) {
                return list;
            }
        }
    }
    Vec::new()
}

fn save_account_list(list: &[String]) {
    let json = serde_json::to_string(list).unwrap_or_else(|_| "[]".to_string());

    // Save to keychain (best-effort, no biometric)
    let acct = get_account_list_account();
    let marker = format!("{}_marker", acct);
    let _ = platform::store_key(SERVICE_NAME, &acct, &marker, json.as_bytes());

    // Always save fallback file
    if let Some(path) = account_list_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, &json);
    }
}

fn add_to_account_list(pubkey: &str) {
    let mut list = load_account_list();
    if !list.contains(&pubkey.to_string()) {
        list.push(pubkey.to_string());
        save_account_list(&list);
    }
}

fn remove_from_account_list(pubkey: &str) {
    let mut list = load_account_list();
    list.retain(|p| p != pubkey);
    save_account_list(&list);
}

// ─── Core logic ──────────────────────────────────────────────────────────

fn parse_hex_secret_key(hex_str: &str) -> Result<SecretKey, String> {
    let bytes = hex::decode(hex_str.trim()).map_err(|e| format!("Invalid hex: {e}"))?;
    SecretKey::from_slice(&bytes).map_err(|e| format!("Invalid secret key: {e}"))
}

fn compute_pubkey(sk: &SecretKey) -> String {
    let secp = Secp256k1::new();
    let (xonly, _) = sk.x_only_public_key(&secp);
    hex::encode(xonly.serialize())
}

fn invalidate_cache() {
    if let Ok(mut cache) = CACHED_SECRETS.lock() {
        *cache = None;
    }
}

/// File-based fallback path for a specific account's secret key.
fn fallback_key_path_for(pubkey: &str) -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let mut dir = std::path::PathBuf::from(home);
    #[cfg(target_os = "macos")]
    dir.push("Library/Application Support");
    #[cfg(target_os = "linux")]
    dir.push(".local/share");
    #[cfg(target_os = "windows")]
    dir.push("AppData/Roaming");
    dir.push(SERVICE_NAME);
    dir.push(format!("{}.key", get_key_account_for(pubkey)));
    Some(dir)
}

/// Legacy fallback path (single-key era)
fn legacy_fallback_key_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let mut dir = std::path::PathBuf::from(home);
    #[cfg(target_os = "macos")]
    dir.push("Library/Application Support");
    #[cfg(target_os = "linux")]
    dir.push(".local/share");
    #[cfg(target_os = "windows")]
    dir.push("AppData/Roaming");
    dir.push(SERVICE_NAME);
    let account = get_legacy_key_account();
    dir.push(format!("{account}.key"));
    Some(dir)
}

fn read_fallback_key_for(pubkey: &str) -> Option<SecretKey> {
    let path = fallback_key_path_for(pubkey)?;
    let hex_str = std::fs::read_to_string(&path).ok()?;
    let hex_str = hex_str.trim();
    if hex_str.len() != 64 {
        return None;
    }
    parse_hex_secret_key(hex_str).ok()
}

fn read_legacy_fallback_key() -> Option<SecretKey> {
    let path = legacy_fallback_key_path()?;
    let hex_str = std::fs::read_to_string(&path).ok()?;
    let hex_str = hex_str.trim();
    if hex_str.len() != 64 {
        return None;
    }
    parse_hex_secret_key(hex_str).ok()
}

fn write_fallback_key_for(pubkey: &str, hex_str: &str) {
    if let Some(path) = fallback_key_path_for(pubkey) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&path, hex_str) {
            log::warn!("Failed to write fallback key file: {e}");
        }
    }
}

fn delete_fallback_key_for(pubkey: &str) {
    if let Some(path) = fallback_key_path_for(pubkey) {
        let _ = std::fs::remove_file(path);
    }
}

fn delete_legacy_fallback_key() {
    if let Some(path) = legacy_fallback_key_path() {
        let _ = std::fs::remove_file(path);
    }
}

/// Migrate a single-key legacy store to the multi-account scheme.
/// Returns the migrated pubkey if migration occurred.
fn migrate_legacy_key() -> Option<String> {
    let legacy_account = get_legacy_key_account();
    let legacy_marker = get_legacy_marker_account();

    // Try to read from legacy keychain locations
    let hex_str = if let Ok(Some(data)) = platform::read_key(SERVICE_NAME, &legacy_account) {
        String::from_utf8(data).ok()?
    } else if let Ok(Some(data)) = platform::read_legacy_key(SERVICE_NAME, &legacy_account) {
        String::from_utf8(data).ok()?
    } else if let Some(sk) = read_legacy_fallback_key() {
        hex::encode(sk.secret_bytes())
    } else {
        return None;
    };

    let sk = parse_hex_secret_key(&hex_str).ok()?;
    let pubkey = compute_pubkey(&sk);

    // Store under new per-account naming
    let new_key_account = get_key_account_for(&pubkey);
    let new_marker_account = get_marker_account_for(&pubkey);
    let _ = platform::store_key(SERVICE_NAME, &new_key_account, &new_marker_account, hex_str.as_bytes());
    write_fallback_key_for(&pubkey, &hex_str);

    // Add to account list
    add_to_account_list(&pubkey);

    // Cache it
    let mut cache = get_cache();
    let map = cache.get_or_insert_with(HashMap::new);
    map.insert(pubkey.clone(), sk);

    // Set as active
    let mut active = get_active();
    *active = Some(pubkey.clone());

    // Clean up legacy entries (best-effort)
    let _ = platform::delete_items(SERVICE_NAME, &legacy_account, &legacy_marker);
    let _ = platform::delete_legacy_key(SERVICE_NAME, &legacy_account);
    delete_legacy_fallback_key();

    log::info!("Migrated legacy key to multi-account storage for {}", &pubkey[..12]);
    Some(pubkey)
}

/// Load a specific account's secret key from keychain/fallback.
/// Does NOT generate a new key.
fn load_account_key(pubkey: &str) -> Result<SecretKey, String> {
    // Check cache first
    {
        let cache = get_cache();
        if let Some(map) = cache.as_ref() {
            if let Some(sk) = map.get(pubkey) {
                return Ok(*sk);
            }
        }
    }

    let key_account = get_key_account_for(pubkey);
    let marker_account = get_marker_account_for(pubkey);

    // Try keychain
    if let Some(data) = platform::read_key(SERVICE_NAME, &key_account)? {
        let hex_str = String::from_utf8(data).map_err(|e| format!("Invalid key data: {e}"))?;
        let sk = parse_hex_secret_key(&hex_str)?;
        let mut cache = get_cache();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(pubkey.to_string(), sk);
        write_fallback_key_for(pubkey, &hex_str);
        return Ok(sk);
    }

    // Try legacy keychain for this account
    if let Some(data) = platform::read_legacy_key(SERVICE_NAME, &key_account)? {
        let hex_str = String::from_utf8(data).map_err(|e| format!("Invalid key data: {e}"))?;
        let sk = parse_hex_secret_key(&hex_str)?;
        // Migrate to modern storage
        let _ = platform::store_key(SERVICE_NAME, &key_account, &marker_account, hex_str.as_bytes());
        let _ = platform::delete_legacy_key(SERVICE_NAME, &key_account);
        let mut cache = get_cache();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(pubkey.to_string(), sk);
        write_fallback_key_for(pubkey, &hex_str);
        return Ok(sk);
    }

    // Try fallback file
    if let Some(sk) = read_fallback_key_for(pubkey) {
        let mut cache = get_cache();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(pubkey.to_string(), sk);
        // Try to re-store in keychain
        let hex_str = hex::encode(sk.secret_bytes());
        let _ = platform::store_key(SERVICE_NAME, &key_account, &marker_account, hex_str.as_bytes());
        return Ok(sk);
    }

    Err(format!("No key found for account {}", &pubkey[..12.min(pubkey.len())]))
}

/// Get the active account's secret key, or generate/migrate as needed.
fn get_active_secret_key(generate: bool) -> Result<SecretKey, String> {
    // If we have an active pubkey, load that specific key
    {
        let active = get_active();
        if let Some(ref pk) = *active {
            return load_account_key(pk);
        }
    }

    // No active pubkey — try migration from legacy single-key
    if let Some(pubkey) = migrate_legacy_key() {
        return load_account_key(&pubkey);
    }

    // Check if any accounts exist in the list
    let accounts = load_account_list();
    if let Some(first) = accounts.first() {
        let mut active = get_active();
        *active = Some(first.clone());
        return load_account_key(first);
    }

    // No key found anywhere — generate if requested
    if !generate {
        return Err("No key found".to_string());
    }

    let secp = Secp256k1::new();
    let (sk, _) = secp.generate_keypair(&mut OsRng);
    let hex_str = hex::encode(sk.secret_bytes());
    let pubkey = compute_pubkey(&sk);

    // Cache immediately
    {
        let mut cache = get_cache();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(pubkey.clone(), sk);
    }
    {
        let mut active = get_active();
        *active = Some(pubkey.clone());
    }

    // Persist to keychain
    let key_account = get_key_account_for(&pubkey);
    let marker_account = get_marker_account_for(&pubkey);
    if let Err(e) = platform::store_key(
        SERVICE_NAME,
        &key_account,
        &marker_account,
        hex_str.as_bytes(),
    ) {
        log::error!("Failed to persist generated key to keychain: {e}");
    }

    // Always write fallback file
    write_fallback_key_for(&pubkey, &hex_str);

    // Add to account list
    add_to_account_list(&pubkey);

    Ok(sk)
}

// ─── Tauri commands ──────────────────────────────────────────────────────

/// Get the public key from the stored private key, or generate a new keypair
#[tauri::command]
pub fn keystore_get_public_key() -> Result<String, String> {
    let sk = get_active_secret_key(true)?;
    Ok(compute_pubkey(&sk))
}

/// Generate a brand-new keypair, store it, add to account list, set as active.
/// Unlike keystore_get_public_key, this ALWAYS creates a new key.
#[tauri::command]
pub fn keystore_generate_key() -> Result<String, String> {
    let secp = Secp256k1::new();
    let (sk, _) = secp.generate_keypair(&mut OsRng);
    let hex_str = hex::encode(sk.secret_bytes());
    let pubkey = compute_pubkey(&sk);

    // Cache immediately
    {
        let mut cache = get_cache();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(pubkey.clone(), sk);
    }
    {
        let mut active = get_active();
        *active = Some(pubkey.clone());
    }

    // Persist to keychain
    let key_account = get_key_account_for(&pubkey);
    let marker_account = get_marker_account_for(&pubkey);
    if let Err(e) = platform::store_key(
        SERVICE_NAME,
        &key_account,
        &marker_account,
        hex_str.as_bytes(),
    ) {
        log::error!("Failed to persist generated key to keychain: {e}");
    }

    write_fallback_key_for(&pubkey, &hex_str);
    add_to_account_list(&pubkey);

    Ok(pubkey)
}

/// Clear the active pubkey (on logout). Next login will pick from account list or generate.
#[tauri::command]
pub fn keystore_clear_active() -> Result<(), String> {
    let mut active = get_active();
    *active = None;
    Ok(())
}

/// Sign a Nostr event (compute id + schnorr signature)
#[tauri::command]
pub fn keystore_sign_event(serialized_event: String) -> Result<SignedEventResult, String> {
    let sk = get_active_secret_key(false)?;

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
    let sk = get_active_secret_key(false)?;
    Ok(hex::encode(sk.secret_bytes()))
}

/// Check if a private key exists in the keystore.
#[tauri::command]
pub fn keystore_has_key() -> Result<bool, String> {
    // Check cache for active pubkey
    {
        let active = get_active();
        if let Some(ref pk) = *active {
            let cache = get_cache();
            if let Some(map) = cache.as_ref() {
                if map.contains_key(pk) {
                    return Ok(true);
                }
            }
            // Check marker for the active account
            let marker_account = get_marker_account_for(pk);
            if platform::marker_exists(SERVICE_NAME, &marker_account)? {
                return Ok(true);
            }
        }
    }

    // Check if any cached key exists
    {
        let cache = get_cache();
        if let Some(map) = cache.as_ref() {
            if !map.is_empty() {
                return Ok(true);
            }
        }
    }

    // Check if any accounts exist in list
    let accounts = load_account_list();
    if !accounts.is_empty() {
        return Ok(true);
    }

    // Check legacy key (and migrate if found)
    let legacy_account = get_legacy_key_account();
    let legacy_marker = get_legacy_marker_account();

    if platform::marker_exists(SERVICE_NAME, &legacy_marker)? {
        return Ok(true);
    }

    // Check legacy keychain
    if let Some(data) = platform::read_legacy_key(SERVICE_NAME, &legacy_account)? {
        let hex_str = String::from_utf8(data).map_err(|e| format!("Invalid legacy key: {e}"))?;
        let sk = parse_hex_secret_key(&hex_str)?;
        let pubkey = compute_pubkey(&sk);

        // Cache and set active
        {
            let mut cache = get_cache();
            let map = cache.get_or_insert_with(HashMap::new);
            map.insert(pubkey.clone(), sk);
        }
        {
            let mut active = get_active();
            *active = Some(pubkey);
        }

        return Ok(true);
    }

    // Check legacy fallback file
    if read_legacy_fallback_key().is_some() {
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
    let pubkey = compute_pubkey(&sk);

    let key_account = get_key_account_for(&pubkey);
    let marker_account = get_marker_account_for(&pubkey);

    platform::store_key(SERVICE_NAME, &key_account, &marker_account, secret_hex.as_bytes())?;
    write_fallback_key_for(&pubkey, &secret_hex);

    // Update cache and set active
    {
        let mut cache = get_cache();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(pubkey.clone(), sk);
    }
    {
        let mut active = get_active();
        *active = Some(pubkey.clone());
    }

    // Add to account list
    add_to_account_list(&pubkey);

    Ok(pubkey)
}

/// Delete a private key from the keystore.
/// If pubkey is provided, delete only that account. Otherwise delete the active account.
#[tauri::command]
pub fn keystore_delete_key(pubkey: Option<String>) -> Result<(), String> {
    let target = if let Some(pk) = pubkey {
        pk
    } else {
        // Delete active account
        let active = get_active();
        match active.as_ref() {
            Some(pk) => pk.clone(),
            None => {
                // Fallback: try legacy delete
                let legacy_account = get_legacy_key_account();
                let legacy_marker = get_legacy_marker_account();
                let _ = platform::delete_items(SERVICE_NAME, &legacy_account, &legacy_marker);
                let _ = platform::delete_legacy_key(SERVICE_NAME, &legacy_account);
                delete_legacy_fallback_key();
                invalidate_cache();
                return Ok(());
            }
        }
    };

    let key_account = get_key_account_for(&target);
    let marker_account = get_marker_account_for(&target);

    platform::delete_items(SERVICE_NAME, &key_account, &marker_account)?;
    let _ = platform::delete_legacy_key(SERVICE_NAME, &key_account);
    delete_fallback_key_for(&target);
    remove_from_account_list(&target);

    // Remove from cache
    {
        let mut cache = get_cache();
        if let Some(map) = cache.as_mut() {
            map.remove(&target);
        }
    }

    // If we deleted the active account, switch to another or clear
    {
        let mut active = get_active();
        if active.as_ref() == Some(&target) {
            let accounts = load_account_list();
            *active = accounts.first().cloned();
        }
    }

    Ok(())
}

/// List all stored account pubkeys
#[tauri::command]
pub fn keystore_list_accounts() -> Result<Vec<String>, String> {
    Ok(load_account_list())
}

/// Switch the active account to a different stored pubkey
#[tauri::command]
pub fn keystore_switch_account(pubkey: String) -> Result<(), String> {
    // Verify the key exists by trying to load it
    let _sk = load_account_key(&pubkey)?;

    let mut active = get_active();
    *active = Some(pubkey);
    Ok(())
}

/// NIP-44 encrypt plaintext for a recipient
#[tauri::command]
pub fn keystore_nip44_encrypt(
    recipient_pubkey: String,
    plaintext: String,
) -> Result<String, String> {
    let sk = get_active_secret_key(false)?;
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
    let sk = get_active_secret_key(false)?;
    let pubkey = crate::nip44::xonly_to_pubkey(&sender_pubkey)?;
    let conversation_key = crate::nip44::get_conversation_key(&sk, &pubkey)?;
    crate::nip44::decrypt(&ciphertext, &conversation_key)
}

#[derive(serde::Serialize)]
pub struct SignedEventResult {
    pub id: String,
    pub sig: String,
}
