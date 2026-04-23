import { text, bigint, timestamp, real } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const musicUploads = appSchema.table("music_uploads", {
  id: text("id").primaryKey(),
  pubkey: text("pubkey").notNull(),
  originalFilename: text("original_filename").notNull(),
  storagePath: text("storage_path").notNull(),
  url: text("url").notNull(),
  sha256: text("sha256").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: bigint("file_size", { mode: "number" }).notNull(),
  duration: bigint("duration", { mode: "number" }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  transcodeStatus: text("transcode_status").notNull().default("pending"),
  hlsMasterPath: text("hls_master_path"),
  loudnessI: real("loudness_i"),
  loudnessTp: real("loudness_tp"),
  transcodedAt: timestamp("transcoded_at", { withTimezone: true }),
  transcodeError: text("transcode_error"),
});
