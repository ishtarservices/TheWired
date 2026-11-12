// `APP_COMMANDS`: the app's own IPC commands (shared with the crate).
include!("src/app_commands.rs");

fn main() {
  // keystore.rs reads this at compile time (option_env!) to decide whether the
  // plaintext key fallback may ever be dropped. Rebuild when it changes.
  println!("cargo:rerun-if-env-changed=WIRED_SIGNED_RELEASE");
  println!("cargo:rerun-if-changed=src/app_commands.rs");

  // Give every app command an `allow-<command>` permission so the capability
  // files can grant them. Without this manifest the production origin, which
  // Tauri treats as remote, cannot call any of them (see src/app_commands.rs).
  let attributes = tauri_build::Attributes::new()
    .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS));
  tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
