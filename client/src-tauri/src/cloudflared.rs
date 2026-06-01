//! Download-on-enable of the `cloudflared` helper (Decentralized Spaces M7).
//!
//! Per PACKAGES_DESIGN §0.3/§1 this is the sanctioned pattern: we ship a
//! notarized DMG (not the Mac App Store), and Cloudflare signs + notarizes the
//! macOS `cloudflared`, so Gatekeeper launches it. We fetch it into
//! `app_local_data_dir()/embedded_relay/bin/` as a SEPARATE process — never into
//! the app bundle — so our own notarization is unaffected (no `externalBin`,
//! no Tauri #11992).
//!
//! v1 pulls the latest release over HTTPS (TLS authenticates Cloudflare; macOS
//! notarization authenticates the binary at exec time). Pinning a version +
//! verifying a hardcoded SHA-256 is the hardening follow-up — the hook is below.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const LATEST_BASE: &str =
    "https://github.com/cloudflare/cloudflared/releases/latest/download";

/// Pin a release tag here to make the download reproducible AND enforce the
/// SHA-256 table below (fail-closed). While this is `None` we fetch `latest`
/// and can only warn that the binary is unverified.
///
/// To harden: set this to a tag (e.g. `"2024.8.2"`), then fill `expected_sha256`
/// with each asset's hash from that release. The download then refuses to run a
/// binary whose hash doesn't match.
const PINNED_VERSION: Option<&str> = None;

/// SHA-256 of each release asset for `PINNED_VERSION`. Returns `None` until
/// populated — in which case the download is allowed but logged as unverified.
fn expected_sha256(_asset: &str) -> Option<&'static str> {
    // match _asset {
    //     "cloudflared-darwin-arm64.tgz" => Some("<sha256-hex>"),
    //     "cloudflared-linux-amd64"      => Some("<sha256-hex>"),
    //     ...
    // }
    None
}

/// The release asset for this platform, and whether it's a `.tgz` (macOS) that
/// must be extracted vs. a raw binary (Linux/Windows).
fn asset_for_platform() -> Option<(&'static str, bool)> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    Some(match (os, arch) {
        ("macos", "aarch64") => ("cloudflared-darwin-arm64.tgz", true),
        ("macos", "x86_64") => ("cloudflared-darwin-amd64.tgz", true),
        ("linux", "x86_64") => ("cloudflared-linux-amd64", false),
        ("linux", "aarch64") => ("cloudflared-linux-arm64", false),
        ("linux", "arm") => ("cloudflared-linux-arm", false),
        ("windows", "x86_64") => ("cloudflared-windows-amd64.exe", false),
        ("windows", "x86") => ("cloudflared-windows-386.exe", false),
        _ => return None,
    })
}

/// Where the managed cloudflared binary lives.
pub fn binary_path(base_dir: &Path) -> PathBuf {
    let name = if cfg!(windows) { "cloudflared.exe" } else { "cloudflared" };
    base_dir.join("bin").join(name)
}

/// Ensure `cloudflared` exists under `base_dir`, downloading it on first use.
/// Returns the path to the executable.
pub async fn ensure(base_dir: &Path) -> Result<PathBuf, String> {
    let dest = binary_path(base_dir);
    if dest.is_file() {
        return Ok(dest);
    }

    let (asset, is_tgz) = asset_for_platform()
        .ok_or_else(|| "no cloudflared build for this OS/architecture".to_string())?;
    let base = match PINNED_VERSION {
        Some(v) => format!("https://github.com/cloudflare/cloudflared/releases/download/{v}"),
        None => LATEST_BASE.to_string(),
    };
    let url = format!("{base}/{asset}");
    log::info!("Downloading cloudflared: {url}");

    let bytes = reqwest::get(&url)
        .await
        .map_err(|e| format!("download cloudflared: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download cloudflared (status): {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("read cloudflared body: {e}"))?;

    // Integrity: verify against the pinned SHA-256 if we have one (fail-closed);
    // otherwise warn loudly. We execute this binary, so this matters.
    match expected_sha256(asset) {
        Some(expected) => {
            let got = hex::encode(Sha256::digest(&bytes));
            if !got.eq_ignore_ascii_case(expected) {
                return Err(format!(
                    "cloudflared checksum mismatch (expected {expected}, got {got}) — refusing to install"
                ));
            }
        }
        None => log::warn!(
            "cloudflared downloaded WITHOUT a pinned checksum — set PINNED_VERSION + expected_sha256 to enforce"
        ),
    }

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create bin dir: {e}"))?;
    }

    if is_tgz {
        extract_from_tgz(&bytes, &dest)?;
    } else {
        std::fs::write(&dest, &bytes).map_err(|e| format!("write cloudflared: {e}"))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest)
            .map_err(|e| format!("stat cloudflared: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest, perms).map_err(|e| format!("chmod cloudflared: {e}"))?;
    }

    // macOS: actively verify the binary's code signature is intact + valid
    // (Cloudflare signs + notarizes their builds). Catches tampering even
    // without a pinned hash; a file we wrote ourselves wouldn't otherwise be
    // checked by Gatekeeper at exec (no quarantine xattr).
    #[cfg(target_os = "macos")]
    verify_macos_signature(&dest).await?;

    log::info!("cloudflared installed at {}", dest.display());
    Ok(dest)
}

/// Reject a downloaded binary whose code signature is missing/broken.
#[cfg(target_os = "macos")]
async fn verify_macos_signature(path: &Path) -> Result<(), String> {
    let out = tokio::process::Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(path)
        .output()
        .await
        .map_err(|e| format!("codesign verify: {e}"))?;
    if !out.status.success() {
        let _ = std::fs::remove_file(path); // don't leave an unverified binary around
        return Err(
            "downloaded cloudflared failed code-signature verification (possible tampering)"
                .to_string(),
        );
    }
    Ok(())
}

/// Extract the `cloudflared` entry from a gzip'd tar archive into `dest`.
fn extract_from_tgz(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let gz = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(gz);
    for entry in archive.entries().map_err(|e| format!("read archive: {e}"))? {
        let mut entry = entry.map_err(|e| format!("archive entry: {e}"))?;
        let is_cloudflared = entry
            .path()
            .map(|p| p.file_name().and_then(|n| n.to_str()) == Some("cloudflared"))
            .unwrap_or(false);
        if is_cloudflared {
            let mut out = std::fs::File::create(dest).map_err(|e| format!("create file: {e}"))?;
            std::io::copy(&mut entry, &mut out).map_err(|e| format!("extract: {e}"))?;
            return Ok(());
        }
    }
    Err("cloudflared binary not found in archive".to_string())
}
