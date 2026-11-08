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

/// NIP-65 relay list (`["r", url]` tags). Our clients publish it to the
/// platform relay on login alongside the kind 10050, so its presence here is
/// a second "this account uses The Wired" signal.
pub const KIND_RELAY_LIST: i32 = 10002;

/// Distinct `p` tags a kind-1059 may carry before the intake gate refuses it
/// outright. NIP-17 wraps have exactly one; the cap bounds the single list
/// lookup (`= ANY($1)`) the same way `MAX_H_TAGS` bounds membership checks.
pub const MAX_WRAP_RECIPIENTS: usize = 16;

/// How the relay treats an inbound kind-1059 whose recipients have no relay
/// list stored here (`RELAY_WRAP_INTAKE_GATE`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WrapIntakeGate {
    /// Refuse the wrap with `OK false blocked:` and store nothing.
    Enforce,
    /// Store as before but log and count every wrap `enforce` would have
    /// refused, so the share of foreign traffic can be measured first (default).
    Warn,
    /// No intake check at all (tests / emergencies only).
    Off,
}

impl WrapIntakeGate {
    /// Lenient like [`WrapAuthGate::parse`]; anything unrecognised (including
    /// an empty value) is `warn`, the safe default.
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "enforce" | "on" | "1" | "true" => WrapIntakeGate::Enforce,
            "off" | "0" | "false" => WrapIntakeGate::Off,
            _ => WrapIntakeGate::Warn,
        }
    }
}

/// One relay-list event (kind 10002 or 10050) stored here for a recipient,
/// as the single intake lookup returns it. `relay_urls` are the `relay` tag
/// values of a kind 10050 (string values only); empty for a kind 10002,
/// whose URLs the gate never needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredRelayList {
    pub pubkey: String,
    pub kind: i32,
    pub relay_urls: Vec<String>,
}

/// Why a kind-1059 was let in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntakeAccept {
    /// Not a kind 1059 at all.
    NotAWrap,
    /// `RELAY_WRAP_INTAKE_GATE=off`.
    GateOff,
    /// The publishing socket is NIP-42 authenticated as a recipient.
    SelfWrap,
    /// A recipient's kind 10050 stored here names this relay.
    RecipientListsThisRelay,
    /// A recipient has no kind 10050 here but does have a kind 10002 here —
    /// a Wired login whose 10050 naming us only reached other relays.
    RecipientHasRelayListHere,
}

/// Why a kind-1059 was (or, in `warn`, would be) refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntakeRefuse {
    /// More than [`MAX_WRAP_RECIPIENTS`] distinct `p` tags.
    TooManyRecipients,
    /// No `p` tag at all: nobody can ever read it here.
    NoRecipient,
    /// No recipient has any relay list (10002 or 10050) stored here.
    NoListHere,
    /// Every recipient with a 10050 here lists other relays only, and none
    /// has a 10002 to fall back on — the account opted out of DMs here.
    ListExcludesThisRelay,
}

impl IntakeRefuse {
    /// The `OK false` reason. `blocked:` is the NIP-01 machine-readable
    /// prefix for "this relay will not take this event from you"; the text
    /// after it may change. `invalid:` for a structurally abusive wrap.
    pub fn message(self) -> &'static str {
        match self {
            IntakeRefuse::TooManyRecipients => "invalid: too many p tags",
            IntakeRefuse::NoRecipient => "blocked: gift wrap has no recipient",
            IntakeRefuse::NoListHere => "blocked: recipient has no DM relay list on this relay",
            IntakeRefuse::ListExcludesThisRelay => "blocked: recipient's DM relay list does not include this relay",
        }
    }

    /// Short stable label for logs and counters.
    pub fn label(self) -> &'static str {
        match self {
            IntakeRefuse::TooManyRecipients => "too_many_recipients",
            IntakeRefuse::NoRecipient => "no_recipient",
            IntakeRefuse::NoListHere => "no_list_here",
            IntakeRefuse::ListExcludesThisRelay => "list_excludes_relay",
        }
    }
}

/// The machine-readable prefix every list-based intake refusal starts with.
pub const WRAP_INTAKE_BLOCKED_PREFIX: &str = "blocked:";

/// The mode-independent verdict on a wrap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntakeVerdict {
    Accept(IntakeAccept),
    Refuse(IntakeRefuse),
}

