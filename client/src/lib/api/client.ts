import { buildNip98Header } from "./nip98";
import { requestQueue, type RequestPriority } from "./requestQueue";

const DEFAULT_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:9080/api";

let baseUrl = DEFAULT_BASE_URL;

export function setApiBaseUrl(url: string) {
  baseUrl = url;
}

export function getApiBaseUrl(): string {
  return baseUrl;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
  priority?: RequestPriority;
}

interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

interface ApiError {
  error: string;
  code: string;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * In-flight GET request deduplication.
 * When multiple components request the same URL concurrently, they share a
 * single network request instead of each firing independently.
 * Only applies to GET (read) requests — writes always execute individually.
 */
const inflightGets = new Map<string, Promise<ApiResponse<unknown>>>();

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = "GET", body, auth = true, signal, priority = "normal" } = opts;
  const url = `${baseUrl}${path}`;

  // Deduplicate concurrent GET requests to the same path
  if (method === "GET") {
    const inflight = inflightGets.get(path);
    if (inflight) return inflight as Promise<ApiResponse<T>>;
  }

  const promise = apiExecute<T>(url, { method, body, auth, signal, priority });

  if (method === "GET") {
    inflightGets.set(path, promise as Promise<ApiResponse<unknown>>);
    // The .finally() chain creates a derived promise that also rejects when
    // the original rejects. Swallow it — callers handle errors via `promise`.
    promise.finally(() => inflightGets.delete(path)).catch(() => {});
  }

  return promise;
}

async function apiExecute<T>(
  url: string,
  opts: Required<Pick<RequestOptions, "method" | "auth" | "priority">> &
    Pick<RequestOptions, "body" | "signal">,
): Promise<ApiResponse<T>> {
  const { method, body, auth, signal, priority } = opts;

  const headers: Record<string, string> = {};

  // Only set Content-Type when sending a body — Fastify rejects
  // Content-Type: application/json with an empty body as a parse error (400).
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    try {
      headers["Authorization"] = await buildNip98Header(url, method);
    } catch {
      // No signer available, send unauthenticated
    }
  }

  const doFetch = async (): Promise<ApiResponse<T>> => {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (response.status === 429) {
      // Read Retry-After header from gateway (seconds until window resets)
      const retryAfter = parseInt(response.headers.get("Retry-After") ?? "5", 10);
      requestQueue.triggerGlobalBackoff(retryAfter);
      throw new RateLimitError(retryAfter);
    }

    if (!response.ok) {
      const err: ApiError = await response.json().catch(() => ({
        error: response.statusText,
        code: "UNKNOWN",
      }));
      throw new ApiRequestError(response.status, err.code, err.error);
    }

    return (await response.json()) as ApiResponse<T>;
  };

  // First attempt through the queue
  try {
    return await requestQueue.enqueue(doFetch, priority);
  } catch (err) {
    // On rate limit, retry once through the queue (respects global backoff)
    if (err instanceof RateLimitError) {
      try {
        return await requestQueue.enqueue(doFetch, priority);
      } catch (retryErr) {
        // Convert RateLimitError to ApiRequestError on second failure
        if (retryErr instanceof RateLimitError) {
          throw new ApiRequestError(429, "RATE_LIMITED", "rate limit exceeded");
        }
        throw retryErr;
      }
    }
    throw err;
  }
}

/** Internal error type for 429 responses — converted to ApiRequestError if retry also fails. */
class RateLimitError extends Error {
  constructor(public retryAfter: number) {
    super("rate limited");
  }
}
