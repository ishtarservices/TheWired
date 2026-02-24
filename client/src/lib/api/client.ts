import { buildNip98Header } from "./nip98";

const DEFAULT_BASE_URL = "http://localhost:9080/api";

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

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = "GET", body, auth = true, signal } = opts;
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth) {
    try {
      headers["Authorization"] = await buildNip98Header(url, method);
    } catch {
      // No signer available, send unauthenticated
    }
  }

  let retries = 0;
  const maxRetries = 2;

  while (true) {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (response.status === 429 && retries < maxRetries) {
      retries++;
      const backoff = Math.min(1000 * Math.pow(2, retries), 8000);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    if (!response.ok) {
      const err: ApiError = await response.json().catch(() => ({
        error: response.statusText,
        code: "UNKNOWN",
      }));
      throw new ApiRequestError(response.status, err.code, err.error);
    }

    return (await response.json()) as ApiResponse<T>;
  }
}
