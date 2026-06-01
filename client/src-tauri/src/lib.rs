mod cloudflared;
mod keystore;
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
        .plugin(tauri_plugin_process::init());

    // In production builds, serve from http://localhost:14420 instead of tauri://localhost
    // so that third-party iframes (YouTube embeds) get a valid HTTP Referer header.
    // Fixed port so localStorage/IndexedDB persist across launches (storage is origin-scoped).
    #[cfg(not(dev))]
    {
        builder = builder.plugin(tauri_plugin_localhost::Builder::new(14420).build());
    }

    builder
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // In production, navigate to the localhost URL for IPC access
            #[cfg(not(dev))]
            {
                use tauri::Manager;
                let main_window = app.get_webview_window("main")
                    .expect("main window not found");
                let url: tauri::Url = "http://localhost:14420".parse().unwrap();
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
