import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { join, extname } from "path";
import { Readable } from "stream";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicUploads } from "../db/schema/music.js";
import { nanoid } from "../lib/id.js";
import { config } from "../config.js";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads", "music");
const COVER_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads", "covers");
const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_COVER_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/flac",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/mp4",
  "audio/webm",
]);

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export const musicService = {
  async uploadAudio(
    file: { filename: string; mimetype: string; file: NodeJS.ReadableStream },
    pubkey: string,
    clientDuration?: number,
  ) {
    if (!ALLOWED_AUDIO_TYPES.has(file.mimetype)) {
      throw new Error(`Invalid audio type: ${file.mimetype}`);
    }

    await ensureDir(UPLOAD_DIR);
    const id = nanoid(16);
    const ext = extname(file.filename) || ".mp3";
    const storedName = `${id}${ext}`;
    const storagePath = join(UPLOAD_DIR, storedName);

    // Write file to disk
    let size = 0;
    const writeStream = createWriteStream(storagePath);
    const readable = file.file instanceof Readable ? file.file : Readable.from(file.file as AsyncIterable<Buffer>);

    for await (const chunk of readable) {
      size += (chunk as Buffer).length;
      if (size > MAX_AUDIO_SIZE) {
        writeStream.destroy();
        throw new Error("File too large (max 100MB)");
      }
      writeStream.write(chunk);
    }
    writeStream.end();

    const sha256 = await computeSha256(storagePath);
    const url = `${config.publicUrl}/uploads/music/${storedName}`;

    await db.insert(musicUploads).values({
      id,
      pubkey,
      originalFilename: file.filename,
      storagePath,
      url,
      sha256,
      mimeType: file.mimetype,
      fileSize: size,
      duration: clientDuration ?? null,
    });

    return {
      url,
      sha256,
      size,
      mimeType: file.mimetype,
      duration: clientDuration,
    };
  },

  async uploadCover(
    file: { filename: string; mimetype: string; file: NodeJS.ReadableStream },
    _pubkey: string,
  ) {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw new Error(`Invalid image type: ${file.mimetype}`);
    }

    await ensureDir(COVER_DIR);
    const id = nanoid(16);
    const ext = extname(file.filename) || ".jpg";
    const storedName = `${id}${ext}`;
    const storagePath = join(COVER_DIR, storedName);

    let size = 0;
    const writeStream = createWriteStream(storagePath);
    const readable = file.file instanceof Readable ? file.file : Readable.from(file.file as AsyncIterable<Buffer>);

    for await (const chunk of readable) {
      size += (chunk as Buffer).length;
      if (size > MAX_COVER_SIZE) {
        writeStream.destroy();
        throw new Error("Image too large (max 10MB)");
      }
      writeStream.write(chunk);
    }
    writeStream.end();

    return { url: `${config.publicUrl}/uploads/covers/${storedName}` };
  },

  async listUploads(
    pubkey: string,
    opts?: { limit?: number; offset?: number },
  ) {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const rows = await db
      .select()
      .from(musicUploads)
      .where(eq(musicUploads.pubkey, pubkey))
      .orderBy(desc(musicUploads.createdAt))
      .limit(limit)
      .offset(offset);

    return rows;
  },
};
