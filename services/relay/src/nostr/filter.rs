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
        if !self.h_tags.is_empty() {
            let event_h = event.get_tag_value("h");
            if !event_h.map(|h| self.h_tags.contains(&h)).unwrap_or(false) {
                return false;
            }
        }
        true
    }
}