/// What `handle_event` does with a kind-1059 once the verdict is mapped
/// through the gate mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WrapIntake {
    /// Store it.
    Store,
    /// `warn`: store it, but log and count that `enforce` would refuse it.
    StoreAndLog(IntakeRefuse),
    /// `enforce`: answer `OK false` with [`IntakeRefuse::message`], store nothing.
    Refuse(IntakeRefuse),
}

/// Distinct `p`-tagged recipients of an event, in tag order. Only the tag
/// named exactly `p` counts: a pubkey smuggled into an `e`, `P` or custom tag
/// never makes anyone a recipient.
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

/// Does the intake decision for this event need the recipients' stored relay
/// lists at all? False for non-wraps, with the gate off, and for a wrap
/// published by an authenticated recipient — those never hit the DB. (A wrap
/// with too many or no recipients also needs no lookup; [`wrap_intake`]
/// settles it from the event alone when handed an empty list.)
pub fn intake_needs_dm_relay_lookup(gate: WrapIntakeGate, event: &Event, authed: Option<&str>) -> bool {
    event.kind == KIND_GIFT_WRAP && gate != WrapIntakeGate::Off && !authed_is_recipient(event, authed)
}

/// Does one recipient qualify, given the lists stored here for them?
/// A stored kind 10050 is authoritative: it must name this relay (compared
/// through `nip42::normalize_relay_url`, exactly as a kind-22242 `relay` tag
/// is, so scheme, case, a trailing slash or a default port never make a Wired
/// user's list miss; a lookalike host, userinfo or a path never matches).
/// Without a 10050 here, a stored kind 10002 is enough. `Err` carries why
/// not, `Ok(None)` means "no list of any kind here".
fn recipient_verdict(
    pubkey: &str,
    lists: &[StoredRelayList],
    own_relay_urls: &[String],
) -> Result<Option<IntakeAccept>, IntakeRefuse> {
    let dm_list = lists.iter().find(|l| l.pubkey == pubkey && l.kind == KIND_DM_RELAY_LIST);
    let has_relay_list = lists.iter().any(|l| l.pubkey == pubkey && l.kind == KIND_RELAY_LIST);
    match dm_list {
        Some(l) => {
            if l.relay_urls.iter().any(|u| relay_url_allowed(u, own_relay_urls)) {
                Ok(Some(IntakeAccept::RecipientListsThisRelay))
            } else {
                Err(IntakeRefuse::ListExcludesThisRelay)
            }
        }
        None if has_relay_list => Ok(Some(IntakeAccept::RecipientHasRelayListHere)),
        None => Ok(None),
    }
}

/// The mode-independent verdict. `lists` are the kind-10002/10050 rows
/// stored here for ANY of the wrap's recipients (empty when no lookup was
/// needed or nothing was found); `own_relay_urls` every address this relay
/// answers to. The wrap is accepted when ANY recipient qualifies. Linear in
/// the number of tags: no per-tag DB work, no nested scans beyond the
/// recipient cap.
pub fn intake_verdict(
    gate: WrapIntakeGate,
    event: &Event,
    authed: Option<&str>,
    lists: &[StoredRelayList],
    own_relay_urls: &[String],
) -> IntakeVerdict {
    if event.kind != KIND_GIFT_WRAP {
        return IntakeVerdict::Accept(IntakeAccept::NotAWrap);
    }
    if gate == WrapIntakeGate::Off {
        return IntakeVerdict::Accept(IntakeAccept::GateOff);
    }
    if authed_is_recipient(event, authed) {
        return IntakeVerdict::Accept(IntakeAccept::SelfWrap);
    }
    let recipients = wrap_recipients(event);
    if recipients.len() > MAX_WRAP_RECIPIENTS {
        return IntakeVerdict::Refuse(IntakeRefuse::TooManyRecipients);
    }
    if recipients.is_empty() {
        return IntakeVerdict::Refuse(IntakeRefuse::NoRecipient);
    }
    let mut refusal = IntakeRefuse::NoListHere;
    for p in &recipients {
        match recipient_verdict(p, lists, own_relay_urls) {
            Ok(Some(why)) => return IntakeVerdict::Accept(why),
            Ok(None) => {}
            Err(why) => refusal = why,
        }
    }
    IntakeVerdict::Refuse(refusal)
}

