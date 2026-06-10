import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { sha256 } from "./shared";

export interface UploadAsset {
  path: string; // asset path, e.g. "a1b2c3d4/hero.png"
  hash: string; // full sha-256
  mime: string;
  buf: Buffer;
}

export interface ProcessResult {
  html: string;
  uploads: UploadAsset[];
  inlined: number;
  missing: string[];
  mobileFixed: boolean;
  title: string | null;
}

const UPLOADABLE = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
  "ico",
]);

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i + 1).toLowerCase() : "";
}

function isRemote(ref: string): boolean {
  return (
    /^(https?:)?\/\//i.test(ref) ||
    /^(data:|blob:|mailto:|tel:|#|javascript:)/i.test(ref)
  );
}

function resolveLocal(ref: string, baseDir: string): string | null {
  if (!ref || isRemote(ref)) return null;
  let clean = ref.split("#")[0].split("?")[0].trim();
  if (!clean) return null;
  try {
    if (clean.startsWith("file://")) return fileURLToPath(clean);
    clean = decodeURIComponent(clean);
  } catch {
    /* keep raw */
  }
  return clean.startsWith("/") ? clean : resolve(baseDir, clean);
}

export async function processHtml(
  htmlString: string,
  htmlPath: string,
  inlineThreshold: number,
  mobileFix: boolean,
): Promise<ProcessResult> {
  const htmlDir = dirname(resolve(htmlPath));
  const { document } = parseHTML(htmlString);

  const byAbs = new Map<string, UploadAsset>();
  let inlined = 0;
  const missing: string[] = [];

  // Resolve a single reference → replacement string (data URI / placeholder) or null.
  const handle = (ref: string, baseDir: string): string | null => {
    const abs = resolveLocal(ref, baseDir);
    if (!abs) return null;
    if (!existsSync(abs)) {
      missing.push(ref);
      return null;
    }
    const buf = readFileSync(abs);
    const ext = extOf(abs);
    const mime = MIME[ext] || "application/octet-stream";
    const uploadable = UPLOADABLE.has(ext);
    if (!uploadable || buf.byteLength <= inlineThreshold) {
      inlined++;
      return `data:${mime};base64,${buf.toString("base64")}`;
    }
    const hash = sha256(buf);
    let asset = byAbs.get(abs);
    if (!asset) {
      asset = { path: `${hash.slice(0, 8)}/${basename(abs)}`, hash, mime, buf };
      byAbs.set(abs, asset);
    }
    return `{{asset:${asset.hash}}}`;
  };

  const replaceCssUrls = (css: string, baseDir: string): string =>
    css.replace(
      /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
      (m, _q, ref) => {
        const rep = handle(ref, baseDir);
        return rep ? `url("${rep}")` : m;
      },
    );

  const replaceSrcset = (val: string, baseDir: string): string =>
    val
      .split(",")
      .map((part) => {
        const seg = part.trim();
        if (!seg) return seg;
        const sp = seg.split(/\s+/);
        const rep = handle(sp[0], baseDir);
        if (rep) sp[0] = rep;
        return sp.join(" ");
      })
      .join(", ");

  // <img>, <source>: src + srcset
  for (const el of document.querySelectorAll("img, source")) {
    const src = el.getAttribute("src");
    if (src) {
      const rep = handle(src, htmlDir);
      if (rep) el.setAttribute("src", rep);
    }
    const srcset = el.getAttribute("srcset");
    if (srcset) el.setAttribute("srcset", replaceSrcset(srcset, htmlDir));
  }

  // <video poster>
  for (const el of document.querySelectorAll("video[poster]")) {
    const rep = handle(el.getAttribute("poster")!, htmlDir);
    if (rep) el.setAttribute("poster", rep);
  }

  // <link rel="icon"/"apple-touch-icon">
  for (const el of document.querySelectorAll("link[rel]")) {
    const rel = (el.getAttribute("rel") || "").toLowerCase();
    if (rel.includes("icon")) {
      const href = el.getAttribute("href");
      if (href) {
        const rep = handle(href, htmlDir);
        if (rep) el.setAttribute("href", rep);
      }
    }
  }

  // <link rel="stylesheet"> (local) → inline as <style>, process its url()s
  for (const el of [...document.querySelectorAll('link[rel="stylesheet"]')]) {
    const href = el.getAttribute("href");
    const abs = href ? resolveLocal(href, htmlDir) : null;
    if (abs && existsSync(abs)) {
      const css = replaceCssUrls(readFileSync(abs, "utf8"), dirname(abs));
      const style = document.createElement("style");
      style.textContent = css;
      el.replaceWith(style);
    }
  }

  // <script src> (local) → inline
  for (const el of [...document.querySelectorAll("script[src]")]) {
    const src = el.getAttribute("src");
    const abs = src ? resolveLocal(src, htmlDir) : null;
    if (abs && existsSync(abs)) {
      el.textContent = readFileSync(abs, "utf8");
      el.removeAttribute("src");
    }
  }

  // <style> blocks: process url()
  for (const el of document.querySelectorAll("style")) {
    if (el.textContent) el.textContent = replaceCssUrls(el.textContent, htmlDir);
  }

  // inline style="" attributes with url()
  for (const el of document.querySelectorAll("[style]")) {
    const st = el.getAttribute("style")!;
    if (st.includes("url(")) el.setAttribute("style", replaceCssUrls(st, htmlDir));
  }

  // --- Mobile adaptation ---
  let head = document.querySelector("head");
  if (!head) {
    head = document.createElement("head");
    document.documentElement?.prepend(head);
  }
  let mobileFixed = false;
  if (!document.querySelector('meta[name="viewport"]')) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    meta.setAttribute("content", "width=device-width, initial-scale=1");
    head.prepend(meta);
    mobileFixed = true;
  }
  if (mobileFix) {
    const hasMedia = [...document.querySelectorAll("style")].some((s) =>
      (s.textContent || "").includes("@media"),
    );
    if (!hasMedia) {
      const baseline = document.createElement("style");
      baseline.setAttribute("id", "html-share-baseline");
      baseline.textContent =
        "img,svg,video{max-width:100%;height:auto}html{-webkit-text-size-adjust:100%}";
      head.appendChild(baseline);
      mobileFixed = true;
    }
  }

  const title =
    document.querySelector("title")?.textContent?.trim() || null;

  return {
    html: document.toString(),
    uploads: [...byAbs.values()],
    inlined,
    missing,
    mobileFixed,
    title,
  };
}
