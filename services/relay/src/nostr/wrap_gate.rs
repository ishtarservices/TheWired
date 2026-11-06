//! NIP-17 gift-wrap read gate + NIP-40 expiration helpers (docs/DM_WIRE_CONTRACT.md §7).
//!
//! A kind-1059 wrap carries no `h` tag and no `visibility` tag, so the generic
//! visibility rules classify it as *public* — which is exactly wrong: NIP-17
//! says relays SHOULD serve wraps only to the p-tagged recipient behind NIP-42
//! AUTH. This module is the single place that rule lives; the Postgres store,
//! the SQLite store, the NIP-50 search path and the live broadcast filter all
//! consult it so the two query paths cannot drift.
//!
//! It also holds the *intake* side (`RELAY_WRAP_INTAKE_GATE`): a public relay
//! with no write auth otherwise becomes the DM inbox of every client that ever
//! heard of it, and the wraps are opaque — nothing but the `p` tag says whom
//! they are for. The Wired's own clients publish a kind-10050 DM relay list
//! naming this relay on login, so "does a recipient's 10050 list us" is the
//! membership test; a self-wrap published by its authenticated recipient
//! needs no list.
//!
//! Pure functions only (no DB, no async) so they are unit-testable and shared.

use crate::nostr::event::Event;
use crate::protocol::nip42::relay_url_allowed;

/// NIP-59 gift wrap.
pub const KIND_GIFT_WRAP: i32 = 1059;

/// NIP-17 DM relay list (`["relay", url]` tags).
pub const KIND_DM_RELAY_LIST: i32 = 10050;

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

/// How the relay treats an inbound kind-1059 whose recipients have not
/// listed it as a DM relay (`RELAY_WRAP_INTAKE_GATE`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WrapIntakeGate {
    /// Refuse the wrap with `OK false restricted:` and store nothing.
    Enforce,
    /// Store as before but log one line per wrap that `enforce` would have
    /// refused, so the share of foreign traffic can be measured first (default).
    Warn,
    /// No intake check at all (tests / emergencies only).
    Off,
}

impl WrapIntakeGate {
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "enforce" | "on" | "1" | "true" => WrapIntakeGate::Enforce,
            "off" | "0" | "false" => WrapIntakeGate::Off,
            _ => WrapIntakeGate::Warn,
        }
    }
}

/// What `handle_event` does with a kind-1059 after the intake decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WrapIntake {
    /// Store it (not a wrap, gate off, a recipient lists this relay, or a
    /// self-wrap by its authenticated recipient).
    Store,
    /// `warn` mode: store it, but log that `enforce` would have refused it.
    StoreAndLog,
    /// `enforce` mode: answer `OK false` and store nothing.
    Refuse,
}

/// The `OK` reason an `enforce`d intake refusal carries.
pub const WRAP_INTAKE_REFUSED: &str =
    "restricted: this relay only stores DMs for accounts that list it as a DM relay";

