pub mod backend;
pub mod event_store;
pub mod group_store;
pub mod membership_source;
pub mod pool;
pub mod space_membership;

pub use backend::Db;

/// SQLite-backed store for the embedded in-process relay (M6).
#[cfg(feature = "embedded")]
pub mod sqlite;

/// SQLite-backed NIP-29 group store for the embedded in-process relay (M6).
#[cfg(feature = "embedded")]
pub mod sqlite_groups;
