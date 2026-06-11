use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Debug, Default, Clone)]
pub struct Filter {
    pub ids: Vec<String>,
    pub authors: Vec<String>,
    pub kinds: Vec<i32>,
    pub since: Option<i64>,
    pub until: Option<i64>,
    pub limit: Option<i64>,
    pub search: Option<String>,
    pub h_tags: Vec<String>,
    pub p_tags: Vec<String>,
    pub e_tags: Vec<String>,
    pub d_tags: Vec<String>,
    /// Any other single-letter `#x` tag filter (NIP-01) → its allowed values.
    /// Previously dropped, returning over-broad results (#69).
    pub generic_tags: Vec<(String, Vec<String>)>,
}

/// Intermediate shape for deserialization: the known fields are named, everything
/// else falls into `extra`, from which we pluck single-letter `#x` tag filters.
#[derive(Deserialize)]
struct RawFilter {
    #[serde(default)]
    ids: Vec<String>,
    #[serde(default)]
    authors: Vec<String>,
    #[serde(default)]
    kinds: Vec<i32>,
    since: Option<i64>,
    until: Option<i64>,
    limit: Option<i64>,
    search: Option<String>,
    #[serde(rename = "#h", default)]
    h_tags: Vec<String>,
    #[serde(rename = "#p", default)]
    p_tags: Vec<String>,
    #[serde(rename = "#e", default)]
    e_tags: Vec<String>,
    #[serde(rename = "#d", default)]
    d_tags: Vec<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

impl<'de> Deserialize<'de> for Filter {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = RawFilter::deserialize(deserializer)?;
        let mut generic_tags = Vec::new();
        for (key, value) in raw.extra {
            // NIP-01: a single-letter `#x` key is a tag filter. The named fields
            // above already captured #h/#p/#e/#d; ignore any other key shape.
            if let Some(letter) = key.strip_prefix('#') {
                if letter.len() == 1
                    && letter.as_bytes()[0].is_ascii_alphabetic()
                    && !matches!(letter, "h" | "p" | "e" | "d")
                {
                    if let Ok(values) = serde_json::from_value::<Vec<String>>(value) {
                        if !values.is_empty() {
                            generic_tags.push((letter.to_string(), values));
                        }
                    }
                }
            }
        }
        Ok(Filter {
            ids: raw.ids,
            authors: raw.authors,
            kinds: raw.kinds,
            since: raw.since,
            until: raw.until,
            limit: raw.limit,
            search: raw.search,
            h_tags: raw.h_tags,
            p_tags: raw.p_tags,
            e_tags: raw.e_tags,
            d_tags: raw.d_tags,
            generic_tags,
        })
    }
}

impl Filter {
    /// Check if an event matches this filter (for live subscription matching)
    pub fn matches(&self, event: &super::event::Event) -> bool {
        if !self.ids.is_empty() && !self.ids.contains(&event.id) {
            return false;
        }
        if !self.authors.is_empty() && !self.authors.contains(&event.pubkey) {
            return false;
        }
        if !self.kinds.is_empty() && !self.kinds.contains(&event.kind) {
            return false;
        }
        if let Some(since) = self.since {
            if event.created_at < since {
                return false;
            }
        }
        if let Some(until) = self.until {
            if event.created_at > until {
                return false;
            }
        }
        // Check h-tag filter
        if !self.h_tags.is_empty() && !self.event_has_matching_tag(event, "h", &self.h_tags) {
            return false;
        }
        // Check p-tag filter (critical for gift wraps / DMs)
        if !self.p_tags.is_empty() && !self.event_has_matching_tag(event, "p", &self.p_tags) {
            return false;
        }
        // Check e-tag filter
        if !self.e_tags.is_empty() && !self.event_has_matching_tag(event, "e", &self.e_tags) {
            return false;
        }
        // Check d-tag filter
        if !self.d_tags.is_empty() && !self.event_has_matching_tag(event, "d", &self.d_tags) {
            return false;
        }
        // Check any generic single-letter tag filters (#69).
        for (name, values) in &self.generic_tags {
            if !self.event_has_matching_tag(event, name, values) {
                return false;
            }
        }
        true
    }

