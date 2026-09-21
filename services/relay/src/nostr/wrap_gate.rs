//! NIP-17 gift-wrap read gate + NIP-40 expiration helpers (docs/DM_WIRE_CONTRACT.md §7).
//!
//! A kind-1059 wrap carries no `h` tag and no `visibility` tag, so the generic
//! visibility rules classify it as *public* — which is exactly wrong: NIP-17
//! says relays SHOULD serve wraps only to the p-tagged recipient behind NIP-42
//! AUTH. This module is the single place that rule lives; the Postgres store,
//! the SQLite store, the NIP-50 search path and the live broadcast filter all
//! consult it so the two query paths cannot drift.
//!
//! Pure functions only (no DB, no async) so they are unit-testable and shared.

use crate::nostr::event::Event;

/// NIP-59 gift wrap.
pub const KIND_GIFT_WRAP: i32 = 1059;

/// How the relay treats kind-1059 reads from a connection that is not the
/// recipient (`RELAY_WRAP_AUTH_GATE`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WrapAuthGate {
    /// Serve wraps only to their authenticated recipient (default).
    Enforce,
    /// Serve as before but log every would-be denial — the first production
    /// release runs here so clients that don't yet re-REQ after AUTH keep
    /// working while we measure.
    Warn,
    /// Pre-contract behaviour (tests / emergencies only).
    Off,
}

impl WrapAuthGate {
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "warn" => WrapAuthGate::Warn,
            "off" | "0" | "false" => WrapAuthGate::Off,
            _ => WrapAuthGate::Enforce,
        }
    }
}

/// The read-side context a stored query or a broadcast decision is made in.
#[derive(Debug, Clone, Copy)]
pub struct ReadCtx<'a> {
    /// The NIP-42-authenticated pubkey of the connection, if any.
    pub authed: Option<&'a str>,
    /// True when the connection may read EVERY wrap: the ingest role (the
    /// backend push planner, which only ever learns the `p` tag it already
    /// sees today), or a gate mode other than `Enforce`.
    pub serve_all_wraps: bool,
    /// Unix seconds "now" for NIP-40 checks.
    pub now: i64,
}

impl<'a> ReadCtx<'a> {
    /// The plain, pre-contract context (used by callers that predate the
    /// gate and by tests): no ingest role, gate enforced, wall-clock now.
    pub fn plain(authed: Option<&'a str>) -> Self {
        ReadCtx { authed, serve_all_wraps: false, now: unix_now() }
    }
}

pub fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The event's NIP-40 `expiration` tag as unix seconds, if present and numeric.
pub fn event_expiration(event: &Event) -> Option<i64> {
    event
        .get_tag_value("expiration")
        .and_then(|v| v.trim().parse::<i64>().ok())
}

/// NIP-40: expired when `expiration <= now`.
pub fn is_expired(event: &Event, now: i64) -> bool {
    matches!(event_expiration(event), Some(exp) if exp <= now)
}

/// May this connection receive this kind-1059 wrap? Non-wraps are never
/// gated here (the caller applies the ordinary visibility rules to them).
pub fn wrap_visible(event: &Event, ctx: &ReadCtx<'_>) -> bool {
    if event.kind != KIND_GIFT_WRAP {
        return true;
    }
    if ctx.serve_all_wraps {
        return true;
    }
    match ctx.authed {
        Some(pk) => event
            .tags
            .iter()
            .any(|t| t.first().is_some_and(|k| k == "p") && t.get(1).is_some_and(|v| v == pk)),
        None => false,
    }
}

/// Does any filter of a REQ explicitly ask for gift wraps? (Drives the
/// `auth-required` CLOSED so an anonymous DM client knows to AUTH and retry;
/// filters that merely *could* match a wrap — no `kinds` at all — are served
/// with wraps silently excluded.)
pub fn filters_want_wraps(filters: &[crate::nostr::filter::Filter]) -> bool {
    filters.iter().any(|f| f.kinds.contains(&KIND_GIFT_WRAP))
}

