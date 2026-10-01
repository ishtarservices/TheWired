//! Operator moderation on the write path (App Store 1.2).
//!
//! The backend's admin actions write two tables the relay consults before it
//! stores anything (migration 006):
//!   - `relay.tombstones` — event ids the operator removed (`remove_event` /
//!     `remove_music`). A removed event must not come back by being
//!     re-published, by its author or by anyone holding a copy.
//!   - `relay.suspended_pubkeys` — accounts the operator suspended. The relay
//!     refuses their writes, except a NIP-09 deletion (kind 5) or a NIP-62
//!     request to vanish (kind 62): a suspended account may still take its own
//!     content down.
//! A lifted suspension / restored tombstone keeps its row with `lifted_at` /
//! `restored_at` set, so both actions stay reversible and on record.
//!
//! Pure decision here; the lookup lives in `db::moderation`.

/// Kinds a suspended account may still publish: they only remove its content.
pub fn allowed_while_suspended(kind: i32) -> bool {
    matches!(kind, 5 | 62)
}

/// The `OK false` reason for a write the operator has blocked, or None.
pub fn block_reason(kind: i32, tombstoned: bool, suspended: bool) -> Option<&'static str> {
    if tombstoned {
        return Some("blocked: this event was removed by the relay operator");
    }
    if suspended && !allowed_while_suspended(kind) {
        return Some("blocked: this account is suspended on this relay");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tombstoned_events_are_refused_whatever_the_author() {
        assert!(block_reason(1, true, false).is_some());
        assert!(block_reason(5, true, true).is_some());
    }

    #[test]
    fn suspended_accounts_may_only_remove_their_own_content() {
        assert!(block_reason(1, false, true).is_some());
        assert!(block_reason(1984, false, true).is_some());
        assert!(block_reason(31683, false, true).is_some());
        assert_eq!(block_reason(5, false, true), None);
        assert_eq!(block_reason(62, false, true), None);
    }

    #[test]
    fn everyone_else_passes() {
        assert_eq!(block_reason(1, false, false), None);
    }
}
