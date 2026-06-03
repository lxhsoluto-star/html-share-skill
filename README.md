# html-share skill

Turn a single-page **HTML file into a short URL + QR code** from your terminal or
agent. Local images are uploaded (or inlined when tiny) and their references
rewritten automatically; a mobile viewport is added if missing; a **1200×630
social-preview image** is generated and OG/Twitter meta injected so the link shows
a thumbnail when pasted into chat apps. Verified users can pick a **custom short
link**.

This is a [Claude Code](https://code.claude.com) / agent **skill**. It talks to the
hosted backend at **[sharehtml.net](https://sharehtml.net)** (or your own, via
`--api-base`). The only prerequisite is a bound email.

```text
$ bun scripts/main.ts ./report.html
  ✓ https://sharehtml.net/s/q7x2k9
  ▄▄▄▄▄▄▄  ▄  ▄▄ ▄▄▄▄▄▄▄
  █ ▄▄▄ █ ▀█▄▀▄ █ ▄▄▄ █     scan to open · expires in 7 days
  █ ███ █ ▄█ ▀▀ █ ███ █     tier: unverified
  ▀▀▀▀▀▀▀ █▄▀▄█ ▀▀▀▀▀▀▀     social card: …/s/q7x2k9/og.png
  …
```

## Install

**With the [`skills`](https://github.com/vercel-labs/skills) CLI (recommended):**

```bash
npx skills add sharehtml/html-share-skill
```

This installs the skill into your agent's skills directory (`~/.claude/skills/` for
Claude Code). List or update later with `npx skills list` / `npx skills update`.

**Manual:**

```bash
git clone https://github.com/sharehtml/html-share-skill ~/.claude/skills/html-share
# or clone anywhere and symlink the folder into your .claude/skills directory
```

## Prerequisites

- **[bun](https://bun.sh)** (or `npx -y bun` — the skill auto-resolves whichever is
  available).
- One-time dependency install:

  ```bash
  cd scripts && bun install   # linkedom, qrcode, satori, @resvg/resvg-wasm
  ```

The Latin OG font (Inter) is bundled in `scripts/fonts/`; CJK glyphs are fetched on
demand when a title needs them.

## Setup — bind an email (the only gate)

```bash
bun scripts/main.ts register --email you@example.com
```

You can share immediately as the **unverified** tier (7-day expiry, low quota, no
password). An activation email is sent — clicking it (optional) unlocks the
**verified** tier: password protection, expiry up to 90 days, custom short links,
and higher quota.

> Your email + a CLI token are stored in `EXTEND.md` next to `SKILL.md`. The token
> is a secret — `EXTEND.md` is gitignored.

## Usage

```bash
# Share an HTML file (the common case)
bun scripts/main.ts ./report.html

# Update the share previously made from this file (keeps the URL + QR)
bun scripts/main.ts ./report.html --update

# Force a brand-new link
bun scripts/main.ts ./report.html --new

# Verified tier: password / expiry / custom short link
bun scripts/main.ts ./report.html --password "s3cret" --expiry 30
bun scripts/main.ts ./launch.html --slug q3-launch
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `<path.html>` | Path to the HTML file to share | required |
| `register --email <e>` | Bind an email (first-time setup) | |
| `--update` | Update the share made from this file (stable URL/QR) | |
| `--new` | Force a new share even if shared before | |
| `--password <p>` | Password-protect (verified tier) | |
| `--remove-password` | Remove a password (with `--update`) | |
| `--expiry <days>` | Expiry in days (verified; clamped to 90) | tier default |
| `--slug <name>` | Custom short link (verified; 3–48 `a-z0-9-`; new shares only) | random |
| `--og-title <text>` | Title shown on the social-preview card | page `<title>` |
| `--no-og` | Skip social-preview image generation | |
| `--no-qr` | Skip QR rendering | |
| `--no-mobile-fix` | Don't inject the responsive baseline | |
| `--inline-threshold <bytes>` | Inline assets ≤ this size as data URIs | 4096 |
| `--output-dir <dir>` | Base output folder | `html-share` |
| `--api-base <url>` | Override backend base URL | from `EXTEND.md` |

Remote references (`http(s)://`, `//`, `data:`) are never modified — only local
files are uploaded or inlined.

## Output

```text
html-share/
├── .index.json                 # docHash / sourcePath → share mapping
└── {basename}-{slug}/
    ├── processed.html          # exact HTML shared (asset URLs resolved)
    ├── result.json             # { slug, url, qrUrl, expiresAt, tier, ... }
    ├── qr.png
    └── qr.svg
```

`.index.json` is keyed by content hash and source path, so re-running on the same
file reuses the prior link (or offers `--update`).

## Error codes

The script prints a single JSON line on stdout. `status: "ERROR"` carries an
`error` code:

| `error` | Meaning / action |
|---------|------------------|
| `NEEDS_EMAIL` | No bound email → run `register` |
| `TOKEN_INVALID` (401) | Token revoked/expired → re-`register` |
| `QUOTA_EXCEEDED` (403) | Tier quota hit → activate or delete old shares |
| `PASSWORD_NOT_ALLOWED` (403) | Password needs verified tier → activate |
| `PAYLOAD_TOO_LARGE` (413) | Over per-share size limit |
| `NOT_HTML` | Input isn't an `.html` file |
| `BAD_ASSET` | A referenced asset has a disallowed type |
| `SLUG_TAKEN` (409) | Requested `--slug` already exists |
| `SLUG_INVALID` (400) | `--slug` isn't 3–48 `a-z0-9-`, or is reserved |
| `SLUG_NOT_ALLOWED` (403) | Custom slug needs verified tier → activate |
| `BLOCKED_CONTENT` (422) | Rejected by abuse detection (phishing/malware) — don't retry |
| `DISPOSABLE_EMAIL` (400) | Disposable email at register → use a real address |

## Backend & privacy

- Defaults to the hosted backend `https://sharehtml.net`. Self-host the
  [html-share worker](https://github.com/sharehtml/html-share) and point the skill
  at it with `--api-base` (or set `api_base` in `EXTEND.md`).
- Shared pages are served from an isolated content origin (`view.sharehtml.net`),
  not the app origin.
- `EXTEND.md` holds your email + CLI token (a secret) and is gitignored.

## License

MIT — see [LICENSE](./LICENSE).
