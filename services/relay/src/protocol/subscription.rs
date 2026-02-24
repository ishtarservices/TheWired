use std::collections::HashMap;

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;

/// Manages subscriptions for a single WebSocket connection
pub struct SubscriptionManager {
    subscriptions: HashMap<String, Filter>,
}

impl SubscriptionManager {
    pub fn new() -> Self {
        Self {
            subscriptions: HashMap::new(),
        }
    }

    pub fn add(&mut self, id: String, filter: Filter) {
        self.subscriptions.insert(id, filter);
    }

    pub fn remove(&mut self, id: &str) {
        self.subscriptions.remove(id);
    }

    /// Check which subscriptions match a given event
    pub fn matching_subs(&self, event: &Event) -> Vec<String> {
        self.subscriptions
            .iter()
            .filter(|(_, filter)| filter.matches(event))
            .map(|(id, _)| id.clone())
            .collect()
    }
}
