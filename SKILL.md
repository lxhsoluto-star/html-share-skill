---
name: html-share
description: Share a single HTML file as a short URL + QR code. Reads a local .html, uploads it (with its local images) to the html-share backend, inlines/uploads assets, auto-adds mobile viewport, generates a social-preview (OG) image, and prints a short link + scannable QR. Supports custom short links. Use when the user says "share this html", "分享这个html", "上传html", "生成分享链接", "生成二维码", "share this page", "make a link for this HTML", "publish this HTML", or asks to host/share a single HTML artifact you just produced.
version: 0.1.0
metadata:
  openclaw:
    requires:
      anyBins:
        - bun
        - npx
---

# HTML Share

Turn a local single-page HTML file into a **short URL + QR code** that anyone can open. Local images are uploaded (or inlined when tiny) and their references rewritten automatically; remote URLs are left untouched. A mobile viewport is added if missing. A **social-preview image** (1200×630, the page title on a branded card) is generated and OG/Twitter meta is injected, so the link shows a thumbnail when pasted into chat apps. Verified users can pick a **custom short link** (`--slug`).

The **only prerequisite is a bound email** (stored in `EXTEND.md`). Uploads work immediately as the *unverified* tier (7-day expiry, low quota). Signing in once at the dashboard with the same email (a 6-digit code is emailed) unlocks the *verified* tier: password protection, longer expiry (up to 90 days), and higher quota.

## Script Directory

Scripts in `scripts/`. `{baseDir}` = this SKILL.md's directory. Resolve `${BUN_X}`: if `bun` is installed → `bun`; else `npx -y bun`. **First run only:** install deps once with `cd {baseDir}/scripts && ${BUN_X} install` (needs `linkedom`, `qrcode`, `satori`, `@resvg/resvg-wasm`). The OG fonts (`scripts/fonts/Inter-*.ttf`) are bundled; CJK glyphs are fetched on demand.

| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | Register email, process HTML, upload, emit result + QR |

The script is **non-interactive** and prints a single JSON result line on stdout. All asking and human-facing phrasing is done by **you** (the agent), not the script.

## Prerequisite: bound email (the only gate)

On a `share` run, if no email is bound the script prints `{"status":"NEEDS_EMAIL"}`. When you see that:

1. Ask the user for their email using **AskUserQuestion** (e.g. "Which email should I bind for sharing? It's the only thing needed to upload.").
2. Run: `${BUN_X} {baseDir}/scripts/main.ts register --email <address>`
3. On `{"status":"REGISTERED"}`, tell the user **verbatim**: they can share right now. Optionally, signing in once at the `verify_url` dashboard with this email (a 6-digit code is emailed) verifies the account and unlocks password protection, longer expiry (up to 90 days), and higher quota.

## Tiers & limits

Hard limits are enforced server-side. **Check the live state with `whoami`** instead of guessing — it returns the bound account's tier, used/remaining active shares, and caps. Source of truth: `src/config.ts`.

| Limit | Unverified | Verified | Pro |
|-------|-----------:|---------:|----:|
| Active shares | **3** | 50 | 500 |
| Per-share size | **3 MB** | 20 MB | 100 MB |
| Total storage | 10 MB | 200 MB | 5 GB |
| Assets / share | 15 | 100 | 300 |
| Default expiry | **7 d** | 30 d | 30 d |
| Max expiry | 7 d | 90 d | never |
| Password / custom slug | ✗ | ✓ | ✓ |
| Burn-after-reading | ✗ | ✗ | ✓ |

Unverified is the default after `register`; signing in once at the dashboard (a 6-digit code is emailed) lifts the account to verified. Before sharing large/many files, run `whoami` — if `remainingShares` is 0 you'll hit `QUOTA_EXCEEDED`, and if assets exceed `maxShareBytes` the script now blocks **before** upload (see Pre-flight below).

## Usage

