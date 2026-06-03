import type { UploadAsset } from "./html";

export interface RegisterResult {
  token?: string;
  email?: string;
  tier?: string;
  activation_email_sent?: boolean;
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

export async function uploadShare(
  apiBase: string,
  token: string,
  html: string,
  uploads: UploadAsset[],
  meta: ShareMeta,
  slug: string | null,
  og: Buffer | null,
): Promise<UploadResult> {
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

  const url = slug
    ? `${apiBase}/api/cli/shares/${slug}`
    : `${apiBase}/api/cli/shares`;
  const res = await fetch(url, {
    method: slug ? "PUT" : "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = (await res.json().catch(() => ({}))) as UploadResult;
  json._status = res.status;
  return json;
}
