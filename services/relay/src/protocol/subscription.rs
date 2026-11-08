use std::collections::HashMap;

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;

/// Maximum number of concurrent subscriptions per connection.
/// Sized to accommodate users in many spaces (one bg chat sub per joined space)
/// plus a handful of priority subs. Mirrored in the NIP-11 `max_subscriptions`
/// advertised by `server.rs`.
const MAX_SUBSCRIPTIONS: usize = 100;

/// Concurrent NIP-77 reconciliation sessions per connection.
pub const MAX_NEG_SESSIONS: usize = 4;

/// Manages subscriptions for a single WebSocket connection. Each subscription
/// holds one or more filters (NIP-01) — an event matches if it matches ANY.
/// Also owns the connection's NIP-77 negentropy sessions (a sealed storage
/// vector per NEG-OPEN id) so the handler signature stays unchanged.
pub struct SubscriptionManager {
    subscriptions: HashMap<String, Vec<Filter>>,
    neg_sessions: HashMap<String, negentropy::NegentropyStorageVector>,
}

impl Default for SubscriptionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SubscriptionManager {
    pub fn new() -> Self {
        Self {
            subscriptions: HashMap::new(),
            neg_sessions: HashMap::new(),
        }
    }

    /// Register (or replace) a negentropy session's sealed storage.
    pub fn neg_open(
        &mut self,
        id: String,
        storage: negentropy::NegentropyStorageVector,
    ) -> Result<(), &'static str> {
        if !self.neg_sessions.contains_key(&id) && self.neg_sessions.len() >= MAX_NEG_SESSIONS {
            return Err("too many negentropy sessions");
        }
        self.neg_sessions.insert(id, storage);
        Ok(())
    }

    pub fn neg_get(&self, id: &str) -> Option<&negentropy::NegentropyStorageVector> {
        self.neg_sessions.get(id)
    }

    pub fn neg_close(&mut self, id: &str) {
        self.neg_sessions.remove(id);
    }

    pub fn add(&mut self, id: String, filters: Vec<Filter>) -> Result<(), &'static str> {
        if !self.subscriptions.contains_key(&id) && self.subscriptions.len() >= MAX_SUBSCRIPTIONS {
            return Err("too many subscriptions");
        }
        self.subscriptions.insert(id, filters);
        Ok(())
    }

    pub fn remove(&mut self, id: &str) {
        self.subscriptions.remove(id);
    }

    /// Check which subscriptions match a given event (any filter matches).
    pub fn matching_subs(&self, event: &Event) -> Vec<String> {
        self.matching_subs_where(event, |_| true)
    }

    /// Like [`matching_subs`](Self::matching_subs), counting only the filters
    /// `eligible` admits — the firehose policy drops a subscription's
    /// firehose filters for an author outside the community while its
    /// targeted filters (by author, mention, thread…) still match.
    pub fn matching_subs_where(&self, event: &Event, eligible: impl Fn(&Filter) -> bool) -> Vec<String> {
        self.subscriptions
            .iter()
            .filter(|(_, filters)| filters.iter().any(|f| eligible(f) && f.matches(event)))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Every open subscription with its filters — cloned, so a caller can
    /// release the lock before running stored queries (lag resync).
    pub fn snapshot(&self) -> Vec<(String, Vec<Filter>)> {
        self.subscriptions
            .iter()
            .map(|(id, filters)| (id.clone(), filters.clone()))
            .collect()
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.subscriptions.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.subscriptions.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_filter() -> Vec<Filter> {
        vec![Filter::default()]
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
    // #19 — a single subscription with MULTIPLE filters matches an event that
    // satisfies ANY of them.
    #[test]
    fn multi_filter_subscription_matches_any() {
        use crate::nostr::event::Event;
        let mut subs = SubscriptionManager::new();
        let f1 = Filter { kinds: vec![1], ..Default::default() };
        let f2 = Filter { kinds: vec![9], ..Default::default() };
        subs.add("s".to_string(), vec![f1, f2]).unwrap();

        let mk = |kind: i32| Event {
            id: format!("e{kind}"), pubkey: "a".into(), created_at: 1, kind,
            tags: vec![], content: "".into(), sig: "s".into(),
        };
        assert_eq!(subs.matching_subs(&mk(1)), vec!["s"]); // matches f1
        assert_eq!(subs.matching_subs(&mk(9)), vec!["s"]); // matches f2
        assert!(subs.matching_subs(&mk(7)).is_empty()); // matches neither
    }

    /// `matching_subs_where` counts only eligible filters: a subscription whose
    /// only matching filter is ruled out is not matched, one with another
    /// matching filter still is.
    #[test]
    fn matching_subs_where_ignores_ineligible_filters() {
        use crate::nostr::event::Event;
        let mut subs = SubscriptionManager::new();
        let fire = Filter { kinds: vec![1], ..Default::default() };
        let by_author = Filter { authors: vec!["a".into()], ..Default::default() };
        subs.add("fire".to_string(), vec![fire.clone()]).unwrap();
        subs.add("mixed".to_string(), vec![fire, by_author.clone()]).unwrap();
        subs.add("author".to_string(), vec![by_author]).unwrap();
        let ev = Event {
            id: "e".into(), pubkey: "a".into(), created_at: 1, kind: 1,
            tags: vec![], content: "".into(), sig: "s".into(),
        };
        let mut all = subs.matching_subs(&ev);
        all.sort();
        assert_eq!(all, vec!["author", "fire", "mixed"]);
        let mut targeted = subs.matching_subs_where(&ev, |f| f.kinds.is_empty());
        targeted.sort();
        assert_eq!(targeted, vec!["author", "mixed"]);
        assert!(subs.matching_subs_where(&ev, |_| false).is_empty());
    }

    #[test]
    fn reusing_sub_id_does_not_consume_cap_slot() {
        let mut subs = SubscriptionManager::new();
        for i in 0..MAX_SUBSCRIPTIONS {
            subs.add(format!("sub_{i}"), empty_filter()).unwrap();
        }
        // Re-add an existing id with a different filter — must succeed even at cap
        let updated = Filter { kinds: vec![9], ..Default::default() };
        assert!(subs.add("sub_0".to_string(), vec![updated]).is_ok());
        assert_eq!(subs.len(), MAX_SUBSCRIPTIONS);
    }
}