```bash
# Share an HTML file (the common case)
${BUN_X} {baseDir}/scripts/main.ts ./report.html

# Check the bound account's tier, used/remaining shares, and size caps
${BUN_X} {baseDir}/scripts/main.ts whoami

# First-time email binding
${BUN_X} {baseDir}/scripts/main.ts register --email you@example.com

# Update the same file's existing share (keeps the URL + QR)
${BUN_X} {baseDir}/scripts/main.ts ./report.html --update

# Force a brand-new link instead of updating
${BUN_X} {baseDir}/scripts/main.ts ./report.html --new

# Verified users: password-protect / set expiry / custom short link
${BUN_X} {baseDir}/scripts/main.ts ./report.html --password "s3cret" --expiry 30
${BUN_X} {baseDir}/scripts/main.ts ./launch.html --slug q3-launch
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `<path.html>` | Path to the HTML file to share | required |
| `register --email <e>` | Bind an email (first-time setup) | |
| `whoami` | Print live tier, used/remaining active shares, and size caps (JSON) | |
| `--update` | Update the share previously made from this file (stable URL/QR) | |
| `--new` | Force a new share even if this file was shared before | |
| `--password <p>` | Password-protect the share (verified tier only) | |
| `--remove-password` | Remove an existing password (with `--update`) | |
| `--expiry <days>` | Expiry in days (verified tier; clamped to 90) | tier default |
| `--slug <name>` | Custom short link, e.g. `q3-launch` (verified tier; 3–48 lowercase/digits/hyphens; new shares only) | random |
| `--og-title <text>` | Override the title shown on the social-preview card | page `<title>` |
| `--no-og` | Skip social-preview image generation | |
| `--no-qr` | Skip QR rendering | |
| `--no-mobile-fix` | Don't inject the responsive baseline | |
| `--inline-threshold <bytes>` | Inline assets ≤ this size as data URIs | 4096 |
| `--output-dir <dir>` | Base output folder | `html-share` |
| `--api-base <url>` | Override backend base URL | from EXTEND.md |
| `--pretty` | Human-readable output (for demos/manual runs); JSON is the default the agent parses | JSON |

## Workflow

1. If the user just asked to share an HTML artifact you produced, locate the `.html` file path.
2. Run `main.ts <path>`. (Run `bun install` in `scripts/` first if deps are missing.)
3. Handle the JSON `status`:
   - `NEEDS_EMAIL` → ask for email (AskUserQuestion) → `register` → then re-run share.
   - `CONTENT_CHANGED` → ask the user: keep the same link (`--update`) or make a new one (`--new`)? Re-run with their choice.
   - `UNCHANGED` → content identical to a prior share; present the existing link/QR.
   - `OK` → present results (below).
   - `ERROR` → see Error Cases.
4. **Present to the user**: the short **URL** (note if `customSlug` is true that it's their chosen link), the **QR** (print the `qrAscii` block so they can scan from the terminal; mention the saved `qr.png`), the **expiry** date and **tier**, and that a **social-preview card** (`ogUrl`) was generated so the link shows a thumbnail in chat apps. If `missingAssets` is non-empty, list them (referenced files that weren't found). If `tier` is `unverified`, the result carries a `hint` field and an `appUrl` — relay it: tell the user they can sign in at `appUrl` (with the code emailed to them) to unlock password protection, custom short links, and longer expiry (up to 90 days).

## Output Directory

```
html-share/
├── .index.json                       # docHash/sourcePath → share mapping
└── {basename}-{slug}/
    ├── processed.html                # exact HTML shared (asset URLs resolved)
    ├── result.json                   # {slug,url,qrUrl,expiresAt,tier,assetUrls,...}
    ├── qr.png
    └── qr.svg
```

`.index.json` is keyed by content hash and source path, so re-running on the same file reuses the prior link (or offers `--update`).

## Pre-flight size check

Before uploading, the script estimates the payload (processed HTML + assets + OG image) and compares it to the tier's `maxShareBytes` (fetched live via `whoami`). If it's already over, it fails fast with `PAYLOAD_TOO_LARGE` **without uploading**, and the JSON carries `estBytes`, `limitBytes`, and `heaviestAssets` (top 5 by size, in MB). Relay that to the user: name the biggest files and how far over the cap they are, so they can compress/drop them (or verify the account for a higher cap). The check is advisory — if `whoami` is unreachable, the script falls through and lets the server enforce the limit.

## Re-upload / Update

- Identical content → `UNCHANGED`, reuses the link (idempotent).
- Same file, changed content → `CONTENT_CHANGED`; you choose `--update` (same URL/QR, dedups unchanged images) or `--new`.
- Never shared → creates a new share.

## Error Cases

| `error` | Meaning / action |
|---------|------------------|
| `NEEDS_EMAIL` | No bound email → ask + `register` |
| `TOKEN_INVALID` (http 401) | Token revoked/expired → re-`register` |
| `PASSWORD_NOT_ALLOWED` (403) | Password needs verified tier → tell user to verify (sign in at the dashboard) |
| `PAYLOAD_TOO_LARGE` (413) | Over per-share size limit. Caught pre-flight when possible; JSON has `estBytes`/`limitBytes`/`heaviestAssets` — name the biggest files to shrink |
| `QUOTA_EXCEEDED` (403) | Active-share or storage cap hit — run `whoami` to see used/remaining; delete a share in the dashboard or verify the account |
| `NOT_HTML` | Input isn't an `.html` file |
| `BAD_ASSET` | A referenced asset has a disallowed type |
| `SLUG_TAKEN` (409) | Requested `--slug` already exists → suggest another |
| `SLUG_INVALID` (400) | `--slug` isn't 3–48 lowercase/digits/hyphens, or is reserved |
| `SLUG_NOT_ALLOWED` (403) | Custom slug needs verified tier → tell user to verify (sign in at the dashboard) |
| `BLOCKED_CONTENT` (422) | Abuse detection rejected the page (phishing/malware signals) — don't retry; tell the user |
| `DISPOSABLE_EMAIL` (400) | Disposable email at register → ask for a real address |

## Notes

- `EXTEND.md` holds the email + CLI token (a secret) — it is gitignored.
- Remote (`http(s)://`, `//`, `data:`) references are never modified — only local files are uploaded/inlined.