/// The verdict mapped through the gate mode: what the handler does.
pub fn wrap_intake(
    gate: WrapIntakeGate,
    event: &Event,
    authed: Option<&str>,
    lists: &[StoredRelayList],
    own_relay_urls: &[String],
) -> WrapIntake {
    match intake_verdict(gate, event, authed, lists, own_relay_urls) {
        IntakeVerdict::Accept(_) => WrapIntake::Store,
        IntakeVerdict::Refuse(why) => match gate {
            WrapIntakeGate::Enforce => WrapIntake::Refuse(why),
            WrapIntakeGate::Warn => WrapIntake::StoreAndLog(why),
            WrapIntakeGate::Off => WrapIntake::Store,
        },
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
    /// True when the connection may read EVERY `h`-only (space-scoped) event
    /// without being a member: the ingest role only, never a gate mode. The
    /// backend indexes live space activity and plans space-mention pushes from
    /// kind-9 chat it could otherwise never see (it is neither author, grantee
    /// nor member). Rule 6 of `nostr::access` only — a `visibility`-tagged
    /// event still needs the author or an access-granting p tag.
    pub serve_all_spaces: bool,
    /// Unix seconds "now" for NIP-40 checks.
    pub now: i64,
    /// What a firehose filter returns (`nostr::firehose`): everything, or
    /// community authors plus the reader's own notes.
    pub firehose_policy: crate::nostr::firehose::FirehosePolicy,
}

impl<'a> ReadCtx<'a> {
    /// The plain, pre-contract context (used by callers that predate the
    /// gate and by tests): no ingest role, gates enforced, wall-clock now,
    /// firehose policy `all`.
    pub fn plain(authed: Option<&'a str>) -> Self {
        ReadCtx { authed, serve_all_wraps: false, serve_all_reports: false, serve_all_spaces: false, now: unix_now(), firehose_policy: Default::default() }
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
        let anon = ReadCtx { authed: None, serve_all_wraps: false, serve_all_reports: false, serve_all_spaces: false, now: 0, firehose_policy: Default::default() };
        let as_bob = ReadCtx { authed: Some(&bob), serve_all_wraps: false, serve_all_reports: false, serve_all_spaces: false, now: 0, firehose_policy: Default::default() };
        let stranger = "c".repeat(64);
        let as_stranger = ReadCtx { authed: Some(&stranger), serve_all_wraps: false, serve_all_reports: false, serve_all_spaces: false, now: 0, firehose_policy: Default::default() };
        let ingest = ReadCtx { authed: Some(&stranger), serve_all_wraps: true, serve_all_reports: true, serve_all_spaces: true, now: 0, firehose_policy: Default::default() };
        assert!(!wrap_visible(&w, &anon));
        assert!(wrap_visible(&w, &as_bob));
        assert!(!wrap_visible(&w, &as_stranger));
        assert!(wrap_visible(&w, &ingest));
    }

    #[test]
    fn non_wraps_are_not_gated_here() {
        let mut e = wrap(&"b".repeat(64), vec![]);
        e.kind = 1;
        assert!(wrap_visible(&e, &ReadCtx { authed: None, serve_all_wraps: false, serve_all_reports: false, serve_all_spaces: false, now: 0, firehose_policy: Default::default() }));
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

    // ── intake gate ─────────────────────────────────────────────────────

    #[test]
    fn intake_gate_parses_leniently_and_defaults_to_warn() {
        assert_eq!(WrapIntakeGate::parse("enforce"), WrapIntakeGate::Enforce);
        assert_eq!(WrapIntakeGate::parse("ON"), WrapIntakeGate::Enforce);
        assert_eq!(WrapIntakeGate::parse(" WARN "), WrapIntakeGate::Warn);
        assert_eq!(WrapIntakeGate::parse("off"), WrapIntakeGate::Off);
        assert_eq!(WrapIntakeGate::parse("0"), WrapIntakeGate::Off);
        for bad in ["", "garbage", "enforced", "yes please", "null"] {
            assert_eq!(WrapIntakeGate::parse(bad), WrapIntakeGate::Warn, "{bad:?}");
        }
    }

    const OWN: &str = "wss://relay.thewired.app";

    fn own() -> Vec<String> {
        vec![OWN.to_string()]
    }

    fn dm_list(pubkey: &str, urls: &[&str]) -> StoredRelayList {
        StoredRelayList { pubkey: pubkey.to_string(), kind: KIND_DM_RELAY_LIST, relay_urls: urls.iter().map(|u| u.to_string()).collect() }
    }

    fn relay_list(pubkey: &str) -> StoredRelayList {
        StoredRelayList { pubkey: pubkey.to_string(), kind: KIND_RELAY_LIST, relay_urls: vec![] }
    }

    fn verdict(gate: WrapIntakeGate, w: &Event, authed: Option<&str>, lists: &[StoredRelayList]) -> IntakeVerdict {
        intake_verdict(gate, w, authed, lists, &own())
    }

    #[test]
    fn url_matcher_accepts_every_spelling_of_this_relay() {
        let bob = "b".repeat(64);
        let w = wrap(&bob, vec![]);
        for spelling in [
            "wss://relay.thewired.app",
            "ws://relay.thewired.app",
            "wss://relay.thewired.app/",
            "WSS://Relay.TheWired.APP",
            "wss://relay.thewired.app:443",
            "wss://relay.thewired.app:443/",
            "  wss://relay.thewired.app  ",
        ] {
            let lists = [dm_list(&bob, &["wss://nos.lol", spelling])];
            assert_eq!(
                verdict(WrapIntakeGate::Enforce, &w, None, &lists),
                IntakeVerdict::Accept(IntakeAccept::RecipientListsThisRelay),
                "{spelling:?}"
            );
        }
    }

    #[test]
    fn url_matcher_rejects_lookalikes_userinfo_paths_and_other_ports() {
        let bob = "b".repeat(64);
        let w = wrap(&bob, vec![]);
        for lookalike in [
            "wss://relay.thewired.app.evil.com",
            "wss://evil.com/relay.thewired.app",
            "wss://relay.thewired.app@evil.com",
            "wss://relay.thewired.app:443@evil.com",
            "wss://user:pw@relay.thewired.app.evil.com",
            "wss://thewired.app",
            "wss://relay.thewired.app/inbox",
            "wss://relay.thewired.app:7777",
            "wss://relay.thewired.app?x=1",
            "wss://xn--relay.thewired.app",
            "relay.thewired.app.",
            "",
        ] {
            let lists = [dm_list(&bob, &["wss://nos.lol", lookalike])];
            assert_eq!(
                verdict(WrapIntakeGate::Enforce, &w, None, &lists),
                IntakeVerdict::Refuse(IntakeRefuse::ListExcludesThisRelay),
                "{lookalike:?} must not match"
            );
        }
        // The scheme-less, port-less own URL is compared the same way.
        let own_bare = vec!["relay.thewired.app".to_string()];
        let lists = [dm_list(&bob, &["wss://relay.thewired.app/"])];
        assert_eq!(
            intake_verdict(WrapIntakeGate::Enforce, &w, None, &lists, &own_bare),
            IntakeVerdict::Accept(IntakeAccept::RecipientListsThisRelay)
        );
    }

    #[test]
    fn a_stored_10050_is_authoritative_and_a_10002_is_the_fallback() {
        let bob = "b".repeat(64);
        let w = wrap(&bob, vec![]);
        // No list of any kind here → refused.
        assert_eq!(verdict(WrapIntakeGate::Enforce, &w, None, &[]), IntakeVerdict::Refuse(IntakeRefuse::NoListHere));
        // Only a 10002 here → the account logged in through our apps.
        assert_eq!(
            verdict(WrapIntakeGate::Enforce, &w, None, &[relay_list(&bob)]),
            IntakeVerdict::Accept(IntakeAccept::RecipientHasRelayListHere)
        );
        // A 10050 naming other relays only → refused, even with a 10002 here:
        // the user deliberately saved a list without us.
        let excludes = [dm_list(&bob, &["wss://nos.lol", "wss://relay.damus.io"]), relay_list(&bob)];
        assert_eq!(
            verdict(WrapIntakeGate::Enforce, &w, None, &excludes),
            IntakeVerdict::Refuse(IntakeRefuse::ListExcludesThisRelay)
        );
        // Someone else's lists never count for bob.
        let carol = "c".repeat(64);
        let others = [dm_list(&carol, &[OWN]), relay_list(&carol)];
        assert_eq!(verdict(WrapIntakeGate::Enforce, &w, None, &others), IntakeVerdict::Refuse(IntakeRefuse::NoListHere));
    }

    #[test]
    fn malformed_10050s_never_match_but_never_panic() {
        let bob = "b".repeat(64);
        let w = wrap(&bob, vec![]);
        // Empty list, list with no usable URL, whitespace, garbage.
        for urls in [vec![], vec![""], vec!["   "], vec!["not a url"], vec!["wss://"], vec!["://"]] {
            let lists = [dm_list(&bob, &urls)];
            assert_eq!(
                verdict(WrapIntakeGate::Enforce, &w, None, &lists),
                IntakeVerdict::Refuse(IntakeRefuse::ListExcludesThisRelay),
                "{urls:?}"
            );
        }
    }

    #[test]
    fn oversized_10050_is_linear_and_still_matches() {
        let bob = "b".repeat(64);
        let w = wrap(&bob, vec![]);
        let mut urls: Vec<String> = (0..20_000).map(|i| format!("wss://relay{i}.example.com")).collect();
        urls.push("wss://relay.thewired.app/".into());
        let lists = [StoredRelayList { pubkey: bob.clone(), kind: KIND_DM_RELAY_LIST, relay_urls: urls }];
        let started = std::time::Instant::now();
        assert_eq!(
            verdict(WrapIntakeGate::Enforce, &w, None, &lists),
            IntakeVerdict::Accept(IntakeAccept::RecipientListsThisRelay)
        );
        assert!(started.elapsed() < std::time::Duration::from_millis(500), "{:?}", started.elapsed());
    }

    #[test]
    fn multiple_recipients_accept_if_any_qualifies_and_refuse_if_none() {
        let bob = "b".repeat(64);
        let carol = "c".repeat(64);
        let dave = "d".repeat(64);
        let w = wrap(&bob, vec![vec!["p".into(), carol.clone()], vec!["p".into(), dave.clone()]]);
        // Only dave (last) qualifies.
        let lists = [dm_list(&bob, &["wss://nos.lol"]), dm_list(&dave, &[OWN])];
        assert_eq!(verdict(WrapIntakeGate::Enforce, &w, None, &lists), IntakeVerdict::Accept(IntakeAccept::RecipientListsThisRelay));
        // Nobody qualifies: the most specific refusal wins over "no list".
        let lists = [dm_list(&bob, &["wss://nos.lol"])];
        assert_eq!(verdict(WrapIntakeGate::Enforce, &w, None, &lists), IntakeVerdict::Refuse(IntakeRefuse::ListExcludesThisRelay));
        assert_eq!(verdict(WrapIntakeGate::Enforce, &w, None, &[]), IntakeVerdict::Refuse(IntakeRefuse::NoListHere));
    }

    #[test]
    fn recipient_cap_and_missing_recipient_are_refused_before_any_lookup() {
        let bob = "b".repeat(64);
        let extra: Vec<Vec<String>> = (1..MAX_WRAP_RECIPIENTS + 1)
            .map(|i| vec!["p".to_string(), format!("{i:064x}")])
            .collect();
        let too_many = wrap(&bob, extra.clone()); // bob + 16 more = 17
        assert_eq!(wrap_recipients(&too_many).len(), MAX_WRAP_RECIPIENTS + 1);
        // Even a list that would qualify cannot rescue an over-cap wrap.
        let lists = [dm_list(&bob, &[OWN])];
        assert_eq!(verdict(WrapIntakeGate::Enforce, &too_many, None, &lists), IntakeVerdict::Refuse(IntakeRefuse::TooManyRecipients));
        // Exactly at the cap is fine; duplicates do not count twice.
        let mut at_cap = wrap(&bob, extra[..MAX_WRAP_RECIPIENTS - 1].to_vec());
        at_cap.tags.push(vec!["p".into(), bob.clone()]);
        assert_eq!(wrap_recipients(&at_cap).len(), MAX_WRAP_RECIPIENTS);
        assert_eq!(verdict(WrapIntakeGate::Enforce, &at_cap, None, &lists), IntakeVerdict::Accept(IntakeAccept::RecipientListsThisRelay));
        // No p tag at all.
        let mut orphan = wrap(&bob, vec![]);
        orphan.tags.clear();
        assert_eq!(verdict(WrapIntakeGate::Enforce, &orphan, None, &[]), IntakeVerdict::Refuse(IntakeRefuse::NoRecipient));
        // The self-wrap exemption is checked before the cap: the authed
        // recipient's own copy always lands, however many p tags it carries.
        assert_eq!(verdict(WrapIntakeGate::Enforce, &too_many, Some(&bob), &[]), IntakeVerdict::Accept(IntakeAccept::SelfWrap));
    }

    #[test]
    fn recipient_pubkey_in_a_non_p_tag_is_not_a_recipient() {
        let bob = "b".repeat(64);
        let stranger = "f".repeat(64);
        let mut w = wrap(&stranger, vec![]);
        w.tags.push(vec!["e".into(), bob.clone()]);
        w.tags.push(vec!["P".into(), bob.clone()]);
        w.tags.push(vec!["recipient".into(), bob.clone()]);
        w.tags.push(vec!["p".into()]); // valueless p tag
        assert_eq!(wrap_recipients(&w), vec![stranger.clone()]);
        let lists = [dm_list(&bob, &[OWN]), relay_list(&bob)];
        assert_eq!(verdict(WrapIntakeGate::Enforce, &w, None, &lists), IntakeVerdict::Refuse(IntakeRefuse::NoListHere));
        // Nor does AUTH as bob help a wrap whose only p is the stranger.
        assert_eq!(verdict(WrapIntakeGate::Enforce, &w, Some(&bob), &lists), IntakeVerdict::Refuse(IntakeRefuse::NoListHere));
    }

    #[test]
    fn self_wrap_passes_without_any_list_in_every_mode() {
        let bob = "b".repeat(64);
        let carol = "c".repeat(64);
        let w = wrap(&bob, vec![vec!["p".into(), carol.clone()]]);
        for gate in [WrapIntakeGate::Enforce, WrapIntakeGate::Warn, WrapIntakeGate::Off] {
            assert_eq!(wrap_intake(gate, &w, Some(&bob), &[], &own()), WrapIntake::Store, "{gate:?}");
            assert_eq!(wrap_intake(gate, &w, Some(&carol), &[], &own()), WrapIntake::Store, "{gate:?} any p tag, not only the first");
        }
        assert!(!intake_needs_dm_relay_lookup(WrapIntakeGate::Enforce, &w, Some(&bob)));
        assert!(intake_needs_dm_relay_lookup(WrapIntakeGate::Enforce, &w, None));
        assert!(intake_needs_dm_relay_lookup(WrapIntakeGate::Warn, &w, None));
        assert!(!intake_needs_dm_relay_lookup(WrapIntakeGate::Off, &w, None));
        // A stranger's AUTH is not the recipient's.
        let dave = "d".repeat(64);
        assert_eq!(wrap_intake(WrapIntakeGate::Enforce, &w, Some(&dave), &[], &own()), WrapIntake::Refuse(IntakeRefuse::NoListHere));
    }

    #[test]
    fn modes_map_the_same_verdict_to_store_log_or_refuse() {
        let bob = "b".repeat(64);
        let w = wrap(&bob, vec![]);
        let foreign = [dm_list(&bob, &["wss://nos.lol"])];
        assert_eq!(wrap_intake(WrapIntakeGate::Off, &w, None, &[], &own()), WrapIntake::Store);
        assert_eq!(wrap_intake(WrapIntakeGate::Warn, &w, None, &[], &own()), WrapIntake::StoreAndLog(IntakeRefuse::NoListHere));
        assert_eq!(wrap_intake(WrapIntakeGate::Warn, &w, None, &foreign, &own()), WrapIntake::StoreAndLog(IntakeRefuse::ListExcludesThisRelay));
        assert_eq!(wrap_intake(WrapIntakeGate::Enforce, &w, None, &[], &own()), WrapIntake::Refuse(IntakeRefuse::NoListHere));
        assert_eq!(wrap_intake(WrapIntakeGate::Enforce, &w, None, &foreign, &own()), WrapIntake::Refuse(IntakeRefuse::ListExcludesThisRelay));
        let ok = [dm_list(&bob, &[OWN])];
        for gate in [WrapIntakeGate::Enforce, WrapIntakeGate::Warn, WrapIntakeGate::Off] {
            assert_eq!(wrap_intake(gate, &w, None, &ok, &own()), WrapIntake::Store, "{gate:?}");
        }
    }

    #[test]
    fn refusal_messages_carry_machine_readable_prefixes() {
        for why in [IntakeRefuse::NoRecipient, IntakeRefuse::NoListHere, IntakeRefuse::ListExcludesThisRelay] {
            assert!(why.message().starts_with(WRAP_INTAKE_BLOCKED_PREFIX), "{why:?}: {}", why.message());
        }
        assert!(IntakeRefuse::TooManyRecipients.message().starts_with("invalid:"));
    }

    #[test]
    fn intake_never_touches_non_wraps() {
        let mut e = wrap(&"b".repeat(64), vec![]);
        e.kind = 1;
        assert!(!intake_needs_dm_relay_lookup(WrapIntakeGate::Enforce, &e, None));
        assert_eq!(verdict(WrapIntakeGate::Enforce, &e, None, &[]), IntakeVerdict::Accept(IntakeAccept::NotAWrap));
        e.kind = 14; // an unwrapped rumor kind is not a wrap either
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
