use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub pubkey: String,
    pub created_at: i64,
    pub kind: i32,
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

impl Event {
    /// Get the first value of a tag by name
    pub fn get_tag_value(&self, name: &str) -> Option<String> {
        self.tags
            .iter()
            .find(|t| t.first().map(|s| s.as_str()) == Some(name))
            .and_then(|t| t.get(1).cloned())
    }

    /// Every value (`tag[1]`) of the tags named `name`, in event order. An
    /// event may carry several `h` tags (multi-space music); this returns all
    /// of them where `get_tag_value` returns only the first.
    pub fn get_tag_values(&self, name: &str) -> Vec<String> {
        self.tags
            .iter()
            .filter(|t| t.first().map(String::as_str) == Some(name))
            .filter_map(|t| t.get(1).cloned())
            .collect()
    }

    /// Compute the canonical serialization for hashing (NIP-01)
    pub fn serialize_for_id(&self) -> String {
        let tags_value = serde_json::to_value(&self.tags).unwrap_or_default();
        serde_json::to_string(&serde_json::json!([
            0,
            &self.pubkey,
            self.created_at,
            self.kind,
            tags_value,
            &self.content
        ]))
        .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event() -> Event {
        Event {
            id: "abc123".to_string(),
            pubkey: "pubkey123".to_string(),
            created_at: 1000000,
            kind: 1,
            tags: vec![
                vec!["h".to_string(), "group1".to_string()],
                vec!["p".to_string(), "target_pk".to_string()],
            ],
            content: "hello world".to_string(),
            sig: "sig123".to_string(),
        }
    }

    #[test]
    fn test_get_tag_value_found() {
        let event = make_event();
        assert_eq!(event.get_tag_value("h"), Some("group1".to_string()));
        assert_eq!(event.get_tag_value("p"), Some("target_pk".to_string()));
    }

    #[test]
    fn test_get_tag_value_missing() {
        let event = make_event();
        assert_eq!(event.get_tag_value("e"), None);
        assert_eq!(event.get_tag_value("d"), None);
    }

    #[test]
    fn test_get_tag_value_empty_tags() {
        let event = Event {
            tags: vec![],
            ..make_event()
        };
        assert_eq!(event.get_tag_value("h"), None);
    }

    #[test]
    fn test_get_tag_values_multiple_in_order() {
        let event = Event {
            tags: vec![
                vec!["h".to_string(), "space_a".to_string()],
                vec!["p".to_string(), "pk".to_string()],
                vec!["h".to_string(), "space_b".to_string()],
                vec!["h".to_string()], // malformed: no value, skipped
            ],
            ..make_event()
        };
        assert_eq!(
            event.get_tag_values("h"),
            vec!["space_a".to_string(), "space_b".to_string()]
        );
        // First value agrees with get_tag_value.
        assert_eq!(event.get_tag_values("h").first().cloned(), event.get_tag_value("h"));
    }

    #[test]
    fn test_get_tag_values_missing_is_empty() {
        let event = make_event();
        assert!(event.get_tag_values("e").is_empty());
        let empty = Event { tags: vec![], ..make_event() };
        assert!(empty.get_tag_values("h").is_empty());
    }

    #[test]
    fn test_serialize_for_id_format() {
        let event = Event {
            id: "test".to_string(),
            pubkey: "pk".to_string(),
            created_at: 12345,
            kind: 1,
            tags: vec![vec!["p".to_string(), "abc".to_string()]],
            content: "hello".to_string(),
            sig: "sig".to_string(),
        };
        let serialized = event.serialize_for_id();
        // NIP-01: [0, pubkey, created_at, kind, tags, content]
        let parsed: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        let arr = parsed.as_array().unwrap();
        assert_eq!(arr[0], 0);
        assert_eq!(arr[1], "pk");
        assert_eq!(arr[2], 12345);
        assert_eq!(arr[3], 1);
        assert_eq!(arr[4], serde_json::json!([["p", "abc"]]));
        assert_eq!(arr[5], "hello");
    }

    #[test]
    fn test_serialize_for_id_empty_tags() {
        let event = Event {
            tags: vec![],
            ..make_event()
        };
        let serialized = event.serialize_for_id();
        let parsed: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(parsed[4], serde_json::json!([]));
    }

    #[test]
    fn test_serialize_for_id_unicode_content() {
        let event = Event {
            content: "hello 🌍 世界".to_string(),
            ..make_event()
        };
        let serialized = event.serialize_for_id();
        let parsed: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(parsed[5], "hello 🌍 世界");
    }
}
