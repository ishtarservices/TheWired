use std::collections::HashMap;

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;

/// Maximum number of concurrent subscriptions per connection
const MAX_SUBSCRIPTIONS: usize = 20;

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

    pub fn add(&mut self, id: String, filter: Filter) -> Result<(), &'static str> {
        if !self.subscriptions.contains_key(&id) && self.subscriptions.len() >= MAX_SUBSCRIPTIONS {
            return Err("too many subscriptions");
        }
        self.subscriptions.insert(id, filter);
        Ok(())
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