/// Distinct `p`-tagged recipients of an event, in tag order.
pub fn wrap_recipients(event: &Event) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in event.get_tag_values("p") {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

/// Is the publishing connection authenticated as one of the wrap's
/// recipients? Broader than [`is_self_published`] (any `p`, not only the
/// first) because the intake question is "may this land here at all", not
/// "is it the sender's own copy".
pub fn authed_is_recipient(event: &Event, authed: Option<&str>) -> bool {
    match authed {
        Some(pk) => event
            .tags
            .iter()
            .any(|t| t.first().is_some_and(|k| k == "p") && t.get(1).is_some_and(|v| v == pk)),
        None => false,
    }
}

/// Does the intake decision for this event need the recipients' kind-10050
/// lists at all? False for non-wraps, with the gate off, and for a wrap
/// published by an authenticated recipient — those never hit the DB.
pub fn intake_needs_dm_relay_lookup(gate: WrapIntakeGate, event: &Event, authed: Option<&str>) -> bool {
    event.kind == KIND_GIFT_WRAP && gate != WrapIntakeGate::Off && !authed_is_recipient(event, authed)
}

/// The intake decision. `listed_dm_relays` are the `relay` tag values of the
/// kind-10050 events stored here for ANY of the wrap's recipients (empty when
/// no lookup was needed or nothing was found); `own_relay_urls` every address
/// this relay answers to. Both sides go through `nip42::normalize_relay_url`,
/// exactly as a kind-22242 `relay` tag is matched, so scheme, case, a
/// trailing slash or a default port never make a Wired user's list miss.
pub fn wrap_intake(
    gate: WrapIntakeGate,
    event: &Event,
    authed: Option<&str>,
    listed_dm_relays: &[String],
    own_relay_urls: &[String],
) -> WrapIntake {
    if !intake_needs_dm_relay_lookup(gate, event, authed) {
        return WrapIntake::Store;
    }
    if listed_dm_relays.iter().any(|u| relay_url_allowed(u, own_relay_urls)) {
        return WrapIntake::Store;
    }
    match gate {
        WrapIntakeGate::Enforce => WrapIntake::Refuse,
        WrapIntakeGate::Warn => WrapIntake::StoreAndLog,
        WrapIntakeGate::Off => WrapIntake::Store,
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
    /// True when the connection may read EVERY kind-1984 report: the ingest
    /// role (the backend files them into the moderation queue), or the report
    /// gate turned off. Independent of the wrap gate mode — production runs
    /// wraps in `warn`, and reports must not leak with them (`report_gate`).
    pub serve_all_reports: bool,
    /// Unix seconds "now" for NIP-40 checks.
    pub now: i64,
}

impl<'a> ReadCtx<'a> {
    /// The plain, pre-contract context (used by callers that predate the
    /// gate and by tests): no ingest role, gates enforced, wall-clock now.
    pub fn plain(authed: Option<&'a str>) -> Self {
        ReadCtx { authed, serve_all_wraps: false, serve_all_reports: false, now: unix_now() }
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

/// True when the backend's DM push ingest cannot work: the wrap gate is on
/// (`enforce` or `warn` both key reads of EVERY wrap to the ingest role) and
/// no ingest-role pubkey is configured. The server logs a warning for it at
/// startup — a dev stack without `RELAY_INGEST_PUBKEYS` otherwise produces
/// no `dm` push rows and nothing says why.
pub fn ingest_role_missing(gate: WrapAuthGate, ingest_pubkeys: &[String]) -> bool {
    gate != WrapAuthGate::Off && ingest_pubkeys.is_empty()
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
        let anon = ReadCtx { authed: None, serve_all_wraps: false, serve_all_reports: false, now: 0 };
        let as_bob = ReadCtx { authed: Some(&bob), serve_all_wraps: false, serve_all_reports: false, now: 0 };
        let stranger = "c".repeat(64);
        let as_stranger = ReadCtx { authed: Some(&stranger), serve_all_wraps: false, serve_all_reports: false, now: 0 };
        let ingest = ReadCtx { authed: Some(&stranger), serve_all_wraps: true, serve_all_reports: true, now: 0 };
        assert!(!wrap_visible(&w, &anon));
        assert!(wrap_visible(&w, &as_bob));
        assert!(!wrap_visible(&w, &as_stranger));
        assert!(wrap_visible(&w, &ingest));
    }

    #[test]
    fn non_wraps_are_not_gated_here() {
        let mut e = wrap(&"b".repeat(64), vec![]);
        e.kind = 1;
        assert!(wrap_visible(&e, &ReadCtx { authed: None, serve_all_wraps: false, serve_all_reports: false, now: 0 }));
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
    fn intake_gate_parses_leniently_and_defaults_to_warn() {
        assert_eq!(WrapIntakeGate::parse("enforce"), WrapIntakeGate::Enforce);
        assert_eq!(WrapIntakeGate::parse(" WARN "), WrapIntakeGate::Warn);
        assert_eq!(WrapIntakeGate::parse("off"), WrapIntakeGate::Off);
        assert_eq!(WrapIntakeGate::parse(""), WrapIntakeGate::Warn);
        assert_eq!(WrapIntakeGate::parse("garbage"), WrapIntakeGate::Warn);
    }

    fn own() -> Vec<String> {
        vec!["wss://relay.thewired.app".to_string()]
    }

    #[test]
    fn intake_stores_when_a_recipient_lists_this_relay_in_any_spelling() {
        let bob = "b".repeat(64);
        let w = wrap(&bob, vec![]);
        for spelling in ["wss://relay.thewired.app", "WSS://Relay.TheWired.app/", "ws://relay.thewired.app:443"] {
            let listed = vec!["wss://nos.lol".to_string(), spelling.to_string()];
            assert_eq!(wrap_intake(WrapIntakeGate::Enforce, &w, None, &listed, &own()), WrapIntake::Store, "{spelling}");
        }
    }

    #[test]
    fn intake_refuses_or_logs_when_no_recipient_lists_this_relay() {
        let bob = "b".repeat(64);
        let w = wrap(&bob, vec![]);
        let foreign = vec!["wss://nos.lol".to_string(), "wss://relay.damus.io".to_string()];
        assert_eq!(wrap_intake(WrapIntakeGate::Enforce, &w, None, &foreign, &own()), WrapIntake::Refuse);
        assert_eq!(wrap_intake(WrapIntakeGate::Enforce, &w, None, &[], &own()), WrapIntake::Refuse);
        assert_eq!(wrap_intake(WrapIntakeGate::Warn, &w, None, &foreign, &own()), WrapIntake::StoreAndLog);
        assert_eq!(wrap_intake(WrapIntakeGate::Off, &w, None, &foreign, &own()), WrapIntake::Store);
        // A stranger's AUTH is not the recipient's.
        let carol = "c".repeat(64);
        assert_eq!(wrap_intake(WrapIntakeGate::Enforce, &w, Some(&carol), &[], &own()), WrapIntake::Refuse);
        // A wrap with no recipient at all can never qualify.
        let mut orphan = w.clone();
        orphan.tags.clear();
        assert_eq!(wrap_intake(WrapIntakeGate::Enforce, &orphan, None, &[], &own()), WrapIntake::Refuse);
    }

    #[test]
    fn intake_lets_an_authenticated_recipient_publish_without_a_list() {
        let bob = "b".repeat(64);
        let carol = "c".repeat(64);
        let w = wrap(&bob, vec![vec!["p".into(), carol.clone()]]);
        assert!(!intake_needs_dm_relay_lookup(WrapIntakeGate::Enforce, &w, Some(&bob)));
        assert!(!intake_needs_dm_relay_lookup(WrapIntakeGate::Enforce, &w, Some(&carol)), "any p tag, not only the first");
        assert!(intake_needs_dm_relay_lookup(WrapIntakeGate::Enforce, &w, None));
        assert!(intake_needs_dm_relay_lookup(WrapIntakeGate::Warn, &w, None));
        assert!(!intake_needs_dm_relay_lookup(WrapIntakeGate::Off, &w, None));
        assert_eq!(wrap_intake(WrapIntakeGate::Enforce, &w, Some(&carol), &[], &own()), WrapIntake::Store);
    }

    #[test]
    fn intake_never_touches_non_wraps() {
        let mut e = wrap(&"b".repeat(64), vec![]);
        e.kind = 1;
        assert!(!intake_needs_dm_relay_lookup(WrapIntakeGate::Enforce, &e, None));
        assert_eq!(wrap_intake(WrapIntakeGate::Enforce, &e, None, &[], &own()), WrapIntake::Store);
    }

    #[test]
    fn wrap_recipients_are_distinct_in_tag_order() {
        let bob = "b".repeat(64);
        let carol = "c".repeat(64);
        let w = wrap(&bob, vec![vec!["p".into(), carol.clone()], vec!["p".into(), bob.clone()], vec!["e".into(), "x".into()]]);
        assert_eq!(wrap_recipients(&w), vec![bob, carol]);
    }

    #[test]
    fn filters_want_wraps_only_on_explicit_kind() {
        let f: crate::nostr::filter::Filter =
            serde_json::from_str(r##"{"kinds":[1059],"#p":["x"]}"##).unwrap();
        let g: crate::nostr::filter::Filter = serde_json::from_str(r##"{"#p":["x"]}"##).unwrap();
        assert!(filters_want_wraps(&[g.clone(), f]));
        assert!(!filters_want_wraps(&[g]));
    }

    #[test]
    fn ingest_role_missing_flags_a_gated_relay_without_ingest_pubkeys() {
        let none: Vec<String> = vec![];
        let one = vec!["a".repeat(64)];
        assert!(ingest_role_missing(WrapAuthGate::Enforce, &none));
        assert!(ingest_role_missing(WrapAuthGate::Warn, &none));
        assert!(!ingest_role_missing(WrapAuthGate::Off, &none));
        assert!(!ingest_role_missing(WrapAuthGate::Enforce, &one));
    }
}