    /// Check if any tag of the given name in the event has a value in the filter set
    fn event_has_matching_tag(&self, event: &super::event::Event, tag_name: &str, filter_values: &[String]) -> bool {
        event.tags.iter().any(|t| {
            t.first().map(|s| s.as_str()) == Some(tag_name)
                && t.get(1).map(|v| filter_values.contains(v)).unwrap_or(false)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nostr::event::Event;

    fn make_event(overrides: Option<Event>) -> Event {
        let base = Event {
            id: "abc123".to_string(),
            pubkey: "pubkey1".to_string(),
            created_at: 1000,
            kind: 1,
            tags: vec![
                vec!["h".to_string(), "group1".to_string()],
                vec!["p".to_string(), "pk_target".to_string()],
                vec!["e".to_string(), "evt_ref".to_string()],
                vec!["d".to_string(), "my-slug".to_string()],
            ],
            content: "hello".to_string(),
            sig: "sig".to_string(),
        };
        overrides.unwrap_or(base)
    }

    #[test]
    fn test_empty_filter_matches_everything() {
        let filter = Filter::default();
        let event = make_event(None);
        assert!(filter.matches(&event));
    }

    #[test]
    fn test_ids_filter_match() {
        let filter = Filter {
            ids: vec!["abc123".to_string()],
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None)));
    }

    #[test]
    fn test_ids_filter_no_match() {
        let filter = Filter {
            ids: vec!["other".to_string()],
            ..Default::default()
        };
        assert!(!filter.matches(&make_event(None)));
    }

    #[test]
    fn test_authors_filter_match() {
        let filter = Filter {
            authors: vec!["pubkey1".to_string()],
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None)));
    }

    #[test]
    fn test_authors_filter_no_match() {
        let filter = Filter {
            authors: vec!["other_pubkey".to_string()],
            ..Default::default()
        };
        assert!(!filter.matches(&make_event(None)));
    }

    #[test]
    fn test_kinds_filter_match() {
        let filter = Filter {
            kinds: vec![1],
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None)));
    }

    #[test]
    fn test_kinds_filter_no_match() {
        let filter = Filter {
            kinds: vec![0, 7],
            ..Default::default()
        };
        assert!(!filter.matches(&make_event(None)));
    }

    #[test]
    fn test_since_filter() {
        let filter = Filter {
            since: Some(999),
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None))); // 1000 >= 999

        let filter2 = Filter {
            since: Some(1001),
            ..Default::default()
        };
        assert!(!filter2.matches(&make_event(None))); // 1000 < 1001
    }

    #[test]
    fn test_until_filter() {
        let filter = Filter {
            until: Some(1001),
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None))); // 1000 <= 1001

        let filter2 = Filter {
            until: Some(999),
            ..Default::default()
        };
        assert!(!filter2.matches(&make_event(None))); // 1000 > 999
    }

    #[test]
    fn test_since_and_until_range() {
        let filter = Filter {
            since: Some(500),
            until: Some(1500),
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None))); // 500 <= 1000 <= 1500
    }

    #[test]
    fn test_h_tags_filter_match() {
        let filter = Filter {
            h_tags: vec!["group1".to_string()],
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None)));
    }

    #[test]
    fn test_h_tags_filter_no_match() {
        let filter = Filter {
            h_tags: vec!["other_group".to_string()],
            ..Default::default()
        };
        assert!(!filter.matches(&make_event(None)));
    }

    #[test]
    fn test_p_tags_filter_match() {
        let filter = Filter {
            p_tags: vec!["pk_target".to_string()],
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None)));
    }

    #[test]
    fn test_e_tags_filter_match() {
        let filter = Filter {
            e_tags: vec!["evt_ref".to_string()],
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None)));
    }

    #[test]
    fn test_d_tags_filter_match() {
        let filter = Filter {
            d_tags: vec!["my-slug".to_string()],
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None)));
    }

    #[test]
    fn test_combined_filters_all_match() {
        let filter = Filter {
            authors: vec!["pubkey1".to_string()],
            kinds: vec![1],
            h_tags: vec!["group1".to_string()],
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None)));
    }

    #[test]
    fn test_combined_filters_one_fails() {
        let filter = Filter {
            authors: vec!["pubkey1".to_string()],
            kinds: vec![9], // Kind mismatch -- event is kind 1
            h_tags: vec!["group1".to_string()],
            ..Default::default()
        };
        assert!(!filter.matches(&make_event(None)));
    }

    #[test]
    fn test_event_with_no_tags() {
        let event = Event {
            tags: vec![],
            ..make_event(None)
        };
        // Filter requiring h-tag should not match
        let filter = Filter {
            h_tags: vec!["group1".to_string()],
            ..Default::default()
        };
        assert!(!filter.matches(&event));

        // Filter with no tag requirements should match
        let empty = Filter::default();
        assert!(empty.matches(&event));
    }

    #[test]
    fn test_multiple_values_in_filter() {
        let filter = Filter {
            kinds: vec![1, 7, 9],
            authors: vec!["pubkey1".to_string(), "pubkey2".to_string()],
            ..Default::default()
        };
        assert!(filter.matches(&make_event(None))); // kind 1, pubkey1 -- both match
    }

    // #69 — a generic single-letter `#x` filter is parsed (not dropped) and
    // matched; the named #h/#p/#e/#d still route to their fields; junk ignored.
    #[test]
    fn test_generic_tag_filter_parsing() {
        let f: Filter = serde_json::from_value(serde_json::json!({
            "#t": ["nostr", "relay"],
            "#a": ["31683:pk:album"],
            "#h": ["group1"],
            "#xx": ["ignored"],
            "weird": ["ignored"]
        }))
        .unwrap();
        assert_eq!(f.h_tags, vec!["group1"]); // named field, not generic
        let mut names: Vec<&str> = f.generic_tags.iter().map(|(n, _)| n.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["a", "t"]); // only single-letter, excl h/p/e/d
    }

    #[test]
    fn test_generic_tag_filter_matches() {
        let event = Event {
            tags: vec![
                vec!["t".to_string(), "nostr".to_string()],
                vec!["a".to_string(), "31683:pk:album".to_string()],
            ],
            ..make_event(None)
        };
        let hit: Filter = serde_json::from_value(serde_json::json!({"#t": ["nostr"]})).unwrap();
        assert!(hit.matches(&event));
        let miss: Filter = serde_json::from_value(serde_json::json!({"#t": ["other"]})).unwrap();
        assert!(!miss.matches(&event));
        // an `#a` filter requiring a value the event lacks excludes it
        let miss2: Filter = serde_json::from_value(serde_json::json!({"#a": ["nope"]})).unwrap();
        assert!(!miss2.matches(&event));
    }
}
