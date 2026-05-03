//! Publish-side membership gate for h-tagged (space-scoped) events.
//!
//! Background: the relay's per-connection broadcast filter (`is_event_visible_to`
//! in `connection.rs`) hides h-tagged events from non-members on the *receive*
//! path. But that filter has no role in the publish path. Without this gate,
//! a kicked user (no longer in `app.space_members`) could still POST kind:9
//! messages with the space's `h` tag — the relay would store them and other
//! members would see them in their broadcast stream.
//!
//! This module factors the decision into pure logic so it can be unit-tested
//! without a database. The handler does the DB lookup and feeds the result
//! into `evaluate_publish_gate`.
//!
//! NIP-29 management kinds (and a few related ones) are exempt because they
//! either have their own auth checks (admin-only kinds 9000/9001/9005/9007/9008)
//! or are *explicitly* valid from non-members (9021 join request, 9022 leave,
//! 5 NIP-09 self-deletion).

use crate::nostr::event::Event;

/// Outcome of the publish gate.
#[derive(Debug, PartialEq, Eq)]
pub enum PublishVerdict {
    Allow,
    /// Reject with a static reason that becomes the prefix of the OK message.
    Reject(&'static str),
}

/// Whether an event of this kind needs to pass the h-tag membership check
/// before being stored/broadcast. Returns false for NIP-29 management and
/// related auxiliary kinds, which are handled elsewhere or valid from non-members.
pub fn requires_h_membership_check(kind: i32) -> bool {
    !matches!(
        kind,
        5      // NIP-09 self-deletion (author-only)
        | 9000 // NIP-29 add user (admin-gated)
        | 9001 // NIP-29 remove user (admin-gated)
        | 9005 // NIP-29 mod delete event (admin-gated)
        | 9007 // NIP-29 create group
        | 9008 // NIP-29 delete group
        | 9021 // NIP-29 join request (from non-member by definition)
        | 9022 // NIP-29 leave request
    )
}

/// Pure gate: given an event and a precomputed "is author a member of the
/// h-tagged space?" flag, decide whether the relay should accept this publish.
///
/// The flag is computed by the caller via a `app.space_members` lookup. It is
/// only consulted when the event is space-scoped (h-tagged) AND the kind is
/// subject to the membership check (`requires_h_membership_check`).
pub fn evaluate_publish_gate(event: &Event, is_member: bool) -> PublishVerdict {
    // Events without an h tag are not space-scoped — gate doesn't apply.
    if event.get_tag_value("h").is_none() {
        return PublishVerdict::Allow;
    }

    // Exempt kinds (NIP-29 management) skip the membership check.
    if !requires_h_membership_check(event.kind) {
        return PublishVerdict::Allow;
    }

    if !is_member {
        return PublishVerdict::Reject("auth-required: not a member of this group");
    }

    PublishVerdict::Allow
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_with(kind: i32, tags: Vec<Vec<String>>) -> Event {
        Event {
            id: "id".to_string(),
            pubkey: "alice".to_string(),
            created_at: 1_000_000,
            kind,
            tags,
            content: String::new(),
            sig: "sig".to_string(),
        }
    }

    fn h_tagged(kind: i32) -> Event {
        event_with(kind, vec![vec!["h".into(), "space_x".into()]])
    }

    // ── requires_h_membership_check ─────────────────────────────────────

    #[test]
    fn ordinary_content_kinds_require_membership_check() {
        // Kinds where a kicked member could otherwise spam the channel.
        for kind in [1, 9, 22, 1311, 30023, 30311] {
            assert!(
                requires_h_membership_check(kind),
                "kind {kind} should require membership check"
            );
        }
    }

    #[test]
    fn nip29_management_kinds_exempt() {
        for kind in [5, 9000, 9001, 9005, 9007, 9008, 9021, 9022] {
            assert!(
                !requires_h_membership_check(kind),
                "kind {kind} must skip membership check (handled separately)"
            );
        }
    }

    // ── evaluate_publish_gate ───────────────────────────────────────────

    /// Reproduces the reported bug pre-fix: a kicked member's kind:9 chat
    /// message tagged with `h=space_x` must NOT be accepted by the relay.
    /// Before the fix, the publish path stored and broadcast the event regardless.
    #[test]
    fn kicked_member_cannot_post_to_space_chat() {
        let chat = h_tagged(9);
        assert_eq!(
            evaluate_publish_gate(&chat, false),
            PublishVerdict::Reject("auth-required: not a member of this group"),
        );
    }

    /// Sanity: actual members are accepted.
    #[test]
    fn member_can_post_to_space_chat() {
        let chat = h_tagged(9);
        assert_eq!(evaluate_publish_gate(&chat, true), PublishVerdict::Allow);
    }

    /// Events with no h tag (e.g. global kind:1 notes) are not subject to
    /// space-membership checks even if the author isn't in any space.
    #[test]
    fn untagged_events_always_pass_gate() {
        let global_note = event_with(1, vec![]);
        assert_eq!(
            evaluate_publish_gate(&global_note, false),
            PublishVerdict::Allow,
        );
    }

    /// A kicked user must be allowed to send kind:9022 (leave) — that's how
    /// they signal departure. The membership check would otherwise create
    /// a circular block.
    #[test]
    fn leave_request_allowed_from_non_member() {
        let leave = h_tagged(9022);
        assert_eq!(evaluate_publish_gate(&leave, false), PublishVerdict::Allow);
    }

    /// Join requests come from non-members by definition.
    #[test]
    fn join_request_allowed_from_non_member() {
        let join = h_tagged(9021);
        assert_eq!(evaluate_publish_gate(&join, false), PublishVerdict::Allow);
    }

    /// NIP-29 admin actions (kind 9001 = remove user) bypass this gate; they
    /// are admin-checked in `nip29::moderation::handle_remove_user`. The
    /// membership gate must not double-reject them.
    #[test]
    fn admin_kind_bypasses_membership_gate() {
        // The admin who's running the kick may not even be h-tagged as a
        // member in some flows (e.g. role hierarchy via app.space_admins).
        let kick_event = h_tagged(9001);
        assert_eq!(
            evaluate_publish_gate(&kick_event, false),
            PublishVerdict::Allow,
        );
    }

    /// NIP-09 self-deletions (kind 5) are not gated here — author identity
    /// is verified inside `handle_deletion`. Kicked members must still be
    /// able to delete their own past content.
    #[test]
    fn self_deletion_bypasses_membership_gate() {
        let deletion = h_tagged(5);
        assert_eq!(
            evaluate_publish_gate(&deletion, false),
            PublishVerdict::Allow,
        );
    }

    /// Kind:22 (video posts) and kind:1311 (live chat) are common content
    /// vectors a kicked spammer could exploit — all must be gated.
    #[test]
    fn content_kinds_other_than_chat_also_gated() {
        for kind in [22, 1311] {
            let evt = h_tagged(kind);
            assert_eq!(
                evaluate_publish_gate(&evt, false),
                PublishVerdict::Reject("auth-required: not a member of this group"),
                "kind {kind} should be rejected for non-members",
            );
        }
    }
}
