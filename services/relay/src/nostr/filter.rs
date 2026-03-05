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
