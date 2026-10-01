/**
 * The relay-owned tables the backend writes, as one SQL script for the global
 * test setup (test/setup.ts runs it on its own postgres client, so it works in
 * files that mock src/db/connection). Pure — no db import.
 *
 *  - relay.events with the tag columns the backend queries (mirrors
 *    relayEvents.ensureRelayEventsTable);
 *  - the NIP-29 membership mirror (relay migration 001's group tables, minimal);
 *  - operator moderation (relay migration 006) applied VERBATIM, so the admin
 *    actions are tested against the relay's real DDL.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function relayTestSchemaSql(): string {
  const moderation = readFileSync(resolve(process.cwd(), "../relay/migrations/006_moderation.sql"), "utf-8");
  return `
    CREATE SCHEMA IF NOT EXISTS relay;
    CREATE TABLE IF NOT EXISTS relay.events (
      id TEXT PRIMARY KEY, pubkey TEXT NOT NULL, created_at BIGINT NOT NULL,
      kind INTEGER NOT NULL, tags JSONB NOT NULL DEFAULT '[]', content TEXT NOT NULL DEFAULT '',
      sig TEXT NOT NULL, d_tag TEXT, h_tag TEXT, h_tags TEXT[], visibility TEXT
    );
    ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS visibility TEXT;
    ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS h_tag TEXT;
    ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS h_tags TEXT[];
    ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS d_tag TEXT;
    ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS expires_at BIGINT;
    ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS self_published BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS p_tags TEXT[];
    ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS e_tags TEXT[];
    CREATE TABLE IF NOT EXISTS relay.groups (
      group_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS relay.group_members (
      group_id TEXT NOT NULL REFERENCES relay.groups(group_id) ON DELETE CASCADE,
      pubkey TEXT NOT NULL, joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, pubkey)
    );
    CREATE TABLE IF NOT EXISTS relay.group_roles (
      group_id TEXT NOT NULL REFERENCES relay.groups(group_id) ON DELETE CASCADE,
      pubkey TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, pubkey, role)
    );
    ${moderation}
  `;
}
