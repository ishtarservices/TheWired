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
