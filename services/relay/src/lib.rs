//! Library entry point for the relay crate.
//!
//! The relay ships as a binary (`main.rs`), but we also expose its modules as
//! a library so integration tests in `tests/` can drive `handle_message`,
//! `event_store`, etc. directly without standing up a WebSocket server.
//!
//! Tests that only need to talk to a *running* relay over the wire (like
//! `tests/stress_subs.rs`) don't need this — they use `tokio_tungstenite`
//! against `localhost:7777`. Tests that exercise internal handlers
//! (`tests/membership_gate.rs`) import from this crate.

pub mod config;
pub mod connection;
pub mod db;
pub mod music;
pub mod nostr;
pub mod protocol;
pub mod relay_identity;
pub mod server;
