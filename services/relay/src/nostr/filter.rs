use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
pub struct Filter {
    #[serde(default)]
    pub ids: Vec<String>,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub kinds: Vec<i32>,
    pub since: Option<i64>,
    pub until: Option<i64>,
    pub limit: Option<i64>,
    pub search: Option<String>,
    #[serde(rename = "#h", default)]
    pub h_tags: Vec<String>,
    #[serde(rename = "#p", default)]
    pub p_tags: Vec<String>,
    #[serde(rename = "#e", default)]
    pub e_tags: Vec<String>,
    #[serde(rename = "#d", default)]
    pub d_tags: Vec<String>,
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
}
