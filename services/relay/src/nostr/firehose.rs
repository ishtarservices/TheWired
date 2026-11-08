//! The firehose policy (`RELAY_FIREHOSE_POLICY`): what an untargeted
//! kind-1 REQ shows.
//!
//! The public relay receives notes from accounts that never chose this
//! community — other clients deliver replies, reactions and mentions to a
//! Wired user's NIP-65 inbox relays, and some users add the relay from a
//! directory. A REQ that asks for *everything* (the mobile live feed, any
//! client's global view of the relay) therefore fills up with strangers.
//! Under the `community` policy such a request is restricted to the relay's
//! community authors (`db::community`), while every targeted request — by
//! id, author, thread, mention, address or search — keeps returning exactly
//! what it does today, so threads, notifications, profiles and other
//! clients' use of the relay are untouched.
//!
//! Pure functions only; the policy is applied by the stored-query builder
//! (`db::event_store::build_conditions`) and the live fan-out
//! (`connection::live_matching_subs`).

use crate::nostr::filter::Filter;

/// `RELAY_FIREHOSE_POLICY`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FirehosePolicy {
    /// Serve every stored and live note (today's behaviour, the default).
    #[default]
    All,
    /// Restrict firehose requests to community authors; the authenticated
    /// reader always sees its own notes.
    Community,
}

impl FirehosePolicy {
    /// Lenient: anything but `community` is `all`, the safe default.
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "community" => FirehosePolicy::Community,
            _ => FirehosePolicy::All,
        }
    }
}

/// Kinds whose untargeted request is a timeline: text notes, reposts and
/// picture posts. A filter that names none of them (reactions alone, chat,
/// lists) is not a firehose whatever else it omits.
pub const FIREHOSE_KINDS: [i32; 3] = [1, 6, 20];

/// Is this filter a firehose — a timeline request with nothing to scope it?
/// True when its kinds are empty or include one of [`FIREHOSE_KINDS`], and it
/// carries no `ids`, no `authors`, no `#e` / `#p` / `#a` / `#d` / `#h` tag
/// filter and no NIP-50 `search`. `since`, `until` and `limit` do not scope
/// a request; nor does a hashtag or any other generic tag.
pub fn is_firehose(filter: &Filter) -> bool {
    if !filter.kinds.is_empty() && !filter.kinds.iter().any(|k| FIREHOSE_KINDS.contains(k)) {
        return false;
    }
    filter.ids.is_empty()
        && filter.authors.is_empty()
        && filter.e_tags.is_empty()
        && filter.p_tags.is_empty()
        && filter.d_tags.is_empty()
        && filter.h_tags.is_empty()
        && filter.search.is_none()
        && !filter.generic_tags.iter().any(|(name, _)| name == "a")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: serde_json::Value) -> Filter {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn policy_parses_leniently() {
        assert_eq!(FirehosePolicy::parse("community"), FirehosePolicy::Community);
        assert_eq!(FirehosePolicy::parse(" Community "), FirehosePolicy::Community);
        assert_eq!(FirehosePolicy::parse("all"), FirehosePolicy::All);
        assert_eq!(FirehosePolicy::parse(""), FirehosePolicy::All);
        assert_eq!(FirehosePolicy::parse("garbage"), FirehosePolicy::All);
        assert_eq!(FirehosePolicy::default(), FirehosePolicy::All);
    }

    /// The timeline shapes: the mobile live feed, an empty filter, a window
    /// with since/until/limit only, kinds that merely include a timeline
    /// kind, and the resync shape (an internal `first_seen_since`).
    #[test]
    fn untargeted_timeline_filters_are_firehose() {
        assert!(is_firehose(&parse(serde_json::json!({"kinds": [1], "limit": 50}))));
        assert!(is_firehose(&parse(serde_json::json!({"kinds": [1, 7]}))));
        assert!(is_firehose(&parse(serde_json::json!({"kinds": [6]}))));
        assert!(is_firehose(&parse(serde_json::json!({"kinds": [20]}))));
        assert!(is_firehose(&parse(serde_json::json!({"kinds": [1, 6, 20]}))));
        assert!(is_firehose(&parse(serde_json::json!({}))), "an empty filter asks for everything");
        assert!(is_firehose(&parse(serde_json::json!({"kinds": []}))), "explicitly empty kinds too");
        assert!(is_firehose(&parse(serde_json::json!({"kinds": [7, 1]}))), "order does not matter");
        assert!(is_firehose(&parse(serde_json::json!({"kinds": [6, 7]}))));
        assert!(is_firehose(&parse(serde_json::json!({"kinds": [1], "#t": ["a"], "#r": ["https://x"]}))), "generic tags other than #a do not scope");
        assert!(is_firehose(&parse(serde_json::json!({"since": 1, "until": 2, "limit": 3}))));
        assert!(is_firehose(&parse(serde_json::json!({"kinds": [1], "#t": ["nostr"]}))), "a hashtag does not scope");
        let mut resync = parse(serde_json::json!({"kinds": [1]}));
        resync.first_seen_since = Some(1);
        assert!(is_firehose(&resync));
    }

    /// Kinds without a timeline kind are never a firehose.
    #[test]
    fn non_timeline_kinds_are_not_firehose() {
        assert!(!is_firehose(&parse(serde_json::json!({"kinds": [7]}))), "reactions alone");
        assert!(!is_firehose(&parse(serde_json::json!({"kinds": [9]}))), "chat");
        assert!(!is_firehose(&parse(serde_json::json!({"kinds": [0, 3, 10002]}))));
        assert!(!is_firehose(&parse(serde_json::json!({"kinds": [1059]}))));
    }

    /// Every targeting field makes the request targeted, whatever the kinds.
    #[test]
    fn targeted_filters_are_not_firehose() {
        let pk = "a".repeat(64);
        let id = "b".repeat(64);
        for f in [
            serde_json::json!({"kinds": [1], "ids": [id]}),
            serde_json::json!({"kinds": [1], "authors": [pk]}),
            serde_json::json!({"authors": [pk]}),
            serde_json::json!({"kinds": [1], "#e": [id]}),
            serde_json::json!({"kinds": [1, 7], "#p": [pk]}),
            serde_json::json!({"kinds": [1], "#a": ["30023:x:slug"]}),
            serde_json::json!({"kinds": [1], "#d": ["slug"]}),
            serde_json::json!({"kinds": [1], "#h": ["space"]}),
            serde_json::json!({"#h": ["space"]}),
            serde_json::json!({"kinds": [1], "search": "hello"}),
            serde_json::json!({"search": "hello"}),
            serde_json::json!({"kinds": [1], "#t": ["x"], "#e": [id]}),
            serde_json::json!({"ids": [id], "authors": [pk], "#p": [pk]}),
        ] {
            assert!(!is_firehose(&parse(f.clone())), "{f}");
        }
    }
}