/// Is a published kind-1059 a self-wrap (the sender's own copy)? True when
/// the publishing socket is authenticated as the wrap's recipient. Recorded
/// as `self_published` so the backend push planner can skip it without the
/// client telling the server per message (which was the `/push/suppress`
/// authorship leak).
pub fn is_self_published(event: &Event, authed: Option<&str>) -> bool {
    if event.kind != KIND_GIFT_WRAP {
        return false;
    }
    match authed {
        Some(pk) => event.get_tag_value("p").as_deref() == Some(pk),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wrap(p: &str, extra: Vec<Vec<String>>) -> Event {
        let mut tags = vec![vec!["p".to_string(), p.to_string()]];
        tags.extend(extra);
        Event {
            id: "w".repeat(64),
            pubkey: "e".repeat(64),
            created_at: 100,
            kind: KIND_GIFT_WRAP,
            tags,
            content: "cipher".into(),
            sig: "s".repeat(128),
        }
    }

    #[test]
    fn gate_mode_parses_leniently() {
        assert_eq!(WrapAuthGate::parse("enforce"), WrapAuthGate::Enforce);
        assert_eq!(WrapAuthGate::parse(" WARN "), WrapAuthGate::Warn);
        assert_eq!(WrapAuthGate::parse("off"), WrapAuthGate::Off);
        assert_eq!(WrapAuthGate::parse("garbage"), WrapAuthGate::Enforce);
    }

    #[test]
    fn wrap_only_visible_to_its_recipient() {
        let bob = "b".repeat(64);
        let w = wrap(&bob, vec![]);
        let anon = ReadCtx { authed: None, serve_all_wraps: false, now: 0 };
        let as_bob = ReadCtx { authed: Some(&bob), serve_all_wraps: false, now: 0 };
        let stranger = "c".repeat(64);
        let as_stranger = ReadCtx { authed: Some(&stranger), serve_all_wraps: false, now: 0 };
        let ingest = ReadCtx { authed: Some(&stranger), serve_all_wraps: true, now: 0 };
        assert!(!wrap_visible(&w, &anon));
        assert!(wrap_visible(&w, &as_bob));
        assert!(!wrap_visible(&w, &as_stranger));
        assert!(wrap_visible(&w, &ingest));
    }

    #[test]
    fn non_wraps_are_not_gated_here() {
        let mut e = wrap(&"b".repeat(64), vec![]);
        e.kind = 1;
        assert!(wrap_visible(&e, &ReadCtx { authed: None, serve_all_wraps: false, now: 0 }));
    }

    #[test]
    fn expiration_parses_and_compares() {
        let e = wrap(&"b".repeat(64), vec![vec!["expiration".into(), "500".into()]]);
        assert_eq!(event_expiration(&e), Some(500));
        assert!(!is_expired(&e, 499));
        assert!(is_expired(&e, 500));
        let bad = wrap(&"b".repeat(64), vec![vec!["expiration".into(), "soon".into()]]);
        assert_eq!(event_expiration(&bad), None);
        assert!(!is_expired(&bad, i64::MAX));
    }

    #[test]
    fn self_published_needs_auth_as_recipient() {
        let bob = "b".repeat(64);
        let w = wrap(&bob, vec![]);
        assert!(is_self_published(&w, Some(&bob)));
        assert!(!is_self_published(&w, Some(&"c".repeat(64))));
        assert!(!is_self_published(&w, None));
    }

    #[test]
    fn filters_want_wraps_only_on_explicit_kind() {
        let f: crate::nostr::filter::Filter =
            serde_json::from_str(r##"{"kinds":[1059],"#p":["x"]}"##).unwrap();
        let g: crate::nostr::filter::Filter = serde_json::from_str(r##"{"#p":["x"]}"##).unwrap();
        assert!(filters_want_wraps(&[g.clone(), f]));
        assert!(!filters_want_wraps(&[g]));
    }
}
