mod cloudflared;
#[cfg(test)]
mod ipc_acl_tests;
mod keystore;
#[cfg(not(dev))]
mod localhost;
mod nip44;
mod relay;
mod tunnel;

/// Top-level navigation guard for the privileged webview.
///
/// The main window is declared in `tauri.conf.json`, so the hook lives on a
/// tiny plugin (`tauri::plugin::Builder::on_navigation`), which Tauri chains
/// into every webview's navigation handler. Without it, any in-page navigation
/// an attacker can trigger (a `//evil.example` href, `location =` from injected
/// script, a form action, a meta refresh) would load a foreign page inside the
/// window that holds our IPC. IPC itself is additionally scoped to the exact
/// production origin by `capabilities/localhost.json` `remote.urls`.
///
/// Note: wry consults this handler for EVERY frame, not just the top-level
/// one, so the hosts the CSP `frame-src` allows must pass too or the YouTube /
/// Spotify / Twitter / TikTok embeds break. Those hosts never receive IPC (the
/// capability is origin-scoped), so a top-level navigation to one of them is a
/// nuisance, not an escalation — and anchors are already rerouted to the system
/// browser by `useExternalLinkHandler` before they get here.
mod nav_guard {
    use tauri::Url;

    /// Keep in sync with `app.security.csp` `frame-src` in tauri.conf.json.
    pub const EMBED_HOSTS: &[&str] = &[
        "www.youtube.com",
        "www.youtube-nocookie.com",
        "platform.twitter.com",
        "open.spotify.com",
        "www.tiktok.com",
    ];

    /// The origins the app itself is served from: the fixed production asset
    /// port (`localhost.rs`) and, in dev builds only, `build.devUrl`.
    pub fn app_origins(config: &tauri::Config) -> Vec<Url> {
        let mut origins: Vec<Url> = Vec::new();
        #[cfg(not(dev))]
        {
            let _ = config;
            if let Ok(u) = format!("http://localhost:{}", crate::localhost::PORT).parse() {
                origins.push(u);
            }
        }
        #[cfg(dev)]
        if let Some(u) = config.build.dev_url.clone() {
            origins.push(u);
        }
        origins
    }

    fn same_origin(a: &Url, b: &Url) -> bool {
        a.scheme() == b.scheme()
            && a.host_str() == b.host_str()
            && a.port_or_known_default() == b.port_or_known_default()
    }

    /// Allow only: Tauri's own asset protocol (the initial load before
    /// `localhost.rs` re-points the window; `tauri://localhost` on macOS/Linux,
    /// `http(s)://tauri.localhost` on Windows), the app origins, blank frames,
    /// and HTTPS to the iframe embed hosts. Everything else is cancelled.
    pub fn is_allowed(url: &Url, app_origins: &[Url]) -> bool {
        match url.scheme() {
            "tauri" => url.host_str() == Some("localhost"),
            "about" => matches!(url.as_str(), "about:blank" | "about:srcdoc"),
            "http" | "https" => {
                if url.host_str() == Some("tauri.localhost") {
                    return true;
                }
                if app_origins.iter().any(|o| same_origin(o, url)) {
                    return true;
                }
                url.scheme() == "https"
                    && url
                        .host_str()
                        .is_some_and(|h| EMBED_HOSTS.contains(&h))
            }
            _ => false,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn u(s: &str) -> Url {
            Url::parse(s).unwrap()
        }
        fn prod() -> Vec<Url> {
            vec![u("http://localhost:14420")]
        }

        #[test]
        fn allows_the_app_origin_and_tauris_own_protocol() {
            assert!(is_allowed(&u("http://localhost:14420/"), &prod()));
            assert!(is_allowed(&u("http://localhost:14420/space/x?y=1#z"), &prod()));
            assert!(is_allowed(&u("tauri://localhost/index.html"), &prod()));
            assert!(is_allowed(&u("http://tauri.localhost/"), &prod()));
            assert!(is_allowed(&u("https://tauri.localhost/"), &prod()));
            assert!(is_allowed(&u("about:blank"), &prod()));
            assert!(is_allowed(&u("about:srcdoc"), &prod()));
        }

        #[test]
        fn allows_a_dev_origin_only_when_listed() {
            let dev = vec![u("http://localhost:1420")];
            assert!(is_allowed(&u("http://localhost:1420/"), &dev));
            // Prod never lists the dev port: another program on :1420 is foreign.
            assert!(!is_allowed(&u("http://localhost:1420/"), &prod()));
        }

        #[test]
        fn allows_https_to_the_iframe_embed_hosts_only() {
            for h in EMBED_HOSTS {
                assert!(is_allowed(&u(&format!("https://{h}/embed/x")), &prod()), "{h}");
                assert!(!is_allowed(&u(&format!("http://{h}/embed/x")), &prod()), "http {h}");
                assert!(!is_allowed(&u(&format!("https://{h}.evil.example/")), &prod()), "suffix {h}");
                assert!(!is_allowed(&u(&format!("https://evil.example/{h}")), &prod()), "path {h}");
            }
        }

        #[test]
        fn rejects_foreign_origins_and_lookalikes() {
            // Assembled at runtime so the source never contains a `user:pass@host`
            // shaped literal (secret scanners flag it; it is a userinfo lookalike).
            let userinfo_lookalike = format!("http://localhost:14420{}evil.example/", '@');
            for s in [
                "https://evil.example/",
                "http://evil.example/",
                userinfo_lookalike.as_str(),
                "http://localhost.evil.example:14420/",
                "https://localhost:14420/", // scheme differs
                "http://localhost:14421/",  // port differs
                "http://127.0.0.1:14420/",  // host differs (capability is host-exact too)
                "http://[::1]:14420/",
                "tauri://evil.example/",
                "about:config",
            ] {
                assert!(!is_allowed(&u(s), &prod()), "{s}");
            }
        }

        #[test]
        fn rejects_non_web_schemes() {
            for s in [
                "javascript:alert(1)",
                "data:text/html,<script>alert(1)</script>",
                "file:///etc/passwd",
                "blob:http://localhost:14420/abc",
                "nostr:npub1qqqq",
                "mailto:a@b.example",
                "ws://localhost:7787/",
                "ipc://localhost/",
            ] {
                assert!(!is_allowed(&u(s), &prod()), "{s}");
            }
        }

        #[test]
        fn app_origins_never_include_a_wildcard_port() {
            // Whatever the build, every allowed app origin has an explicit port
            // (so a squatter on another local port is never same-origin).
            for o in app_origins(&tauri::Config::default()) {
                assert!(o.port().is_some(), "{o}");
                assert_eq!(o.host_str(), Some("localhost"));
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let nav_origins = nav_guard::app_origins(context.config());

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .manage(relay::EmbeddedRelayState::default())
        .manage(tunnel::TunnelState::default())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
                .on_navigation(move |_webview, url| {
                    let ok = nav_guard::is_allowed(url, &nav_origins);
                    if !ok {
                        log::warn!("blocked webview navigation to {}", url.origin().ascii_serialization());
                    }
                    ok
                })
                .build(),
        )
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
        .run(context)
        .expect("error while running tauri application");
}
