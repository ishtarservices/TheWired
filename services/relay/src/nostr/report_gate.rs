//! NIP-56 report read gate (App Store 1.2 reporting).
//!
//! A kind-1984 report is signed by the reporter, so serving it to everyone
//! would tell the reported account who reported them. The relay serves a
//! report only to the ingest role (the backend files it into the moderation
//! queue) and to its own author over a NIP-42-authenticated socket. Same shape
//! as the gift-wrap gate in `wrap_gate`, keyed on the author instead of the
//! `p` tag; the Postgres store, the SQLite store, NIP-50 search and the live
//! broadcast filter all apply it.
//!
//! On the write side reports are exempt from the NIP-29 membership gate
//! (`membership_gate::requires_h_membership_check`): anyone may report
//! anything, including content in a space they are not a member of.
//!
//! Pure functions only (no DB, no async) so they are unit-testable and shared.

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;
use crate::nostr::wrap_gate::ReadCtx;

/// NIP-56 report.
pub const KIND_REPORT: i32 = 1984;

/// May this connection receive this kind-1984 report? Non-reports are never
/// gated here.
pub fn report_visible(event: &Event, ctx: &ReadCtx<'_>) -> bool {
    if event.kind != KIND_REPORT || ctx.serve_all_reports {
        return true;
    }
    ctx.authed.is_some_and(|pk| pk == event.pubkey)
}

/// Does any filter of a REQ explicitly ask for reports? An anonymous REQ that
/// does gets an `auth-required` CLOSED (the reporter can AUTH and read their
/// own); filters that merely *could* match one are served with reports
/// silently excluded.
pub fn filters_want_reports(filters: &[Filter]) -> bool {
    filters.iter().any(|f| f.kinds.contains(&KIND_REPORT))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(author: &str) -> Event {
        Event {
            id: "r".repeat(64),
            pubkey: author.to_string(),
            created_at: 100,
            kind: KIND_REPORT,
            tags: vec![vec!["p".into(), "t".repeat(64), "spam".into()]],
            content: "note".into(),
            sig: "s".repeat(128),
        }
    }

    fn ctx(authed: Option<&str>, all: bool) -> ReadCtx<'_> {
        ReadCtx { authed, serve_all_wraps: false, serve_all_reports: all, now: 0 }
    }

    #[test]
    fn report_only_visible_to_its_author_or_ingest() {
        let alice = "a".repeat(64);
        let target = "t".repeat(64);
        let r = report(&alice);
        assert!(!report_visible(&r, &ctx(None, false)));
        assert!(report_visible(&r, &ctx(Some(&alice), false)));
        // The reported account is p-tagged but must never see who reported it.
        assert!(!report_visible(&r, &ctx(Some(&target), false)));
        assert!(report_visible(&r, &ctx(Some("backend"), true)));
    }

    #[test]
    fn the_wrap_gate_mode_does_not_open_reports() {
        // Production runs the wrap gate in `warn` (serve_all_wraps = true for
        // everyone); reports must stay closed regardless.
        let r = report(&"a".repeat(64));
        let warn_mode = ReadCtx { authed: None, serve_all_wraps: true, serve_all_reports: false, now: 0 };
        assert!(!report_visible(&r, &warn_mode));
    }

    #[test]
    fn non_reports_are_not_gated_here() {
        let mut e = report(&"a".repeat(64));
        e.kind = 1;
        assert!(report_visible(&e, &ctx(None, false)));
    }

    #[test]
    fn filters_want_reports_only_on_explicit_kind() {
        let f: Filter = serde_json::from_str(r#"{"kinds":[1,1984]}"#).unwrap();
        let g: Filter = serde_json::from_str(r#"{"authors":["x"]}"#).unwrap();
        assert!(filters_want_reports(&[g.clone(), f]));
        assert!(!filters_want_reports(&[g]));
    }
}
