use std::collections::HashMap;

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;

/// Maximum number of concurrent subscriptions per connection.
/// Sized to accommodate users in many spaces (one bg chat sub per joined space)
/// plus a handful of priority subs. Mirrored in the NIP-11 `max_subscriptions`
/// advertised by `server.rs`.
const MAX_SUBSCRIPTIONS: usize = 100;

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

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.subscriptions.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_filter() -> Filter {
        Filter::default()
    }

    /// Cap behavior: accepts exactly MAX_SUBSCRIPTIONS subs.
    /// Regression guard for the original 20-sub bug that left users with many
    /// joined spaces unable to open new channel subscriptions.
    #[test]
    fn accepts_up_to_max_subscriptions() {
        let mut subs = SubscriptionManager::new();
        for i in 0..MAX_SUBSCRIPTIONS {
            assert!(
                subs.add(format!("sub_{i}"), empty_filter()).is_ok(),
                "sub {i} should be accepted (under cap)"
            );
        }
        assert_eq!(subs.len(), MAX_SUBSCRIPTIONS);
    }

    /// Cap behavior: the (MAX+1)th distinct sub is rejected with the
    /// well-known error string the client recognizes.
    #[test]
    fn rejects_overflow_with_too_many_subscriptions_error() {
        let mut subs = SubscriptionManager::new();
        for i in 0..MAX_SUBSCRIPTIONS {
            subs.add(format!("sub_{i}"), empty_filter()).unwrap();
        }
        let result = subs.add("sub_overflow".to_string(), empty_filter());
        assert_eq!(result, Err("too many subscriptions"));
        assert_eq!(subs.len(), MAX_SUBSCRIPTIONS);
    }

    /// Closing a sub frees a slot for a new one.
    #[test]
    fn close_frees_slot_for_new_subscription() {
        let mut subs = SubscriptionManager::new();
        for i in 0..MAX_SUBSCRIPTIONS {
            subs.add(format!("sub_{i}"), empty_filter()).unwrap();
        }
        // Cap hit
        assert!(subs.add("sub_extra".to_string(), empty_filter()).is_err());

        // Close one, retry
        subs.remove("sub_0");
        assert_eq!(subs.len(), MAX_SUBSCRIPTIONS - 1);
        assert!(subs.add("sub_extra".to_string(), empty_filter()).is_ok());
        assert_eq!(subs.len(), MAX_SUBSCRIPTIONS);
    }

    /// Re-adding an existing sub_id is an upsert (replaces the filter)
    /// and does NOT count against the cap. Critical because clients re-send
    /// the same sub_id on reconnect via resubscribe().
    #[test]
    fn reusing_sub_id_does_not_consume_cap_slot() {
        let mut subs = SubscriptionManager::new();
        for i in 0..MAX_SUBSCRIPTIONS {
            subs.add(format!("sub_{i}"), empty_filter()).unwrap();
        }
        // Re-add an existing id with a different filter — must succeed even at cap
        let mut updated = Filter::default();
        updated.kinds = vec![9];
        assert!(subs.add("sub_0".to_string(), updated).is_ok());
        assert_eq!(subs.len(), MAX_SUBSCRIPTIONS);
    }
}
