//! Database backend abstraction for the relay (Decentralized Spaces M6).
//!
//! The production relay runs against Postgres; the embedded in-process relay
//! (shipped inside the Tauri client so a user can "host on my own machine")
//! runs against a single-file SQLite database. Both speak the same Nostr/NIP-29
//! protocol, so rather than duplicate the WebSocket handler we route every
//! database call through this `Db` enum.
//!
//! Design rules:
//!   - **The `Pg` arm is byte-for-byte today's code.** Each method simply calls
//!     the existing free function in `event_store` / `group_store` /
//!     `membership_source` / `nip50`. Threading `Db` through the handler later
//!     is therefore a mechanical `event_store::store_event(&pool, e)` →
//!     `db.store_event(e)` rename with zero behavioural change to production.
//!   - **The `Sqlite` arm encodes the genuine semantic divergence**, not just a
//!     SQL dialect swap: the embedded relay has no `app.space_members` / `app.spaces`
//!     schema, so membership is *relay-native only* (`sqlite_groups`, no UNION),
//!     and visibility gating is handled by the relay-native membership check in
//!     the handler rather than inline in `query_events`.
//!   - The `Sqlite` variant + every SQLite match arm is gated behind the
//!     `embedded` Cargo feature, so the production binary never links the SQLite
//!     driver and `match self { Db::Pg(p) => … }` stays exhaustive.

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;
use sqlx::PgPool;
use std::collections::HashSet;

#[cfg(feature = "embedded")]
use sqlx::SqlitePool;

use super::{event_store, group_store, membership_source};
use crate::protocol::nip50;

#[cfg(feature = "embedded")]
use super::{sqlite, sqlite_groups};

/// A relay storage backend: multi-tenant Postgres, or embedded single-file
/// SQLite.
#[derive(Clone)]
pub enum Db {
    Pg(PgPool),
    #[cfg(feature = "embedded")]
    Sqlite(SqlitePool),
}

impl Db {
    // ---- event store -----------------------------------------------------

    /// Store an event (handles replaceable/addressable supersession). Returns
    /// true if a new row was inserted.
    pub async fn store_event(&self, event: &Event) -> anyhow::Result<bool> {
        match self {
            Db::Pg(p) => event_store::store_event(p, event).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite::store_event(p, event).await,
        }
    }

    /// Query events matching a filter. `authed_pubkey` drives Postgres'
    /// inline `app.space_members` visibility gating; the embedded relay ignores
    /// it (membership gating is applied relay-native in the handler).
    pub async fn query_events(
        &self,
        filter: &Filter,
        authed_pubkey: Option<&str>,
    ) -> anyhow::Result<Vec<Event>> {
        match self {
            Db::Pg(p) => event_store::query_events(p, filter, authed_pubkey).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite::query_events(p, filter).await,
        }
    }

    /// Fetch a single event by id (author verification on deletion).
    pub async fn get_event_by_id(&self, event_id: &str) -> anyhow::Result<Option<Event>> {
        match self {
            Db::Pg(p) => event_store::get_event_by_id(p, event_id).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite::get_event_by_id(p, event_id).await,
        }
    }

    /// Delete an event by id.
    pub async fn delete_event(&self, event_id: &str) -> anyhow::Result<bool> {
        match self {
            Db::Pg(p) => event_store::delete_event(p, event_id).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite::delete_event(p, event_id).await,
        }
    }

    /// NIP-50 full-text search.
    pub async fn search_events(&self, query: &str, limit: i64) -> anyhow::Result<Vec<Event>> {
        match self {
            Db::Pg(p) => nip50::search_events(p, query, limit).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite::search_events(p, query, limit).await,
        }
    }

    // ---- NIP-29 group store ---------------------------------------------

    /// Create a NIP-29 group; the creator becomes admin + member.
    pub async fn create_group(
        &self,
        group_id: &str,
        name: &str,
        creator_pubkey: &str,
    ) -> anyhow::Result<()> {
        match self {
            Db::Pg(p) => group_store::create_group(p, group_id, name, creator_pubkey).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::create_group(p, group_id, name, creator_pubkey).await,
        }
    }

    /// Does a group with this id exist on the relay?
    pub async fn group_exists(&self, group_id: &str) -> anyhow::Result<bool> {
        match self {
            Db::Pg(p) => group_store::group_exists(p, group_id).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::group_exists(p, group_id).await,
        }
    }

    /// Is the pubkey an admin of the group?
    pub async fn is_admin(&self, group_id: &str, pubkey: &str) -> anyhow::Result<bool> {
        match self {
            Db::Pg(p) => group_store::is_admin(p, group_id, pubkey).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::is_admin(p, group_id, pubkey).await,
        }
    }

    /// Relay-native membership check (`relay.group_members` only — no UNION).
    /// Used by NIP-29 op handlers (add/remove/edit) where the authority is the
    /// relay's own group table.
    pub async fn group_has_member(&self, group_id: &str, pubkey: &str) -> anyhow::Result<bool> {
        match self {
            Db::Pg(p) => group_store::is_member(p, group_id, pubkey).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::is_member(p, group_id, pubkey).await,
        }
    }

    /// Add a member to a group.
    pub async fn add_member(&self, group_id: &str, pubkey: &str) -> anyhow::Result<()> {
        match self {
            Db::Pg(p) => group_store::add_member(p, group_id, pubkey).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::add_member(p, group_id, pubkey).await,
        }
    }

