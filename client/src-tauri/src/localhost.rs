//! Production asset server on `http://localhost:14420`.
//!
//! Replaces `tauri-plugin-localhost`. The plugin bound its port on a
//! background thread and `expect`ed success, so if another local process
//! already held the port the thread died silently while the main window was
//! still navigated to that URL — i.e. whatever squatted the port was loaded
//! inside the privileged webview, with full IPC. Here the listeners are bound
//! FIRST, on the main thread, and the app refuses to start (with a native
//! error) if the loopback port is not ours.
//!
//! Serving semantics are otherwise identical to the plugin: assets from the
//! Tauri asset resolver, with Content-Type, the configured CSP and
//! `Cache-Control: no-cache`.

use std::io::ErrorKind;
use std::net::TcpListener;
use tauri::{AppHandle, Runtime};

pub const PORT: u16 = 14420;

/// Bind both loopback addresses up-front. `127.0.0.1` is required. `::1` is
/// required too when the host has IPv6 loopback (a browser resolving
/// `localhost` may try it first), but a host without IPv6 is fine.
pub fn bind() -> Result<Vec<TcpListener>, String> {
    let v4 = TcpListener::bind(("127.0.0.1", PORT))
        .map_err(|e| format!("127.0.0.1:{PORT} is not available: {e}"))?;
    let mut listeners = vec![v4];
    match TcpListener::bind(("::1", PORT)) {
        Ok(v6) => listeners.push(v6),
        Err(e) if e.kind() == ErrorKind::AddrInUse => {
            return Err(format!("[::1]:{PORT} is already in use by another program: {e}"));
        }
        Err(e) => log::warn!("IPv6 loopback unavailable, serving on IPv4 only: {e}"),
    }
    Ok(listeners)
}

/// Serve the bundled frontend on each listener (one thread per listener).
pub fn serve<R: Runtime>(app: &AppHandle<R>, listeners: Vec<TcpListener>) {
    for listener in listeners {
        let resolver = app.asset_resolver();
        std::thread::spawn(move || {
            let server = match tiny_http::Server::from_listener(listener, None) {
                Ok(s) => s,
                Err(e) => {
                    log::error!("localhost asset server failed to start: {e}");
                    return;
                }
            };
            for req in server.incoming_requests() {
                let path = req
                    .url()
                    .parse::<http::Uri>()
                    .map(|uri| uri.path().to_string())
                    .unwrap_or_else(|_| req.url().to_string());

                let Some(asset) = resolver.get(path) else {
                    let _ = req.respond(tiny_http::Response::empty(404));
                    continue;
                };

                let mut resp = tiny_http::Response::from_data(asset.bytes);
                let mut headers: Vec<(&str, String)> = vec![
                    ("Content-Type", asset.mime_type),
                    ("Cache-Control", "no-cache".to_string()),
                ];
                if let Some(csp) = asset.csp_header {
                    headers.push(("Content-Security-Policy", csp));
                }
                for (name, value) in headers {
                    if let Ok(h) = tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()) {
                        resp.add_header(h);
                    }
                }
                if let Err(e) = req.respond(resp) {
                    log::warn!("localhost asset response failed: {e}");
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_refuses_when_ipv4_port_is_taken() {
        // Hold the port ourselves, then confirm bind() reports it as taken
        // instead of silently continuing.
        let _squatter = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(l) => l,
            Err(_) => return, // port busy on this machine (e.g. the app is running) — can't assert
        };
        let err = bind().expect_err("bind must fail while the port is held");
        assert!(err.contains(&PORT.to_string()), "error should name the port: {err}");
    }

    #[test]
    fn bind_succeeds_when_port_is_free_and_holds_both_loopbacks() {
        let listeners = match bind() {
            Ok(l) => l,
            Err(_) => return, // port busy on this machine — can't assert
        };
        assert!(!listeners.is_empty());
        // While held, a second bind must fail.
        assert!(TcpListener::bind(("127.0.0.1", PORT)).is_err());
        drop(listeners);
        assert!(TcpListener::bind(("127.0.0.1", PORT)).is_ok());
    }
}
