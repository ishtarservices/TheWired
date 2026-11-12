// The app's own IPC commands, by name.
//
// This file is shared by `build.rs` (via `include!`) and the crate, so keep it
// to this one constant: no `use`, no module docs, nothing build.rs can't take.
//
// Why the list exists: production builds serve the UI from
// `http://localhost:14420` (`localhost.rs`), which Tauri treats as a remote
// origin. From Tauri 2.12 on, every command invoked from a remote origin is
// checked against the ACL, the app's own commands included, and a command
// with no permission entry is rejected. `build.rs` hands this list to
// `tauri_build::AppManifest::commands`, which generates an `allow-<command>`
// permission for each, and `capabilities/app-commands.json` grants them to the
// main window on the dev origin and on exactly the production origin.
//
// Adding a command takes three edits, checked by the tests in `lib.rs`:
//   1. `generate_handler!` in `lib.rs`
//   2. this list
//   3. `capabilities/app-commands.json` (`allow-` + the name with dashes)
// Miss one and the command is refused with "not allowed by ACL".
pub const APP_COMMANDS: &[&str] = &[
    "keystore_get_public_key",
    "keystore_sign_event",
    "keystore_has_key",
    "keystore_get_secret_key",
    "keystore_delete_key",
    "keystore_import_key",
    "keystore_list_accounts",
    "keystore_switch_account",
    "keystore_generate_key",
    "keystore_clear_active",
    "keystore_nip44_encrypt",
    "keystore_nip44_decrypt",
    "keystore_set_secret",
    "keystore_get_secret",
    "keystore_delete_secret",
    "keystore_backup_status",
    "keystore_mark_backed_up",
    "relay_start",
    "relay_stop",
    "relay_status",
    "relay_stats",
    "relay_reset",
    "tunnel_start",
    "tunnel_stop",
    "tunnel_status",
    "tunnel_named_identity",
    "tunnel_set_custom",
];
