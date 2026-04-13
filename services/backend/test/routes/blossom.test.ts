import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import type { FastifyInstance } from "fastify";
import { finalizeEvent } from "nostr-tools";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, type TestUser } from "../helpers/testUsers.js";

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

// ---- Helpers ----

/** Build a base64-encoded kind 24242 Authorization header for Blossom endpoints. */
function buildBlossomAuth(
  user: TestUser,
  action: "upload" | "delete" | "list" | "get",
  opts?: { sha256?: string; expired?: boolean; wrongKind?: number },
): string {
  const created_at = Math.floor(Date.now() / 1000);
  const expiration = opts?.expired
    ? String(created_at - 60) // expired
    : String(created_at + 3600);

  const tags: string[][] = [
    ["t", action],
    ["expiration", expiration],
  ];
  if (opts?.sha256) tags.push(["x", opts.sha256]);

  const event = finalizeEvent(
    {
      kind: opts?.wrongKind ?? 24242,
      created_at,
      tags,
      content: `${action} blob`,
    },
    user.secretKey,
  );

  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

/** Create a deterministic test blob (content derived from a label). */
function makeTestBlob(label: string): { data: Buffer; sha256: string; mime: string } {
  const data = Buffer.from(`test-blob-content-${label}-${"x".repeat(100)}`);
  const sha256 = createHash("sha256").update(data).digest("hex");
  return { data, sha256, mime: "audio/mpeg" };
}

/** Upload a blob via PUT /upload and return the response body. */
async function uploadBlob(
  user: TestUser,
  blob: { data: Buffer; sha256: string; mime: string },
) {
  const auth = buildBlossomAuth(user, "upload", { sha256: blob.sha256 });
  const response = await server.inject({
    method: "PUT",
    url: "/upload",
    headers: {
      authorization: auth,
      "content-type": blob.mime,
      "x-sha-256": blob.sha256,
    },
    payload: blob.data,
  });
  return response;
}

// ---- Tests ----

describe("blossom routes", () => {
  // ==================== PUT /upload ====================

  describe("PUT /upload", () => {
    it("uploads a blob and returns a descriptor", async () => {
      const blob = makeTestBlob("upload-basic");
      const response = await uploadBlob(LUNA, blob);

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.sha256).toBe(blob.sha256);
      expect(body.size).toBe(blob.data.length);
      expect(body.type).toBe(blob.mime);
      expect(body.url).toContain(blob.sha256);
      expect(body.uploaded).toBeTypeOf("number");
    });

    it("deduplicates: uploading same content returns 200", async () => {
      const blob = makeTestBlob("upload-dedup");

      // First upload
      const first = await uploadBlob(LUNA, blob);
      expect(first.statusCode).toBe(201);

      // Same content, same user
      const second = await uploadBlob(LUNA, blob);
      expect(second.statusCode).toBe(200);
      expect(second.json().sha256).toBe(blob.sha256);
    });

    it("allows different users to own the same blob", async () => {
      const blob = makeTestBlob("upload-multi-owner");

      const first = await uploadBlob(LUNA, blob);
      expect(first.statusCode).toBe(201);

      const second = await uploadBlob(MARCUS, blob);
      expect(second.statusCode).toBe(200);
      expect(second.json().sha256).toBe(blob.sha256);
    });

    it("returns 401 without auth header", async () => {
      const blob = makeTestBlob("upload-noauth");
      const response = await server.inject({
        method: "PUT",
        url: "/upload",
        headers: { "content-type": blob.mime },
        payload: blob.data,
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns 401 with wrong kind (27235 instead of 24242)", async () => {
      const blob = makeTestBlob("upload-wrongkind");
      const auth = buildBlossomAuth(LUNA, "upload", {
        sha256: blob.sha256,
        wrongKind: 27235,
      });
      const response = await server.inject({
        method: "PUT",
        url: "/upload",
        headers: {
          authorization: auth,
          "content-type": blob.mime,
        },
        payload: blob.data,
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns 401 with expired auth token", async () => {
      const blob = makeTestBlob("upload-expired");
      const auth = buildBlossomAuth(LUNA, "upload", {
        sha256: blob.sha256,
        expired: true,
      });
      const response = await server.inject({
        method: "PUT",
        url: "/upload",
        headers: {
          authorization: auth,
          "content-type": blob.mime,
        },
        payload: blob.data,
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns 409 when X-SHA-256 header mismatches actual content", async () => {
      const blob = makeTestBlob("upload-mismatch");
      const fakeHash = "a".repeat(64);
      const auth = buildBlossomAuth(LUNA, "upload");
      const response = await server.inject({
        method: "PUT",
        url: "/upload",
        headers: {
          authorization: auth,
          "content-type": blob.mime,
          "x-sha-256": fakeHash,
        },
        payload: blob.data,
      });
      expect(response.statusCode).toBe(409);
    });
  });

  // ==================== GET /<sha256> ====================

  describe("GET /<sha256>", () => {
    it("retrieves an uploaded blob", async () => {
      const blob = makeTestBlob("get-basic");
      await uploadBlob(LUNA, blob);

      const response = await server.inject({
        method: "GET",
        url: `/${blob.sha256}.mp3`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("audio/mpeg");
      expect(response.headers["cache-control"]).toContain("immutable");
      expect(response.headers["etag"]).toBe(`"${blob.sha256}"`);
    });

    it("retrieves a blob without extension", async () => {
      const blob = makeTestBlob("get-noext");
      await uploadBlob(LUNA, blob);

      const response = await server.inject({
        method: "GET",
        url: `/${blob.sha256}`,
      });

      expect(response.statusCode).toBe(200);
    });

    it("returns 404 for nonexistent blob", async () => {
      const fakeHash = "b".repeat(64);
      const response = await server.inject({
        method: "GET",
        url: `/${fakeHash}.mp3`,
      });

      expect(response.statusCode).toBe(404);
    });

    it("falls through for non-sha256 paths", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/not-a-hash",
      });

      // Should 404 (callNotFound) since it doesn't match sha256 regex
      expect(response.statusCode).toBe(404);
    });
  });

  // ==================== HEAD /upload (preflight) ====================

  describe("HEAD /upload", () => {
    it("returns 204 when blob does not exist (upload OK)", async () => {
      const blob = makeTestBlob("preflight-new");
      const auth = buildBlossomAuth(LUNA, "upload");
      const response = await server.inject({
        method: "HEAD",
        url: "/upload",
        headers: {
          authorization: auth,
          "x-sha-256": blob.sha256,
          "x-content-length": String(blob.data.length),
        },
      });

      expect(response.statusCode).toBe(204);
    });

    it("returns 200 when blob already exists", async () => {
      const blob = makeTestBlob("preflight-exists");
      await uploadBlob(LUNA, blob);

      const auth = buildBlossomAuth(LUNA, "upload");
      const response = await server.inject({
        method: "HEAD",
        url: "/upload",
        headers: {
          authorization: auth,
          "x-sha-256": blob.sha256,
          "x-content-length": String(blob.data.length),
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("returns 400 for invalid X-SHA-256", async () => {
      const auth = buildBlossomAuth(LUNA, "upload");
      const response = await server.inject({
        method: "HEAD",
        url: "/upload",
        headers: {
          authorization: auth,
          "x-sha-256": "not-a-hash",
          "x-content-length": "1000",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 411 when X-Content-Length is missing", async () => {
      const blob = makeTestBlob("preflight-nolength");
      const auth = buildBlossomAuth(LUNA, "upload");
      const response = await server.inject({
        method: "HEAD",
        url: "/upload",
        headers: {
          authorization: auth,
          "x-sha-256": blob.sha256,
        },
      });

      expect(response.statusCode).toBe(411);
    });

    it("returns 401 without auth", async () => {
      const response = await server.inject({
        method: "HEAD",
        url: "/upload",
        headers: {
          "x-sha-256": "a".repeat(64),
          "x-content-length": "1000",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ==================== DELETE /<sha256> ====================

  describe("DELETE /<sha256>", () => {
    it("deletes a blob owned by the user", async () => {
      const blob = makeTestBlob("delete-basic");
      await uploadBlob(LUNA, blob);

      const auth = buildBlossomAuth(LUNA, "delete", { sha256: blob.sha256 });
      const response = await server.inject({
        method: "DELETE",
        url: `/${blob.sha256}`,
        headers: { authorization: auth },
      });

      expect(response.statusCode).toBe(204);

      // Verify it's gone
      const getResp = await server.inject({
        method: "GET",
        url: `/${blob.sha256}`,
      });
      expect(getResp.statusCode).toBe(404);
    });

    it("keeps blob on disk when another owner remains", async () => {
      const blob = makeTestBlob("delete-multi-owner");
      await uploadBlob(LUNA, blob);
      await uploadBlob(MARCUS, blob);

      // Luna deletes her ownership
      const auth = buildBlossomAuth(LUNA, "delete", { sha256: blob.sha256 });
      const response = await server.inject({
        method: "DELETE",
        url: `/${blob.sha256}`,
        headers: { authorization: auth },
      });
      expect(response.statusCode).toBe(204);

      // Blob should still be accessible (Marcus still owns it)
      const getResp = await server.inject({
        method: "GET",
        url: `/${blob.sha256}.mp3`,
      });
      expect(getResp.statusCode).toBe(200);
    });

    it("returns 404 for blob not owned by user", async () => {
      const blob = makeTestBlob("delete-notowner");
      await uploadBlob(LUNA, blob);

      // Marcus tries to delete Luna's blob
      const auth = buildBlossomAuth(MARCUS, "delete", { sha256: blob.sha256 });
      const response = await server.inject({
        method: "DELETE",
        url: `/${blob.sha256}`,
        headers: { authorization: auth },
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns 401 without auth", async () => {
      const blob = makeTestBlob("delete-noauth");
      await uploadBlob(LUNA, blob);

      const response = await server.inject({
        method: "DELETE",
        url: `/${blob.sha256}`,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ==================== GET /list/<pubkey> ====================

  describe("GET /list/<pubkey>", () => {
    it("lists blobs uploaded by a pubkey", async () => {
      const blob1 = makeTestBlob("list-1");
      const blob2 = makeTestBlob("list-2");
      await uploadBlob(LUNA, blob1);
      await uploadBlob(LUNA, blob2);

      const response = await server.inject({
        method: "GET",
        url: `/list/${LUNA.pubkey}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);

      const hashes = body.map((b: { sha256: string }) => b.sha256);
      expect(hashes).toContain(blob1.sha256);
      expect(hashes).toContain(blob2.sha256);

      // Each descriptor should have required fields
      for (const desc of body) {
        expect(desc).toHaveProperty("url");
        expect(desc).toHaveProperty("sha256");
        expect(desc).toHaveProperty("size");
        expect(desc).toHaveProperty("type");
        expect(desc).toHaveProperty("uploaded");
      }
    });

    it("returns empty array for pubkey with no blobs", async () => {
      const response = await server.inject({
        method: "GET",
        url: `/list/${MARCUS.pubkey}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it("respects limit parameter", async () => {
      const blob1 = makeTestBlob("list-limit-1");
      const blob2 = makeTestBlob("list-limit-2");
      const blob3 = makeTestBlob("list-limit-3");
      await uploadBlob(LUNA, blob1);
      await uploadBlob(LUNA, blob2);
      await uploadBlob(LUNA, blob3);

      const response = await server.inject({
        method: "GET",
        url: `/list/${LUNA.pubkey}?limit=2`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().length).toBe(2);
    });

    it("only lists blobs owned by the requested pubkey", async () => {
      const lunaBlob = makeTestBlob("list-isolation-luna");
      const marcusBlob = makeTestBlob("list-isolation-marcus");
      await uploadBlob(LUNA, lunaBlob);
      await uploadBlob(MARCUS, marcusBlob);

      const response = await server.inject({
        method: "GET",
        url: `/list/${LUNA.pubkey}`,
      });

      const body = response.json();
      expect(body.length).toBe(1);
      expect(body[0].sha256).toBe(lunaBlob.sha256);
    });
  });
});
