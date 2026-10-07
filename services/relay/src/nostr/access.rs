//! The one read-visibility policy for protected events, shared by every path
//! that decides whether a reader may see a stored or live event: Postgres
//! stored queries and NIP-50 search (`db/event_store.rs`, `protocol/nip50.rs`),
//! the embedded SQLite build (`db/sqlite.rs`), and live broadcast
//! (`connection.rs`). The backend mirrors it in
//! `services/backend/src/services/musicVisibility.ts` /
//! `blobAccess.ts`. Reference: docs/MUSIC_VISIBILITY.md §"Who may view".
//!
//! Policy, in order:
//! 1. An event with no `visibility` tag and no `h` tag is public.
//! 2. Anonymous readers never see a protected event.
//! 3. The author always does.
//! 4. An access-granting `p` tag always does (see [`p_tag_grants_access`]).
//! 5. `visibility` private/unlisted admits nobody else — an `h` tag on a
//!    private event does not widen it to the space.
//! 6. Otherwise (`h` only) a member of ANY listed space does.
//!
//! The SQL fragments below spell out exactly the same predicate so that a
//! REQ, a search, and a live push can never disagree about one event.

use crate::nostr::event::Event;

/// p-tag roles (4th element) that unlock protected content. `owner` is a human
/// holder of a shared project key (WIR-172: the event is signed by the project
/// key, so this is how holders read their own gated project as themselves).
/// `featured` and any unknown role are credits, not grants; a role-less p tag
/// keeps granting for events that predate roles. Keep in sync with
/// `services/backend/src/services/blobAccess.ts` ACCESS_ROLES.
pub const ACCESS_ROLES: [&str; 5] = ["owner", "artist", "collaborator", "contributor", "editor"];

/// Does this `p` tag grant `pubkey` access to protected content?
pub fn p_tag_grants_access(tag: &[String], pubkey: &str) -> bool {
    if tag.first().map(String::as_str) != Some("p") || tag.get(1).map(String::as_str) != Some(pubkey) {
        return false;
    }
    match tag.get(3).map(String::as_str) {
        None | Some("") => true,
        Some(role) => ACCESS_ROLES.contains(&role),
    }
}

/// Is `visibility` a value that protects the event? Any non-empty value is
/// treated as protected (conservative: an unknown value hides rather than
/// exposes).
pub fn is_protected_visibility(visibility: Option<&str>) -> bool {
    visibility.is_some_and(|v| !v.is_empty())
}

/// Pure in-memory evaluation of the policy. `is_member_of_any` answers "is the
/// reader a member of at least one of these space ids" against whatever
/// membership source the caller has (per-connection cache, DB, …).
pub fn is_visible_to(
    event: &Event,
    authed: Option<&str>,
    is_member_of_any: impl FnOnce(&[String]) -> bool,
) -> bool {
    let visibility = event.get_tag_values("visibility").into_iter().next();
    let h_tags = event.get_tag_values("h");
    let protected = is_protected_visibility(visibility.as_deref()) || !h_tags.is_empty();
    if !protected {
        return true;
    }
    let Some(pk) = authed else { return false };
    if event.pubkey == pk {
        return true;
    }
    if event.tags.iter().any(|t| p_tag_grants_access(t, pk)) {
        return true;
    }
    if is_protected_visibility(visibility.as_deref()) {
        return false;
    }
    is_member_of_any(&h_tags)
}

/// SQL list literal of the granting roles plus the empty string (role-less),
/// for `COALESCE(role, '') IN (...)` clauses. Roles are compile-time constants,
/// so interpolating them is safe.
pub fn sql_granting_roles() -> String {
    let mut parts = vec!["''".to_string()];
    parts.extend(ACCESS_ROLES.iter().map(|r| format!("'{r}'")));
    parts.join(", ")
}

/// Postgres predicate for an authenticated reader whose pubkey is bound as
/// `{pk}` (an expression such as `$3` or `$4[1]`). `members_any` is an
/// expression that is true when the row's `h_tags` overlaps the reader's
/// memberships. Column references are unqualified; pass `col_prefix` such as
/// `e.` when the query aliases the table.
pub fn pg_visible_predicate(pk: &str, members_any: &str, col_prefix: &str) -> String {
    let roles = sql_granting_roles();
    format!(
        "({p}pubkey = {pk} \
          OR ({pk} = ANY({p}p_tags) AND EXISTS (SELECT 1 FROM jsonb_array_elements({p}tags) pt \
               WHERE pt->>0 = 'p' AND pt->>1 = {pk} AND COALESCE(pt->>3, '') IN ({roles}))) \
          OR ({p}visibility IS NULL AND ({p}h_tag IS NULL OR {members_any})))",
        p = col_prefix
    )
}