    /// Remove a member (and any roles they held).
    pub async fn remove_member(&self, group_id: &str, pubkey: &str) -> anyhow::Result<()> {
        match self {
            Db::Pg(p) => group_store::remove_member(p, group_id, pubkey).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::remove_member(p, group_id, pubkey).await,
        }
    }

    /// Do any of these group ids belong to a private group? (drives the
    /// NIP-42 `auth-required` CLOSED for anonymous REQs.)
    pub async fn any_private(&self, group_ids: &[String]) -> anyhow::Result<bool> {
        match self {
            Db::Pg(p) => group_store::any_private(p, group_ids).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::any_private(p, group_ids).await,
        }
    }

    /// All members of a group.
    pub async fn get_members(&self, group_id: &str) -> anyhow::Result<Vec<String>> {
        match self {
            Db::Pg(p) => group_store::get_members(p, group_id).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::get_members(p, group_id).await,
        }
    }

    /// Admin pubkeys of a group (for the 39001 event).
    pub async fn get_group_admins(&self, group_id: &str) -> anyhow::Result<Vec<String>> {
        match self {
            Db::Pg(p) => group_store::get_admins(p, group_id).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::get_admins(p, group_id).await,
        }
    }

    /// Group metadata (name, picture, about, is_private, is_closed) for the
    /// 39000 event. `None` if the group doesn't exist.
    pub async fn get_group_metadata(
        &self,
        group_id: &str,
    ) -> anyhow::Result<Option<(String, Option<String>, Option<String>, bool, bool)>> {
        match self {
            Db::Pg(p) => group_store::get_metadata(p, group_id).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::get_metadata(p, group_id).await,
        }
    }

    /// Is the group closed (join requests ignored)? `None` if not found.
    pub async fn group_is_closed(&self, group_id: &str) -> anyhow::Result<Option<bool>> {
        match self {
            Db::Pg(p) => group_store::is_closed(p, group_id).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::is_closed(p, group_id).await,
        }
    }

    /// Set the private/closed access flags (9007 create-time policy markers).
    pub async fn set_group_flags(
        &self,
        group_id: &str,
        is_private: bool,
        is_closed: bool,
    ) -> anyhow::Result<()> {
        match self {
            Db::Pg(p) => group_store::set_flags(p, group_id, is_private, is_closed).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::set_flags(p, group_id, is_private, is_closed).await,
        }
    }

    /// COALESCE-update group metadata (9002 edit; only `Some` fields change).
    pub async fn edit_group_metadata(
        &self,
        group_id: &str,
        name: Option<&str>,
        picture: Option<&str>,
        about: Option<&str>,
    ) -> anyhow::Result<()> {
        match self {
            Db::Pg(p) => group_store::edit_metadata(p, group_id, name, picture, about).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::set_metadata(p, group_id, name, picture, about).await,
        }
    }

    /// Delete a group (9008).
    pub async fn delete_group(&self, group_id: &str) -> anyhow::Result<()> {
        match self {
            Db::Pg(p) => group_store::delete_group(p, group_id).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::delete_group(p, group_id).await,
        }
    }

    /// SECURITY: does a backend-authoritative space already own this id? (9007
    /// collision guard). The embedded relay has no `app.*` → always `false`.
    pub async fn platform_space_exists(&self, group_id: &str) -> anyhow::Result<bool> {
        match self {
            Db::Pg(p) => group_store::platform_space_exists(p, group_id).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(_) => Ok(false),
        }
    }

    // ---- addressable deletion (metadata replace + NIP-09) ----------------

    /// Unconditionally delete the relay's own addressable event (39000-2 replace).
    pub async fn replace_addressable(
        &self,
        kind: i32,
        pubkey: &str,
        d_tag: &str,
    ) -> anyhow::Result<()> {
        match self {
            Db::Pg(p) => event_store::replace_addressable(p, kind, pubkey, d_tag).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite::replace_addressable(p, kind, pubkey, d_tag).await,
        }
    }

    /// NIP-09 `a`-tag delete (only if created at/before `created_at`). Rows removed.
    pub async fn delete_addressable_upto(
        &self,
        kind: i32,
        pubkey: &str,
        d_tag: &str,
        created_at: i64,
    ) -> anyhow::Result<u64> {
        match self {
            Db::Pg(p) => event_store::delete_addressable_upto(p, kind, pubkey, d_tag, created_at).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite::delete_addressable_upto(p, kind, pubkey, d_tag, created_at).await,
        }
    }

    // ---- unified membership (broadcast cache + read gate) ----------------

    /// Membership for read-gating / broadcast visibility. **This is where the
    /// two backends genuinely diverge**: Postgres UNIONs
    /// `app.space_members ∪ relay.group_members` (preserving platform + A-lite
    /// behaviour); the embedded relay is relay-native only.
    pub async fn is_member(&self, group_id: &str, pubkey: &str) -> anyhow::Result<bool> {
        match self {
            Db::Pg(p) => membership_source::is_member(p, group_id, pubkey).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::is_member(p, group_id, pubkey).await,
        }
    }

    /// The set of group ids a pubkey belongs to (populates the per-connection
    /// broadcast-visibility cache on AUTH). UNION on Postgres, relay-native on
    /// the embedded relay.
    pub async fn members_of(&self, pubkey: &str) -> anyhow::Result<HashSet<String>> {
        match self {
            Db::Pg(p) => membership_source::members_of(p, pubkey).await,
            #[cfg(feature = "embedded")]
            Db::Sqlite(p) => sqlite_groups::members_of(p, pubkey).await,
        }
    }
}
