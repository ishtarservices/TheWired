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
//! without a database. The handler does the DB lookups and feeds the results
//! into `evaluate_publish_gate`.
//!
//! Multi-space events (several `["h", id]` tags — music kinds may list every
//! space a track is shared into) are gated **all-of**: the author must be a
//! member of every listed space the relay can resolve. Ids the relay does not
//! know (`SpaceMembership::Unknown`: neither an `app.spaces` row nor a
//! `relay.groups` row) are ignored so a track can also be tagged for a space
//! hosted elsewhere, but at least one resolved membership is required — an
//! event whose h tags are ALL unknown would otherwise be stored as space-scoped
//! content nobody here can read, or as a way to smuggle in unreadable rows.
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
        | 9002 // NIP-29 edit metadata (admin-gated)
        | 9005 // NIP-29 mod delete event (admin-gated)
        | 9007 // NIP-29 create group
        | 9008 // NIP-29 delete group
        | 9021 // NIP-29 join request (from non-member by definition)
        | 9022 // NIP-29 leave request
    )
}

/// Upper bound on DISTINCT `h` tags a single event may carry. Each one costs a
/// membership lookup on publish, so this caps the per-EVENT DB work.
pub const MAX_H_TAGS: usize = 16;

/// The author's standing in one h-tagged space, as resolved by the relay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpaceMembership {
    /// The relay hosts no space/group with this id — ignored by the gate.
    Unknown,
    /// The space exists here and the author is NOT a member.
    NonMember,
    /// The space exists here and the author is a member.
    Member,
}

/// Pure gate: given an event and the author's membership status in each of
/// its distinct h-tagged spaces (in tag order), decide whether the relay
/// should accept this publish.
///
/// Rules, in order:
///   1. no h tag → Allow (not space-scoped);
///   2. exempt kind (`requires_h_membership_check` false) → Allow;
///   3. more than [`MAX_H_TAGS`] distinct h tags → Reject;
///   4. any resolved space where the author is a NonMember → Reject;
///   5. no resolved Member at all (every id Unknown) → Reject;
///   6. otherwise Allow.
///
/// For a single-h event this is exactly the old boolean gate: `[Member]` →
/// Allow, `[NonMember]` → Reject. The statuses are computed by the caller
/// via `Db::space_membership` (`app.*` ∪ `relay.*` on Postgres, relay-native
/// on SQLite).
pub fn evaluate_publish_gate(event: &Event, statuses: &[SpaceMembership]) -> PublishVerdict {
    let h_tags = event.get_tag_values("h");

    // Events without an h tag are not space-scoped — gate doesn't apply.
    if h_tags.is_empty() {
        return PublishVerdict::Allow;
    }

    // Exempt kinds (NIP-29 management) skip the membership check.
    if !requires_h_membership_check(event.kind) {
        return PublishVerdict::Allow;
    }

    if distinct_h_tags(event).len() > MAX_H_TAGS {
        return PublishVerdict::Reject("invalid: too many h tags");
    }

    if statuses.contains(&SpaceMembership::NonMember) {
        return PublishVerdict::Reject("auth-required: not a member of this group");
    }

    if !statuses.contains(&SpaceMembership::Member) {
        return PublishVerdict::Reject("auth-required: not a member of this group");
    }

    PublishVerdict::Allow
}

