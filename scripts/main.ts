import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig } from "./config";
import { processHtml } from "./html";
import { generateOg } from "./og";
import { fetchWhoami, registerEmail, uploadShare, type ShareMeta } from "./upload";
import { saveQr, terminalQr } from "./qr";
import {
  lookupByHash,
  lookupByPath,
  recordEntry,
  writeShareDir,
} from "./storage";
import { emit, fail, setPretty, sha256, slugify } from "./shared";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

// Numeric tier (from /api/cli/whoami) → human label.
const TIER_LABELS = ["unverified", "verified", "pro"];
const tierLabel = (t: number | undefined): string =>
  typeof t === "number" && TIER_LABELS[t] ? TIER_LABELS[t] : "unverified";

interface Flags {
  email?: string;
  update: boolean;
  new: boolean;
  password?: string;
  removePassword: boolean;
  expiry?: number;
  slug?: string;
  noQr: boolean;
  noMobileFix: boolean;
  noOg: boolean;
  ogTitle?: string;
  inlineThreshold?: number;
  outputDir?: string;
  apiBase?: string;
  pretty: boolean;
}

function parseArgs(argv: string[]): { cmd: string; positional: string[]; flags: Flags } {
  const flags: Flags = { update: false, new: false, removePassword: false, noQr: false, noMobileFix: false, noOg: false, pretty: false };
  const positional: string[] = [];
  let cmd = "share";
  let i = 0;
  if (argv[0] && !argv[0].startsWith("-") && (argv[0] === "register" || argv[0] === "whoami")) {
    cmd = argv[0];
    i = 1;
  }
  for (; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--email": flags.email = argv[++i]; break;
      case "--update": flags.update = true; break;
      case "--new": flags.new = true; break;
      case "--password": flags.password = argv[++i]; break;
      case "--remove-password": flags.removePassword = true; break;
      case "--expiry": flags.expiry = parseInt(argv[++i], 10); break;
      case "--slug": flags.slug = argv[++i]; break;
      case "--no-qr": flags.noQr = true; break;
      case "--no-mobile-fix": flags.noMobileFix = true; break;
      case "--no-og": flags.noOg = true; break;
      case "--og-title": flags.ogTitle = argv[++i]; break;
      case "--inline-threshold": flags.inlineThreshold = parseInt(argv[++i], 10); break;
      case "--output-dir": flags.outputDir = argv[++i]; break;
      case "--api-base": flags.apiBase = argv[++i]; break;
      case "--pretty": flags.pretty = true; break;
      case "--json": break; // JSON is the default for agents
      default:
        if (!a.startsWith("-")) positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

async function main() {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
  setPretty(flags.pretty);
  const cfg = loadConfig(scriptsDir);
  const apiBase = flags.apiBase || cfg.api_base;

  if (cmd === "register") {
    const email = (flags.email || "").trim().toLowerCase();
    if (!email) fail("BAD_EMAIL", "Pass --email <address>");
    const r = await registerEmail(apiBase, email);
    if (!r.token) {
      fail(r.error || "REGISTER_FAILED", r.message || "Registration failed");
    }
    cfg.email = email;
    cfg.cli_token = r.token!;
    cfg.api_base = apiBase;
    saveConfig(scriptsDir, cfg);
    const verifyUrl = r.verify_url || apiBase;
    emit({
      status: "REGISTERED",
      email,
      tier: r.tier,
      verifyUrl,
      message:
        `Saved email + CLI token. You can share right away. To unlock password protection, custom links, longer expiry (up to 90 days) and higher quota, open ${verifyUrl} and sign in with the code emailed to you.`,
    });
    return;
  }

  // --- share ---
  if (!cfg.email || !cfg.cli_token) {
    emit({
      status: "NEEDS_EMAIL",
      api_base: apiBase,
      message:
        "No bound email. Ask the user for their email, then run: register --email <address>",
    });
    return;
  }

  if (cmd === "whoami") {
    const w = await fetchWhoami(apiBase, cfg.cli_token);
    if (w.error || !w.limits) {
      fail(w.error || "WHOAMI_FAILED", w.message || "Could not fetch account info", {
        http: w._status,
      });
    }
    const used = w.usage?.active_shares ?? 0;
    emit({
      status: "WHOAMI",
      email: w.email ?? cfg.email,
      tier: tierLabel(w.tier),
      activeShares: used,
      maxActiveShares: w.limits!.maxActiveShares,
      remainingShares: Math.max(0, w.limits!.maxActiveShares - used),
      maxShareBytes: w.limits!.maxShareBytes,
      maxAssets: w.limits!.maxAssets,
      maxExpiryDays: w.limits!.maxExpiryDays,
      allowPassword: w.limits!.allowPassword,
      allowCustomSlug: w.limits!.allowCustomSlug,
      message:
        `${tierLabel(w.tier)} tier — ${used}/${w.limits!.maxActiveShares} active shares used, ` +
        `max ${Math.round(w.limits!.maxShareBytes / (1024 * 1024))} MB/share.`,
    });
    return;
  }

  const inputPath = positional[0];
  if (!inputPath) fail("NOT_HTML", "Pass the path to an .html file");
  const abs = resolve(inputPath);
  if (!existsSync(abs) || !/\.html?$/i.test(abs)) {
    fail("NOT_HTML", `Not an HTML file: ${inputPath}`);
  }

  const raw = readFileSync(abs, "utf8");
  const threshold = flags.inlineThreshold ?? cfg.inline_threshold;
  const mobileFix = cfg.mobile_fix && !flags.noMobileFix;
  const proc = await processHtml(raw, abs, threshold, mobileFix);
  const docHash = sha256(proc.html);

  const outputDir = resolve(flags.outputDir || cfg.output_dir);

  // Idempotent: identical content already shared
  const byHash = lookupByHash(outputDir, docHash);
  if (byHash && !flags.new && !flags.update) {
    emit({
      status: "UNCHANGED",
      ...byHash,
      qrAscii: flags.noQr ? "" : await terminalQr(byHash.url),
      message: "Content unchanged — reusing existing share link.",
    });
    return;
  }

  // Content changed for a known file: let the agent decide
  const byPath = lookupByPath(outputDir, abs);
  let slug: string | null = null;
  if (flags.update && byPath) {
    slug = byPath.slug;
  } else if (byPath && !flags.new && !byHash) {
    emit({
      status: "CONTENT_CHANGED",
      slug: byPath.slug,
      url: byPath.url,
      message:
        "This file was shared before but content changed. Re-run with --update to keep the same link/QR, or --new for a fresh link.",
    });
    return;
  }

  const expiryDays =
    flags.expiry && flags.expiry > 0
      ? flags.expiry
      : cfg.default_expiry
        ? parseInt(cfg.default_expiry, 10) || undefined
        : undefined;

  const meta: ShareMeta = {
    docHash,
    title: proc.title,
    assets: proc.uploads.map((u) => ({ path: u.path, hash: u.hash })),
    expiryDays,
    password: flags.removePassword ? null : flags.password,
  };
  // Custom slug only applies when creating a new share.
  if (flags.slug && !slug) meta.slug = flags.slug.toLowerCase();

  // Social-preview image (best-effort; null on failure → text-only OG meta).
  let og: Buffer | null = null;
  if (!flags.noOg) {
    let host: string;
    try {
      host = new URL(apiBase).host;
    } catch {
      host = "sharehtml.net";
    }
    og = await generateOg({
      title: flags.ogTitle || proc.title || basename(abs),
      domain: host,
    });
  }

  // Pre-flight size check (best-effort, advisory — the server is the source of
  // truth). Turns a post-upload 413 into an actionable list of the heaviest
  // files. The server injects a little extra HTML (OG/feedback/analytics), so
  // the real payload is slightly larger than this estimate; we therefore only
  // hard-fail when the estimate already exceeds the cap (no false positives).
  // whoami failures (old backend / offline) are ignored — fall through to upload.
  const who = await fetchWhoami(apiBase, cfg.cli_token);
  if (who.limits) {
    const htmlBytes = Buffer.byteLength(proc.html, "utf8");
    const assetBytes = proc.uploads.reduce((n, u) => n + u.buf.byteLength, 0);
    const ogBytes = og ? og.byteLength : 0;
    const estBytes = htmlBytes + assetBytes + ogBytes;
    const limit = who.limits.maxShareBytes;
    if (estBytes > limit) {
      const mb = (n: number) => (n / (1024 * 1024)).toFixed(2);
      const heaviestAssets = [...proc.uploads]
        .sort((a, b) => b.buf.byteLength - a.buf.byteLength)
        .slice(0, 5)
        .map((u) => ({ path: u.path, mb: +(u.buf.byteLength / (1024 * 1024)).toFixed(2) }));
      const assetBudget = Math.max(0, limit - htmlBytes - ogBytes);
      fail(
        "PAYLOAD_TOO_LARGE",
        `Share is ~${mb(estBytes)} MB but the ${tierLabel(who.tier)} tier allows ` +
          `${mb(limit)} MB/share. Shrink the largest assets to ~${mb(assetBudget)} MB total` +
          (who.tier === 0 ? `, or verify your account to raise the cap to 20 MB.` : `.`),
        { estBytes, limitBytes: limit, htmlBytes, assetBytes, ogBytes, heaviestAssets },
      );
    }
  }

  const result = await uploadShare(
    apiBase,
    cfg.cli_token,
    proc.html,
    proc.uploads,
    meta,
    slug,
    og,
  );

  if (result.error || !result.slug) {
    fail(result.error || "UPLOAD_FAILED", result.message || "Upload failed", {
      http: result._status,
    });
  }

  // Resolve placeholders in the saved copy for human viewing
  let processedForDisk = proc.html;
  for (const u of proc.uploads) {
    const hosted = result.assetUrls?.[u.path];
    if (hosted) processedForDisk = processedForDisk.split(`{{asset:${u.hash}}}`).join(hosted);
  }

  const dirName = `${slugify(basename(abs).replace(/\.html?$/i, ""))}-${result.slug}`;
  const dir = writeShareDir(outputDir, dirName, {
    processedHtml: processedForDisk,
    result,
  });

  let qrPng: string | null = null;
  if (!flags.noQr) {
    qrPng = join(dir, "qr.png");
    try {
      await saveQr(result.url!, qrPng, join(dir, "qr.svg"));
    } catch {
      qrPng = null;
    }
  }

  recordEntry(outputDir, {
    slug: result.slug!,
    url: result.url!,
    qrUrl: result.qrUrl!,
    dir,
    docHash,
    sourcePath: abs,
    expiresAt: result.expiresAt ?? null,
    updatedAt: Math.floor(Date.now() / 1000),
  });

  // The app home is the same origin as the API base (content lives on a
  // separate origin). Surface it as the place to activate the account.
  const appUrl = apiBase.replace(/\/+$/, "");
  const unverified = result.tier === "unverified";

  emit({
    status: "OK",
    slug: result.slug,
    url: result.url,
    qrUrl: result.qrUrl,
    ogUrl: result.ogUrl ?? null,
    expiresAt: result.expiresAt,
    tier: result.tier,
    hasPassword: result.hasPassword,
    customSlug: !!meta.slug,
    updated: !!slug,
    uploadedAssets: proc.uploads.length,
    inlinedAssets: proc.inlined,
    missingAssets: proc.missing,
    mobileFixed: proc.mobileFixed,
    dir,
    qrPng,
    qrAscii: flags.noQr ? "" : await terminalQr(result.url!),
    appUrl,
    hint: unverified
      ? `Tell the user: sign in at ${appUrl} (with the code emailed to you) to unlock password protection, custom links, and longer expiry — up to 90 days.`
      : undefined,
  });
}

main().catch((err) => fail("UNEXPECTED", err?.message || String(err)));
