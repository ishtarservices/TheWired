mod cloudflared;
mod keystore;
#[cfg(not(dev))]
mod localhost;
mod nip44;
mod relay;
mod tunnel;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .manage(relay::EmbeddedRelayState::default())
        .manage(tunnel::TunnelState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Native dialogs are used from Rust only (secret-key reveal confirm,
        // startup errors). Deliberately NOT granted to the webview in
        // capabilities/*.json, so injected script cannot drive them.
        .plugin(tauri_plugin_dialog::init());

    // In production builds, serve from http://localhost:14420 instead of tauri://localhost
    // so that third-party iframes (YouTube embeds) get a valid HTTP Referer header.
    // Fixed port so localStorage/IndexedDB persist across launches (storage is origin-scoped).
    // The port is bound BEFORE the window is pointed at it (see localhost.rs).
    #[cfg(not(dev))]
    let asset_listeners = match localhost::bind() {
        Ok(l) => l,
        Err(e) => {
            log::error!("refusing to start: {e}");
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title("The Wired can't start")
                .set_description(format!(
                    "Another program is using local port {}, which The Wired needs to show its interface safely.\n\n{}\n\nClose that program and open The Wired again.",
                    localhost::PORT, e
                ))
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
            std::process::exit(1);
        }
    };

    builder
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Tighten any secret files left at umask-default permissions by
            // older builds (permissions only; never touches contents).
            keystore::harden_on_startup();

            // In production, serve the bundle on the port we already own and
            // navigate to it for IPC access.
            #[cfg(not(dev))]
            {
                use tauri::Manager;
                localhost::serve(app.handle(), asset_listeners);
                let main_window = app.get_webview_window("main")
                    .expect("main window not found");
                let url: tauri::Url = format!("http://localhost:{}", localhost::PORT).parse().unwrap();
                let _ = main_window.navigate(url);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            keystore::keystore_get_public_key,
            keystore::keystore_sign_event,
            keystore::keystore_has_key,
            keystore::keystore_get_secret_key,
            keystore::keystore_delete_key,
            keystore::keystore_import_key,
            keystore::keystore_list_accounts,
            keystore::keystore_switch_account,
            keystore::keystore_generate_key,
            keystore::keystore_clear_active,
            keystore::keystore_nip44_encrypt,
            keystore::keystore_nip44_decrypt,
            keystore::keystore_set_secret,
            keystore::keystore_get_secret,
            keystore::keystore_delete_secret,
            keystore::keystore_backup_status,
            keystore::keystore_mark_backed_up,
            relay::relay_start,
            relay::relay_stop,
            relay::relay_status,
            relay::relay_stats,
            relay::relay_reset,
            tunnel::tunnel_start,
            tunnel::tunnel_stop,
            tunnel::tunnel_status,
            tunnel::tunnel_named_identity,
            tunnel::tunnel_set_custom,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
