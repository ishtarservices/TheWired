const DEFAULT_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:9080/api";

let baseUrl = DEFAULT_BASE_URL;

export function setApiBaseUrl(url: string) {
  baseUrl = url;
}

export function getApiBaseUrl(): string {
  return baseUrl;
}

/** True for URLs under our own API base: the only place app-identifying
 *  headers (X-Wired-Client) belong. Blossom servers, LNURL endpoints and
 *  other relays' HTTP endpoints are third parties. */
export function isOwnApiUrl(url: string): boolean {
  const base = baseUrl.replace(/\/+$/, "");
  return url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`);
}
