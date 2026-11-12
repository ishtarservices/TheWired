//! Keeps the three places an app command is declared in step.
//!
//! A built app serves its UI from an origin Tauri treats as remote, where a
//! command with no granted permission is refused (see `app_commands.rs`).
//! `tauri dev` is a local origin, so these lists drifting would otherwise only
//! show up as a dead command in a release build.

use std::collections::BTreeSet;

include!("app_commands.rs");

/// Command names registered in `generate_handler!` in `lib.rs`.
fn registered_commands() -> Vec<String> {
    let src = include_str!("lib.rs");
    let start = src
        .find("generate_handler![")
        .expect("lib.rs registers commands with generate_handler!");
    let block = &src[start..];
    let end = block.find("])").expect("generate_handler! block is closed");
    block[..end]
        .lines()
        .filter_map(|line| line.trim().trim_end_matches(',').rsplit_once("::"))
        .map(|(_, name)| name.to_string())
        .collect()
}

fn capability(file: &str) -> serde_json::Value {
    serde_json::from_str(file).expect("capability file is valid JSON")
}

fn strings(value: &serde_json::Value) -> Vec<String> {
    value
        .as_array()
        .expect("expected a JSON array")
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}

#[test]
fn every_registered_command_is_declared_for_the_acl() {
    let registered = registered_commands();
    assert!(!registered.is_empty(), "no commands parsed from lib.rs");

    let registered_set: BTreeSet<&str> = registered.iter().map(String::as_str).collect();
    let declared_set: BTreeSet<&str> = APP_COMMANDS.iter().copied().collect();

    assert_eq!(registered.len(), registered_set.len(), "duplicate in generate_handler!");
    assert_eq!(APP_COMMANDS.len(), declared_set.len(), "duplicate in APP_COMMANDS");
    assert_eq!(
        registered_set, declared_set,
        "generate_handler! in lib.rs and APP_COMMANDS in app_commands.rs must list the same commands"
    );
}

#[test]
fn every_declared_command_is_granted_to_the_main_window() {
    let cap = capability(include_str!("../capabilities/app-commands.json"));
    let granted: BTreeSet<String> = strings(&cap["permissions"]).into_iter().collect();
    let expected: BTreeSet<String> = APP_COMMANDS
        .iter()
        .map(|c| format!("allow-{}", c.replace('_', "-")))
        .collect();

    assert_eq!(
        granted, expected,
        "capabilities/app-commands.json must grant exactly one allow-<command> per APP_COMMANDS entry"
    );
    assert_eq!(strings(&cap["windows"]), ["main"]);
}

#[test]
fn commands_are_granted_on_the_dev_origin_and_only_the_production_origin() {
    let cap = capability(include_str!("../capabilities/app-commands.json"));
    let plugins = capability(include_str!("../capabilities/localhost.json"));

    // `local` defaults to true; an explicit false would break `tauri dev`.
    assert_ne!(cap["local"], serde_json::Value::Bool(false));

    let urls = strings(&cap["remote"]["urls"]);
    assert_eq!(urls.len(), 1, "exactly one remote origin may reach the app commands");
    assert!(!urls[0].contains('*'), "the remote origin must be exact, no wildcards");
    assert_eq!(
        urls,
        strings(&plugins["remote"]["urls"]),
        "app commands and plugin commands must be granted to the same production origin"
    );
}
