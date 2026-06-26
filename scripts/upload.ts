import type { UploadAsset } from "./html";

export interface RegisterResult {
  token?: string;
  email?: string;
  tier?: string;
  verify_url?: string;
  error?: string;
  message?: string;
}

export async function registerEmail(
  apiBase: string,
  email: string,
): Promise<RegisterResult> {
  const res = await fetch(`${apiBase}/api/cli/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return (await res.json().catch(() => ({}))) as RegisterResult;
}

export interface TierLimits {
  maxActiveShares: number;
  maxStorageBytes: number;
  maxShareBytes: number;
  maxAssets: number;
  defaultExpiryDays: number;
  maxExpiryDays: number | null;
  allowPassword: boolean;
  allowCustomSlug: boolean;
}

export interface WhoamiResult {
  email?: string;
  tier?: number; // 0 = unverified, 1 = verified, 2 = pro
  usage?: { active_shares: number; storage_bytes: number };
  limits?: TierLimits;
  error?: string;
  message?: string;
  _status?: number;
}

// Best-effort: returns live tier/usage/limits, or an error result the caller can
// ignore (pre-flight is advisory; the server is the source of truth).
export async function fetchWhoami(
  apiBase: string,
  token: string,
): Promise<WhoamiResult> {
  try {
    const res = await fetch(`${apiBase}/api/cli/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as WhoamiResult;
    json._status = res.status;
    return json;
  } catch (err) {
    return {
      error: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : String(err),
      _status: 0,
    };
  }
}

export interface ShareMeta {
  docHash: string;
  title: string | null;
  assets: { path: string; hash: string }[];
  expiryDays?: number;
  password?: string | null;
  slug?: string;
}

export interface UploadResult {
  slug?: string;
  url?: string;
  qrUrl?: string;
  ogUrl?: string | null;
  expiresAt?: number;
  tier?: string;
  hasPassword?: boolean;
  assetUrls?: Record<string, string>;
  error?: string;
  message?: string;
  _status?: number;
}

// Total attempts and backoff between them (ms). Transient failures (network
// errors, 429, 5xx) are retried; business errors (4xx) are returned as-is.
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1500];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadShare(
  apiBase: string,
  token: string,
  html: string,
  uploads: UploadAsset[],
  meta: ShareMeta,
  slug: string | null,
  og: Buffer | null,
): Promise<UploadResult> {
  const url = slug
    ? `${apiBase}/api/cli/shares/${slug}`
    : `${apiBase}/api/cli/shares`;

  // Rebuild the form each attempt — a FormData body stream is consumed by fetch
  // and can't be reused across retries.
  const buildForm = (): FormData => {
    const form = new FormData();
    form.append("meta", JSON.stringify(meta));
    form.append("html", html);
    for (const a of uploads) {
      form.append(
        a.hash,
        new Blob([new Uint8Array(a.buf)], { type: a.mime }),
        a.path.split("/").pop() || "asset",
      );
    }
    if (og) {
      form.append("og", new Blob([new Uint8Array(og)], { type: "image/png" }), "og.png");
    }
    return form;
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: slug ? "PUT" : "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: buildForm(),
      });
      // Server-side transient failure — retry unless this was the last attempt.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        process.stderr.write(
          `html-share: upload got ${res.status}, retrying (${attempt}/${MAX_ATTEMPTS - 1})…\n`,
        );
        await sleep(BACKOFF_MS[attempt - 1]);
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as UploadResult;
      json._status = res.status;
      return json;
    } catch (err) {
      // Network-level failure (DNS, reset, timeout) — fetch threw.
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        process.stderr.write(
          `html-share: upload network error, retrying (${attempt}/${MAX_ATTEMPTS - 1})…\n`,
        );
        await sleep(BACKOFF_MS[attempt - 1]);
        continue;
      }
    }
  }

  return {
    error: "NETWORK_ERROR",
    message: `Upload failed after ${MAX_ATTEMPTS} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
    _status: 0,
  };
}
