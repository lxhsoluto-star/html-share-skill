import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface IndexEntry {
  slug: string;
  url: string;
  qrUrl: string;
  dir: string;
  docHash: string;
  sourcePath: string;
  expiresAt: number | null;
  updatedAt: number;
}

interface IndexFile {
  byHash: Record<string, IndexEntry>;
  byPath: Record<string, IndexEntry>;
}

function indexPath(outputDir: string): string {
  return join(outputDir, ".index.json");
}

export function loadIndex(outputDir: string): IndexFile {
  const p = indexPath(outputDir);
  if (!existsSync(p)) return { byHash: {}, byPath: {} };
  try {
    return JSON.parse(readFileSync(p, "utf8")) as IndexFile;
  } catch {
    return { byHash: {}, byPath: {} };
  }
}

export function saveIndex(outputDir: string, idx: IndexFile): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(indexPath(outputDir), JSON.stringify(idx, null, 2));
}

export function lookupByHash(
  outputDir: string,
  hash: string,
): IndexEntry | null {
  return loadIndex(outputDir).byHash[hash] ?? null;
}

export function lookupByPath(
  outputDir: string,
  sourcePath: string,
): IndexEntry | null {
  return loadIndex(outputDir).byPath[resolve(sourcePath)] ?? null;
}

export function recordEntry(outputDir: string, entry: IndexEntry): void {
  const idx = loadIndex(outputDir);
  idx.byHash[entry.docHash] = entry;
  idx.byPath[resolve(entry.sourcePath)] = entry;
  saveIndex(outputDir, idx);
}

// Write the per-share output folder (processed.html, result.json).
export function writeShareDir(
  outputDir: string,
  dirName: string,
  files: { processedHtml: string; result: unknown },
): string {
  const dir = join(outputDir, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "processed.html"), files.processedHtml);
  writeFileSync(join(dir, "result.json"), JSON.stringify(files.result, null, 2));
  return dir;
}