/// The event's `h` tag values with duplicates removed, first occurrence wins.
/// The caller resolves one [`SpaceMembership`] per entry, in this order.
pub fn distinct_h_tags(event: &Event) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for h in event.get_tag_values("h") {
        if !out.contains(&h) {
            out.push(h);
        }
    }
    out
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

    fn multi_h(kind: i32, ids: &[&str]) -> Event {
        event_with(
            kind,
            ids.iter().map(|id| vec!["h".to_string(), id.to_string()]).collect(),
        )
    }

    use SpaceMembership::{Member, NonMember, Unknown};

    const NOT_A_MEMBER: PublishVerdict =
        PublishVerdict::Reject("auth-required: not a member of this group");

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
        for kind in [5, 9000, 9001, 9002, 9005, 9007, 9008, 9021, 9022] {
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
            evaluate_publish_gate(&chat, &[NonMember]),
            PublishVerdict::Reject("auth-required: not a member of this group"),
        );
    }

    /// Sanity: actual members are accepted.
    #[test]
    fn member_can_post_to_space_chat() {
        let chat = h_tagged(9);
        assert_eq!(evaluate_publish_gate(&chat, &[Member]), PublishVerdict::Allow);
    }

    /// Events with no h tag (e.g. global kind:1 notes) are not subject to
    /// space-membership checks even if the author isn't in any space.
    #[test]
    fn untagged_events_always_pass_gate() {
        let global_note = event_with(1, vec![]);
        assert_eq!(
            evaluate_publish_gate(&global_note, &[]),
            PublishVerdict::Allow,
        );
    }

    /// A kicked user must be allowed to send kind:9022 (leave) — that's how
    /// they signal departure. The membership check would otherwise create
    /// a circular block.
    #[test]
    fn leave_request_allowed_from_non_member() {
        let leave = h_tagged(9022);
        assert_eq!(evaluate_publish_gate(&leave, &[NonMember]), PublishVerdict::Allow);
    }

    /// Join requests come from non-members by definition.
    #[test]
    fn join_request_allowed_from_non_member() {
        let join = h_tagged(9021);
        assert_eq!(evaluate_publish_gate(&join, &[NonMember]), PublishVerdict::Allow);
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
            evaluate_publish_gate(&kick_event, &[NonMember]),
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
            evaluate_publish_gate(&deletion, &[NonMember]),
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
                evaluate_publish_gate(&evt, &[NonMember]),
                PublishVerdict::Reject("auth-required: not a member of this group"),
                "kind {kind} should be rejected for non-members",
            );
        }
    }

    // ── multi-space (several h tags) ────────────────────────────────────

    /// A single unknown id (space hosted elsewhere) alone cannot pass: the
    /// gate needs at least one resolved membership.
    #[test]
    fn single_unknown_space_rejected() {
        let chat = h_tagged(9);
        assert_eq!(evaluate_publish_gate(&chat, &[Unknown]), NOT_A_MEMBER);
    }

    /// Member of every listed space → accepted.
    #[test]
    fn multi_h_member_of_all_allowed() {
        let track = multi_h(31683, &["s1", "s2", "s3"]);
        assert_eq!(
            evaluate_publish_gate(&track, &[Member, Member, Member]),
            PublishVerdict::Allow
        );
    }

    /// Non-member of ANY listed (resolved) space → rejected, even if a member
    /// of the others. Sharing into a space you are not in is not allowed.
    #[test]
    fn multi_h_non_member_of_one_rejected() {
        let track = multi_h(31683, &["s1", "s2"]);
        assert_eq!(evaluate_publish_gate(&track, &[Member, NonMember]), NOT_A_MEMBER);
        assert_eq!(evaluate_publish_gate(&track, &[NonMember, Member]), NOT_A_MEMBER);
    }

    /// Ids the relay does not host are ignored as long as one listed space
    /// resolves to a membership.
    #[test]
    fn multi_h_unknown_ignored_when_another_is_member() {
        let track = multi_h(31683, &["elsewhere", "s2"]);
        assert_eq!(
            evaluate_publish_gate(&track, &[Unknown, Member]),
            PublishVerdict::Allow
        );
    }

    /// All listed ids unknown → nothing here vouches for the author; reject.
    #[test]
    fn multi_h_all_unknown_rejected() {
        let track = multi_h(31683, &["a", "b"]);
        assert_eq!(evaluate_publish_gate(&track, &[Unknown, Unknown]), NOT_A_MEMBER);
    }

    /// More than MAX_H_TAGS distinct ids → rejected up front, regardless of
    /// membership.
    #[test]
    fn multi_h_too_many_rejected() {
        let ids: Vec<String> = (0..=MAX_H_TAGS).map(|i| format!("s{i}")).collect();
        let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
        let track = multi_h(31683, &refs);
        let statuses = vec![Member; MAX_H_TAGS + 1];
        assert_eq!(
            evaluate_publish_gate(&track, &statuses),
            PublishVerdict::Reject("invalid: too many h tags")
        );
        // Exactly MAX_H_TAGS is fine.
        let track_ok = multi_h(31683, &refs[..MAX_H_TAGS]);
        assert_eq!(
            evaluate_publish_gate(&track_ok, &[Member; MAX_H_TAGS]),
            PublishVerdict::Allow
        );
    }

    /// Duplicate h tags count once toward the cap and collapse in
    /// `distinct_h_tags` (first occurrence order).
    #[test]
    fn duplicate_h_tags_are_deduped() {
        let track = multi_h(31683, &["s1", "s2", "s1"]);
        assert_eq!(distinct_h_tags(&track), vec!["s1".to_string(), "s2".to_string()]);
        let many: Vec<String> = (0..MAX_H_TAGS * 2).map(|i| format!("s{}", i % 2)).collect();
        let refs: Vec<&str> = many.iter().map(String::as_str).collect();
        let dup = multi_h(31683, &refs);
        assert_eq!(evaluate_publish_gate(&dup, &[Member, Member]), PublishVerdict::Allow);
    }

    /// Exempt kinds bypass the gate even with several h tags.
    #[test]
    fn multi_h_exempt_kind_allowed() {
        let leave = multi_h(9022, &["s1", "s2"]);
        assert_eq!(
            evaluate_publish_gate(&leave, &[NonMember, NonMember]),
            PublishVerdict::Allow
        );
    }
}
