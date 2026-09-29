use hex;
use rand::rngs::OsRng;
use secp256k1::{Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use zeroize::Zeroizing;

const SERVICE_NAME: &str = "app.thewired.desktop";

/// Set by the release workflow (`WIRED_SIGNED_RELEASE=1`) for CI-built, signed
/// bundles. Only such builds may drop the plaintext identity-key fallback file.
/// On macOS, Data Protection keychain items are bound to the app's code
/// signature, so an ad-hoc/dev build that dropped the file would lose the key
/// on the next rebuild. Windows Credential Manager and Linux Secret Service are
/// not signature-bound, but one rule for every platform keeps this predictable.
const SIGNED_RELEASE_BUILD: bool = option_env!("WIRED_SIGNED_RELEASE").is_some();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FallbackPolicy {
    /// (Re)write the plaintext fallback file — the keychain alone can't be trusted yet.
    Keep,
    /// Delete the plaintext fallback file — the keychain copy is proven and the user holds a backup.
    Drop,
}

/// Decide whether an identity key's plaintext fallback file may be dropped.
/// ALL of these must hold, otherwise we keep the file (never risk key loss):
/// - `keychain_verified`: the keychain copy was read back and matched;
/// - `backed_up`: the user confirmed a backup (or imported the key, which proves they hold it);
/// - `signed_release`: this is a signed CI build (see `SIGNED_RELEASE_BUILD`).
fn fallback_policy(keychain_verified: bool, backed_up: bool, signed_release: bool) -> FallbackPolicy {
    if keychain_verified && backed_up && signed_release {
        FallbackPolicy::Drop
    } else {
        FallbackPolicy::Keep
    }
}

/// Instance suffix for dev builds with multiple instances (namespaces keychain
/// accounts AND the embedded-relay data dir so concurrent dev instances don't
/// collide).
pub(crate) fn instance_suffix() -> String {
    match std::env::var("WIRED_INSTANCE") {
        Ok(id) if !id.is_empty() && id != "0" => format!("_{}", id),
        _ => String::new(),
    }
}

/// Numeric instance index (0 when unset) — used to give each dev instance a
/// distinct, stable embedded-relay port.
pub(crate) fn instance_index() -> u16 {
    std::env::var("WIRED_INSTANCE")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0)
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

/// Generic secret keychain account name (NIP-46 bunker connection, NWC URI).
/// `key` is a caller-namespaced id like `nip46_<pubkey>` or `nwc_<pubkey>`.
fn get_secret_account_for(key: &str) -> String {
    format!("nostr_secret_{}{}", key, instance_suffix())
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

    /// Store an arbitrary secret WITHOUT biometric protection, so it can be read on every
    /// launch (NIP-46 reconnect) and every use (zap) with no Touch ID prompt. For low-value
    /// transport secrets only — never the identity key.
    pub fn store_secret(
        service: &str,
        account: &str,
        marker_account: &str,
        data: &[u8],
    ) -> Result<(), String> {
        // Avoid errSecDuplicateItem
        let _ = delete_items(service, account, marker_account);

        // Try 1: Data Protection keychain WITHOUT biometric
        {
            let mut opts = PasswordOptions::new_generic_password(service, account);
            opts.use_protected_keychain();
            if let Ok(()) = set_generic_password_options(data, opts) {
                let mut marker_opts =
                    PasswordOptions::new_generic_password(service, marker_account);
                marker_opts.use_protected_keychain();
                let _ = set_generic_password_options(b"1", marker_opts);
                return Ok(());
            }
        }

        // Try 2: Legacy keychain
        let opts = PasswordOptions::new_generic_password(service, account);
        set_generic_password_options(data, opts)
            .map_err(|e| format!("Failed to store secret in any keychain: {e}"))?;
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

    pub fn store_secret(
        service: &str,
        account: &str,
        marker_account: &str,
        data: &[u8],
    ) -> Result<(), String> {
        // keyring storage is already non-biometric
        store_key(service, account, marker_account, data)
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

/// `<platform app-data root>/app.thewired.desktop` — home of the account list,
/// fallback key files, transport-secret fallbacks and backup-ack markers.
fn app_data_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let mut dir = PathBuf::from(home);
    #[cfg(target_os = "macos")]
    dir.push("Library/Application Support");
    #[cfg(target_os = "linux")]
    dir.push(".local/share");
    #[cfg(target_os = "windows")]
    dir.push("AppData/Roaming");
    dir.push(SERVICE_NAME);
    Some(dir)
}

fn account_list_path() -> Option<PathBuf> {
    Some(app_data_dir()?.join(format!("account_list{}.json", instance_suffix())))
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

/// Verify the serialized NIP-01 event's pubkey (array index 1) matches `expected`.
fn assert_event_pubkey(serialized_event: &str, expected: &str) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_str(serialized_event)
        .map_err(|_| "malformed serialized event".to_string())?;
    let pk = v
        .get(1)
        .and_then(|p| p.as_str())
        .ok_or_else(|| "malformed serialized event".to_string())?;
    if pk.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!(
            "event pubkey {}… does not match the active signing key {}… (account switched mid-sign — retry)",
            &pk[..8.min(pk.len())],
            &expected[..8.min(expected.len())],
        ))
    }
}

fn compute_pubkey(sk: &SecretKey) -> String {
    let secp = Secp256k1::new();
    let (xonly, _) = sk.x_only_public_key(&secp);
    hex::encode(xonly.serialize())
}

fn invalidate_cache() {
    let mut cache = get_cache();
    if let Some(map) = cache.as_mut() {
        for (_, sk) in map.iter_mut() {
            sk.non_secure_erase();
        }
    }
    *cache = None;
}

/// File-based fallback path for a specific account's secret key.
fn fallback_key_path_in(dir: &Path, pubkey: &str) -> PathBuf {
    dir.join(format!("{}.key", get_key_account_for(pubkey)))
}

fn fallback_key_path_for(pubkey: &str) -> Option<PathBuf> {
    Some(fallback_key_path_in(&app_data_dir()?, pubkey))
}

/// Marker file recording that the user confirmed they hold a backup of this
/// key (onboarding checkbox, Settings "I've saved my key", or an import — which
/// proves possession). Its presence is one of the three conditions for dropping
/// the plaintext fallback (see `fallback_policy`).
fn backup_ack_path_in(dir: &Path, pubkey: &str) -> PathBuf {
    dir.join(format!("nostr_backup_ack_{}{}", pubkey, instance_suffix()))
}

fn backup_ack_path_for(pubkey: &str) -> Option<PathBuf> {
    Some(backup_ack_path_in(&app_data_dir()?, pubkey))
}

fn is_backed_up(pubkey: &str) -> bool {
    backup_ack_path_for(pubkey).map(|p| p.exists()).unwrap_or(false)
}

fn write_backup_ack(pubkey: &str) {
    if let Some(path) = backup_ack_path_for(pubkey) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&path, b"") {
            log::warn!("Failed to write backup-ack marker: {e}");
        }
    }
}

