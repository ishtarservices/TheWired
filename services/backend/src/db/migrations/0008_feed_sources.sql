-- Feed sources: curated pubkeys whose content appears in feed-mode spaces
CREATE TABLE IF NOT EXISTS "app"."space_feed_sources" (
  "space_id" text NOT NULL REFERENCES "app"."spaces"("id") ON DELETE CASCADE,
  "pubkey" text NOT NULL,
  "added_at" timestamp DEFAULT now(),
  PRIMARY KEY ("space_id", "pubkey")
);