/// Postgres predicate for an anonymous reader.
pub fn pg_anonymous_predicate(col_prefix: &str) -> String {
    format!("({p}visibility IS NULL AND {p}h_tag IS NULL)", p = col_prefix)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(pubkey: &str, tags: Vec<Vec<&str>>) -> Event {
        Event {
            id: "id".into(),
            pubkey: pubkey.into(),
            created_at: 1,
            kind: 31683,
            tags: tags.into_iter().map(|t| t.into_iter().map(String::from).collect()).collect(),
            content: String::new(),
            sig: String::new(),
        }
    }
    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn roles_decide_grants() {
        assert!(p_tag_grants_access(&s(&["p", "bob"]), "bob"), "legacy role-less grants");
        assert!(p_tag_grants_access(&s(&["p", "bob", ""]), "bob"));
        assert!(p_tag_grants_access(&s(&["p", "bob", "", ""]), "bob"), "empty role = legacy");
        for role in ACCESS_ROLES {
            assert!(p_tag_grants_access(&s(&["p", "bob", "", role]), "bob"), "{role} grants");
        }
        assert!(!p_tag_grants_access(&s(&["p", "bob", "", "featured"]), "bob"), "featured is a credit");
        assert!(!p_tag_grants_access(&s(&["p", "bob", "", "producer"]), "bob"), "unknown role is a credit");
        assert!(!p_tag_grants_access(&s(&["p", "carol", "", "editor"]), "bob"), "other pubkey");
        assert!(!p_tag_grants_access(&s(&["e", "bob"]), "bob"), "not a p tag");
    }

    #[test]
    fn public_is_visible_to_everyone() {
        let e = ev("alice", vec![vec!["d", "x"]]);
        assert!(is_visible_to(&e, None, |_| false));
        assert!(is_visible_to(&e, Some("zed"), |_| false));
    }

    #[test]
    fn anonymous_never_sees_protected() {
        assert!(!is_visible_to(&ev("alice", vec![vec!["h", "s"]]), None, |_| true));
        assert!(!is_visible_to(&ev("alice", vec![vec!["visibility", "private"]]), None, |_| true));
    }

    #[test]
    fn author_and_grantee_see_every_shape() {
        for tags in [
            vec![vec!["h", "s"]],
            vec![vec!["visibility", "private"]],
            vec![vec!["visibility", "unlisted"], vec!["h", "s"]],
        ] {
            let mut t = tags.clone();
            t.push(vec!["p", "bob", "", "collaborator"]);
            t.push(vec!["p", "fay", "", "featured"]);
            let e = ev("alice", t);
            assert!(is_visible_to(&e, Some("alice"), |_| false), "author {tags:?}");
            assert!(is_visible_to(&e, Some("bob"), |_| false), "collaborator {tags:?}");
            assert!(!is_visible_to(&e, Some("fay"), |_| false), "featured credit {tags:?}");
            assert!(!is_visible_to(&e, Some("zed"), |_| false), "stranger {tags:?}");
        }
    }

    #[test]
    fn space_membership_is_any_of_and_only_for_h_only_events() {
        let shared = ev("alice", vec![vec!["h", "s1"], vec!["h", "s2"]]);
        assert!(is_visible_to(&shared, Some("bob"), |hs| hs.contains(&"s2".to_string())));
        assert!(!is_visible_to(&shared, Some("bob"), |_| false));

        // A private event in a space is NOT widened to the space's members.
        let private_in_space = ev("alice", vec![vec!["h", "s1"], vec!["visibility", "private"]]);
        assert!(!is_visible_to(&private_in_space, Some("bob"), |_| true));
    }

    #[test]
    fn malformed_first_tags_do_not_unprotect() {
        // A value-less first ["h"] must not hide the real second h tag.
        let e = ev("alice", vec![vec!["h"], vec!["h", "s"]]);
        assert!(!is_visible_to(&e, Some("zed"), |_| false));
        assert!(is_visible_to(&e, Some("bob"), |hs| hs == ["s".to_string()]));
        // A value-less ["visibility"] is not a protection either (no value).
        let open = ev("alice", vec![vec!["visibility"]]);
        assert!(is_visible_to(&open, None, |_| false));
    }

    #[test]
    fn sql_role_list_is_stable() {
        assert_eq!(sql_granting_roles(), "'', 'owner', 'artist', 'collaborator', 'contributor', 'editor'");
        let p = pg_visible_predicate("$4", "h_tags && ARRAY[]::text[]", "e.");
        assert!(p.contains("e.pubkey = $4"));
        assert!(p.contains("e.visibility IS NULL AND (e.h_tag IS NULL OR h_tags && ARRAY[]::text[])"));
    }
}