fn delete_backup_ack(pubkey: &str) {
    if let Some(path) = backup_ack_path_for(pubkey) {
        let _ = std::fs::remove_file(path);
    }
}

/// Legacy fallback path (single-key era)
fn legacy_fallback_key_path() -> Option<PathBuf> {
    Some(app_data_dir()?.join(format!("{}.key", get_legacy_key_account())))
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

/// Restrict a plaintext fallback file (and its parent dir) to owner-only on
/// Unix. The fallback is only ever written when the OS keychain is unavailable;
/// when it must exist, it should at least not be group/other-readable or copied
/// into backups with loose permissions. No-op on Windows (ACLs differ).
fn harden_perms(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(parent) = path.parent() {
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

/// Write a secret file that is owner-only from the moment it exists. On Unix
/// the file is created with mode 0600 (no umask window); `harden_perms` then
/// also tightens the parent directory. Truncates any existing file.
fn write_private(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(contents)?;
    f.sync_all()?;
    harden_perms(path);
    Ok(())
}

/// One-time-per-launch sweep: tighten every `*.key` / `*.secret` file in the
/// app data dir (and the dir itself) to owner-only. Files written before
/// `harden_perms` existed were left at the umask default (0644). Permissions
/// only — never touches contents, never deletes.
pub(crate) fn harden_existing_files(dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        for entry in entries.flatten() {
            let path = entry.path();
            let is_secret = matches!(
                path.extension().and_then(|e| e.to_str()),
                Some("key") | Some("secret")
            );
            if is_secret && path.is_file() {
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
    }
}

pub(crate) fn harden_on_startup() {
    if let Some(dir) = app_data_dir() {
        harden_existing_files(&dir);
    }
}

fn write_fallback_key_for(pubkey: &str, hex_str: &str) {
    if let Some(path) = fallback_key_path_for(pubkey) {
        if let Err(e) = write_private(&path, hex_str.as_bytes()) {
            log::warn!("Failed to write fallback key file: {e}");
        }
    }
}

/// Does a keychain copy of this account's key read back identical to `expected`?
/// Checks the Data Protection keychain first, then the legacy keychain. On macOS
/// this can prompt (Touch ID / keychain password), so callers only invoke it when
/// the answer could actually change the fallback decision.
fn keychain_key_roundtrips(key_account: &str, expected: &[u8]) -> bool {
    if let Ok(Some(read)) = platform::read_key(SERVICE_NAME, key_account) {
        return read.as_slice() == expected;
    }
    matches!(platform::read_legacy_key(SERVICE_NAME, key_account), Ok(Some(read)) if read.as_slice() == expected)
}

/// Verify the keychain copy ONLY if a positive answer could lead to dropping
/// the fallback (signed build + backed up). Otherwise skip the (possibly
/// prompting) read and report unverified, which keeps the file.
fn verify_if_droppable(pubkey: &str, key_account: &str, hex_str: &str) -> bool {
    if !(SIGNED_RELEASE_BUILD && is_backed_up(pubkey)) {
        return false;
    }
    keychain_key_roundtrips(key_account, hex_str.as_bytes())
}

/// Apply `fallback_policy` for this account: drop the plaintext file when the
/// keychain copy is proven, the user holds a backup and this is a signed build;
/// otherwise (re)write it so the key can never be lost.
fn settle_fallback(pubkey: &str, hex_str: &str, keychain_verified: bool) {
    match fallback_policy(keychain_verified, is_backed_up(pubkey), SIGNED_RELEASE_BUILD) {
        FallbackPolicy::Drop => {
            if fallback_key_path_for(pubkey).map(|p| p.exists()).unwrap_or(false) {
                log::info!("keychain verified + backup confirmed: dropping plaintext fallback for {}", &pubkey[..12.min(pubkey.len())]);
            }
            delete_fallback_key_for(pubkey);
        }
        FallbackPolicy::Keep => write_fallback_key_for(pubkey, hex_str),
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

/// File-based fallback path for a generic secret (mirrors the per-account key fallback files).
fn secret_fallback_path(key: &str) -> Option<PathBuf> {
    Some(app_data_dir()?.join(format!("{}.secret", get_secret_account_for(key))))
}

fn write_secret_fallback(key: &str, value: &str) {
    if let Some(path) = secret_fallback_path(key) {
        if let Err(e) = write_private(&path, value.as_bytes()) {
            log::warn!("Failed to write secret fallback file: {e}");
        }
    }
}

fn read_secret_fallback(key: &str) -> Option<String> {
    let path = secret_fallback_path(key)?;
    let s = std::fs::read_to_string(&path).ok()?;
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn delete_secret_fallback(key: &str) {
    if let Some(path) = secret_fallback_path(key) {
        let _ = std::fs::remove_file(path);
    }
}

/// Migrate a single-key legacy store to the multi-account scheme.
/// Returns the migrated pubkey if migration occurred.
fn migrate_legacy_key() -> Option<String> {
    let legacy_account = get_legacy_key_account();
    let legacy_marker = get_legacy_marker_account();

    // Try to read from legacy keychain locations
    let hex_str: Zeroizing<String> = if let Ok(Some(data)) = platform::read_key(SERVICE_NAME, &legacy_account) {
        Zeroizing::new(String::from_utf8(data).ok()?)
    } else if let Ok(Some(data)) = platform::read_legacy_key(SERVICE_NAME, &legacy_account) {
        Zeroizing::new(String::from_utf8(data).ok()?)
    } else if let Some(sk) = read_legacy_fallback_key() {
        Zeroizing::new(hex::encode(sk.secret_bytes()))
    } else {
        return None;
    };

    let sk = parse_hex_secret_key(&hex_str).ok()?;
    let pubkey = compute_pubkey(&sk);

    // Store under new per-account naming
    let new_key_account = get_key_account_for(&pubkey);
    let new_marker_account = get_marker_account_for(&pubkey);
    let _ = platform::store_key(SERVICE_NAME, &new_key_account, &new_marker_account, hex_str.as_bytes());
    // Unverified migration: keep the file.
    settle_fallback(&pubkey, &hex_str, false);

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

    // Try keychain. A successful read IS the verification: the keychain copy
    // demonstrably round-trips, so the fallback may be dropped if the other
    // two policy conditions hold.
    if let Some(data) = platform::read_key(SERVICE_NAME, &key_account)? {
        let hex_str = Zeroizing::new(String::from_utf8(data).map_err(|e| format!("Invalid key data: {e}"))?);
        let sk = parse_hex_secret_key(&hex_str)?;
        let mut cache = get_cache();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(pubkey.to_string(), sk);
        settle_fallback(pubkey, &hex_str, true);
        return Ok(sk);
    }

    // Try legacy keychain for this account
    if let Some(data) = platform::read_legacy_key(SERVICE_NAME, &key_account)? {
        let hex_str = Zeroizing::new(String::from_utf8(data).map_err(|e| format!("Invalid key data: {e}"))?);
        let sk = parse_hex_secret_key(&hex_str)?;
        // Migrate to modern storage. The legacy item is deleted below, so the
        // NEW item must round-trip before the file can go.
        let stored = platform::store_key(SERVICE_NAME, &key_account, &marker_account, hex_str.as_bytes()).is_ok();
        let verified = stored && verify_if_droppable(pubkey, &key_account, &hex_str);
        if stored {
            let _ = platform::delete_legacy_key(SERVICE_NAME, &key_account);
        }
        let mut cache = get_cache();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(pubkey.to_string(), sk);
        settle_fallback(pubkey, &hex_str, verified);
        return Ok(sk);
    }

    // Try fallback file
    if let Some(sk) = read_fallback_key_for(pubkey) {
        let mut cache = get_cache();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(pubkey.to_string(), sk);
        // Try to re-store in keychain; only trust it once it reads back.
        let hex_str = Zeroizing::new(hex::encode(sk.secret_bytes()));
        let stored = platform::store_key(SERVICE_NAME, &key_account, &marker_account, hex_str.as_bytes()).is_ok();
        let verified = stored && verify_if_droppable(pubkey, &key_account, &hex_str);
        settle_fallback(pubkey, &hex_str, verified);
        return Ok(sk);
    }

    Err(format!("No key found for account {}", &pubkey[..12.min(pubkey.len())]))
}

/// Get the active account's secret key (migrating legacy storage or falling
/// back to the first listed account). NEVER generates: minting an identity as a
/// side effect of a read produced orphan keys on disk. Use `keystore_generate_key`.
fn get_active_secret_key() -> Result<SecretKey, String> {
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

    Err("No key found".to_string())
}

// ─── Tauri commands ──────────────────────────────────────────────────────

/// Get the public key of the active stored private key. Errors when no key
/// exists — it never generates one (see `keystore_generate_key`).
#[tauri::command]
pub fn keystore_get_public_key() -> Result<String, String> {
    let sk = get_active_secret_key()?;
    Ok(compute_pubkey(&sk))
}

/// Generate a brand-new keypair, store it, add to account list, set as active.
/// Unlike keystore_get_public_key, this ALWAYS creates a new key.
#[tauri::command]
pub fn keystore_generate_key() -> Result<String, String> {
    let secp = Secp256k1::new();
    let (sk, _) = secp.generate_keypair(&mut OsRng);
    let hex_str = Zeroizing::new(hex::encode(sk.secret_bytes()));
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

    // A brand-new key has no backup yet, so the policy always keeps the file
    // until the user confirms one (`keystore_mark_backed_up`).
    delete_backup_ack(&pubkey);
    settle_fallback(&pubkey, &hex_str, false);
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
    let sk = get_active_secret_key()?;

    // #116 — bind the signature to the active identity. The canonical NIP-01
    // serialization is [0, pubkey, created_at, kind, tags, content]; index 1 is
    // exactly what gets hashed. If it doesn't match the active key (e.g. the
    // account was switched mid-sign), refuse rather than emit a silently
    // misattributed / invalid signature.
    assert_event_pubkey(&serialized_event, &compute_pubkey(&sk))?;

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

/// Return the hex-encoded secret key for display/export (Settings reveal,
/// onboarding backup, QR). This is the ONE command that hands the raw key to
/// the webview, so it is gated by a native OS confirm dialog that injected
/// script cannot click through, and on macOS it re-reads the Data Protection
/// keychain item (USER_PRESENCE → fresh Touch ID / passcode) instead of the
/// in-memory cache when that item exists. Async so the blocking dialog runs off
/// the main thread.
#[tauri::command]
pub async fn keystore_get_secret_key(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let confirmed = app
        .dialog()
        .message(
            "The Wired is about to show your secret key (nsec). Anyone who sees it has full control of your identity.\n\nOnly continue if you just asked for this in Settings or during setup.",
        )
        .title("Reveal secret key?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Reveal".into(), "Cancel".into()))
        .blocking_show();
    if !confirmed {
        return Err("Secret key reveal cancelled".to_string());
    }

    let sk = fresh_active_secret_key()?;
    log::warn!("secret key exported to the UI for {}", &compute_pubkey(&sk)[..12]);
    Ok(hex::encode(sk.secret_bytes()))
}

/// Like `get_active_secret_key`, but prefers a fresh Data Protection keychain
/// read over the cache so biometric-protected items re-prompt. Falls back to
/// the normal path when the item isn't in that keychain (legacy tier, other OS).
fn fresh_active_secret_key() -> Result<SecretKey, String> {
    let active = get_active().clone();
    if let Some(pk) = active {
        let key_account = get_key_account_for(&pk);
        if let Ok(Some(data)) = platform::read_key(SERVICE_NAME, &key_account) {
            let hex_str = Zeroizing::new(String::from_utf8(data).map_err(|e| format!("Invalid key data: {e}"))?);
            let sk = parse_hex_secret_key(&hex_str)?;
            if compute_pubkey(&sk) == pk {
                return Ok(sk);
            }
        }
    }
    get_active_secret_key()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    /// The user confirmed a backup of the active key (or imported it).
    pub backed_up: bool,
    /// A plaintext fallback file for the active key currently exists on disk.
    pub fallback_present: bool,
    /// Signed CI build: the only kind allowed to drop the fallback file.
    pub signed_release: bool,
}

fn backup_status_for(pubkey: &str) -> BackupStatus {
    BackupStatus {
        backed_up: is_backed_up(pubkey),
        fallback_present: fallback_key_path_for(pubkey).map(|p| p.exists()).unwrap_or(false),
        signed_release: SIGNED_RELEASE_BUILD,
    }
}

/// Backup state of the active account (drives the Settings "back up your key" banner).
#[tauri::command]
pub fn keystore_backup_status() -> Result<BackupStatus, String> {
    let active = get_active().clone().ok_or_else(|| "No active account".to_string())?;
    Ok(backup_status_for(&active))
}

/// The user confirmed they hold a backup of the active key. Records the marker
/// and, if the keychain copy verifiably round-trips on a signed build, drops
/// the plaintext fallback file. Returns the resulting status.
#[tauri::command]
pub fn keystore_mark_backed_up() -> Result<BackupStatus, String> {
    let active = get_active().clone().ok_or_else(|| "No active account".to_string())?;
    write_backup_ack(&active);
    let sk = load_account_key(&active)?;
    let hex_str = Zeroizing::new(hex::encode(sk.secret_bytes()));
    let key_account = get_key_account_for(&active);
    let verified = verify_if_droppable(&active, &key_account, &hex_str);
    settle_fallback(&active, &hex_str, verified);
    Ok(backup_status_for(&active))
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
    let secret_hex = Zeroizing::new(secret_hex);
    let secret_bytes = Zeroizing::new(hex::decode(&*secret_hex).map_err(|e| format!("Invalid hex: {e}"))?);
    let sk =
        SecretKey::from_slice(&secret_bytes).map_err(|e| format!("Invalid secret key: {e}"))?;
    let pubkey = compute_pubkey(&sk);

    let key_account = get_key_account_for(&pubkey);
    let marker_account = get_marker_account_for(&pubkey);

    platform::store_key(SERVICE_NAME, &key_account, &marker_account, secret_hex.as_bytes())?;
    // The user just typed/scanned this key, so they demonstrably hold a copy.
    write_backup_ack(&pubkey);
    let verified = verify_if_droppable(&pubkey, &key_account, &secret_hex);
    settle_fallback(&pubkey, &secret_hex, verified);

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
    delete_backup_ack(&target);
    remove_from_account_list(&target);

    // Remove from cache and scrub the bytes
    {
        let mut cache = get_cache();
        if let Some(map) = cache.as_mut() {
            if let Some(mut sk) = map.remove(&target) {
                sk.non_secure_erase();
            }
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
    let sk = get_active_secret_key()?;
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
    let sk = get_active_secret_key()?;
    let pubkey = crate::nip44::xonly_to_pubkey(&sender_pubkey)?;
    let conversation_key = crate::nip44::get_conversation_key(&sk, &pubkey)?;
    crate::nip44::decrypt(&ciphertext, &conversation_key)
}

/// Store an arbitrary secret string (NIP-46 bunker connection, NWC URI) WITHOUT biometric
/// protection, keyed by a caller-namespaced id. Best-effort keychain + plaintext file fallback
/// (consistent with the existing per-account key fallback).
#[tauri::command]
pub fn keystore_set_secret(key: String, value: String) -> Result<(), String> {
    let account = get_secret_account_for(&key);
    let marker = format!("{}_marker", account);
    // Keychain-first, but only drop the plaintext file fallback once we've VERIFIED
    // the secret actually round-trips. Some environments (unsigned/ad-hoc builds,
    // a broken Data Protection keychain on macOS) report a successful write yet
    // can't read the item back on relaunch — there we MUST keep the file fallback
    // or the secret is silently lost on restart. (Transport secrets only — the
    // identity key keeps its own always-on fallback.)
    if store_secret_verified(&account, &marker, value.as_bytes()) {
        delete_secret_fallback(&key);
    } else {
        log::warn!("keychain unverified for secret '{key}'; keeping owner-only file fallback");
        write_secret_fallback(&key, &value);
    }
    Ok(())
}

/// Write a secret to the keychain and confirm it reads back identically. Returns
/// false if the write failed OR the read-back didn't match (keychain unreliable).
fn store_secret_verified(account: &str, marker: &str, value: &[u8]) -> bool {
    if platform::store_secret(SERVICE_NAME, account, marker, value).is_err() {
        return false;
    }
    matches!(platform::read_key(SERVICE_NAME, account), Ok(Some(read)) if read.as_slice() == value)
}

/// Read a secret stored via keystore_set_secret. Returns None if absent.
#[tauri::command]
pub fn keystore_get_secret(key: String) -> Result<Option<String>, String> {
    let account = get_secret_account_for(&key);
    if let Ok(Some(data)) = platform::read_key(SERVICE_NAME, &account) {
        if let Ok(s) = String::from_utf8(data) {
            if !s.is_empty() {
                // Keychain is authoritative — clean up any stale plaintext copy
                // left by the pre-hardening "always write fallback" behavior.
                delete_secret_fallback(&key);
                return Ok(Some(s));
            }
        }
    }
    // Legacy/last-resort plaintext fallback: try to migrate it into the keychain
    // and delete the file ONLY if the keychain write verifiably round-trips (else
    // keep the file — see keystore_set_secret).
    if let Some(s) = read_secret_fallback(&key) {
        let marker = format!("{}_marker", account);
        if store_secret_verified(&account, &marker, s.as_bytes()) {
            delete_secret_fallback(&key);
        }
        return Ok(Some(s));
    }
    Ok(None)
}

/// Delete a secret stored via keystore_set_secret.
#[tauri::command]
pub fn keystore_delete_secret(key: String) -> Result<(), String> {
    let account = get_secret_account_for(&key);
    let marker = format!("{}_marker", account);
    let _ = platform::delete_items(SERVICE_NAME, &account, &marker);
    delete_secret_fallback(&key);
    Ok(())
}

#[derive(serde::Serialize)]
pub struct SignedEventResult {
    pub id: String,
    pub sig: String,
}

#[cfg(test)]
mod sign_guard_tests {
    use super::*;

    // PROBE #116 — keystore_sign_event must refuse to sign an event whose embedded
    // pubkey doesn't match the active signing key.
    const ACTIVE: &str = "1111111111111111111111111111111111111111111111111111111111111111";

    fn event_with_pubkey(pk: &str) -> String {
        format!(r#"[0,"{pk}",1700000000,1,[],"hi"]"#)
    }

    #[test]
    fn accepts_matching_pubkey() {
        assert!(assert_event_pubkey(&event_with_pubkey(ACTIVE), ACTIVE).is_ok());
    }

    #[test]
    fn rejects_mismatched_pubkey() {
        let other = "2222222222222222222222222222222222222222222222222222222222222222";
        assert!(assert_event_pubkey(&event_with_pubkey(other), ACTIVE).is_err());
    }

    #[test]
    fn rejects_malformed_event() {
        assert!(assert_event_pubkey("not json", ACTIVE).is_err());
        assert!(assert_event_pubkey("[0]", ACTIVE).is_err());
    }
}

#[cfg(test)]
mod fallback_policy_tests {
    use super::*;

    #[test]
    fn drops_only_when_all_three_hold() {
        assert_eq!(fallback_policy(true, true, true), FallbackPolicy::Drop);
        assert_eq!(fallback_policy(false, true, true), FallbackPolicy::Keep);
        assert_eq!(fallback_policy(true, false, true), FallbackPolicy::Keep);
        assert_eq!(fallback_policy(true, true, false), FallbackPolicy::Keep);
        assert_eq!(fallback_policy(false, false, false), FallbackPolicy::Keep);
    }

    #[test]
    fn dev_and_local_builds_are_never_signed_release() {
        // The test binary is never built by the release workflow.
        assert!(!SIGNED_RELEASE_BUILD);
    }

    #[test]
    fn fallback_and_ack_paths_are_per_account_and_instance() {
        let dir = Path::new("/tmp/x");
        let a = fallback_key_path_in(dir, "aa");
        let b = fallback_key_path_in(dir, "bb");
        assert_ne!(a, b);
        assert!(a.to_string_lossy().ends_with("nostr_pk_aa.key") || a.to_string_lossy().contains("nostr_pk_aa_"));
        let ack = backup_ack_path_in(dir, "aa");
        assert!(ack.to_string_lossy().contains("nostr_backup_ack_aa"));
        assert_ne!(ack, a);
    }

    #[cfg(unix)]
    #[test]
    fn write_private_creates_owner_only_files() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("wired_keystore_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("k.key");
        write_private(&path, b"secret").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"secret");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        // Overwrite truncates and stays private.
        write_private(&path, b"x").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"x");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn harden_sweep_tightens_secret_files_only_and_keeps_contents() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("wired_harden_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        let key = dir.join("nostr_pk_abc.key");
        let secret = dir.join("nostr_secret_nwc.secret");
        let list = dir.join("account_list.json");
        for (p, body) in [(&key, "deadbeef"), (&secret, "nwc://x"), (&list, "[]")] {
            std::fs::write(p, body).unwrap();
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o644)).unwrap();
        }

        harden_existing_files(&dir);

        assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        assert_eq!(std::fs::metadata(&key).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(&secret).unwrap().permissions().mode() & 0o777, 0o600);
        // Non-secret files are left alone.
        assert_eq!(std::fs::metadata(&list).unwrap().permissions().mode() & 0o777, 0o644);
        // Contents untouched, nothing deleted.
        assert_eq!(std::fs::read_to_string(&key).unwrap(), "deadbeef");
        assert_eq!(std::fs::read_to_string(&secret).unwrap(), "nwc://x");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn harden_sweep_on_missing_dir_is_a_noop() {
        harden_existing_files(Path::new("/definitely/not/here/wired"));
    }
}

#[cfg(test)]
mod secret_tests {
    use super::*;

    #[test]
    fn secret_account_name_is_namespaced() {
        let acct = get_secret_account_for("nwc_abc");
        assert!(acct.starts_with("nostr_secret_nwc_abc"));
    }

    #[test]
    fn secret_file_fallback_roundtrip() {
        let key = "__wired_secret_test_roundtrip__";
        // Skip when there's no HOME (no fallback path available in this env).
        if secret_fallback_path(key).is_none() {
            return;
        }
        delete_secret_fallback(key);
        assert_eq!(read_secret_fallback(key), None);

        write_secret_fallback(key, "nostr+walletconnect://example");
        assert_eq!(
            read_secret_fallback(key),
            Some("nostr+walletconnect://example".to_string())
        );

        delete_secret_fallback(key);
        assert_eq!(read_secret_fallback(key), None);
    }
}
