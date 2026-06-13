import { createHash } from "node:crypto";

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "page"
  );
}

let pretty = false;
export function setPretty(v: boolean): void {
  pretty = v;
}

// Emit a single JSON result line on stdout (the agent consumes this).
// With --pretty, render a human-readable block instead.
export function emit(obj: unknown): void {
  if (!pretty) {
    process.stdout.write(JSON.stringify(obj) + "\n");
    return;
  }
  const o = obj as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof o.url === "string" && (o.status === "OK" || o.status === "UNCHANGED")) {
    lines.push("", `  ✓ ${o.url}${o.customSlug ? "  (your custom link)" : ""}`);
    if (typeof o.qrAscii === "string" && o.qrAscii) {
      lines.push("", (o.qrAscii as string).replace(/^/gm, "  ").trimEnd());
    }
    const bits: string[] = [];
    if (typeof o.expiresAt === "number") {
      bits.push(`expires ${new Date(o.expiresAt * 1000).toISOString().slice(0, 10)}`);
    }
    if (o.tier) bits.push(`tier: ${o.tier}`);
    if (o.hasPassword) bits.push("password-protected");
    if (bits.length) lines.push("", `  ${bits.join(" · ")}`);
    if (typeof o.ogUrl === "string" && o.ogUrl) lines.push(`  social card: ${o.ogUrl}`);
    if (o.status === "UNCHANGED") lines.push(`  content unchanged — reusing the existing link`);
    lines.push("");
  } else if (typeof o.message === "string") {
    lines.push(`  ${o.status === "ERROR" ? "✗" : "•"} ${o.message}`);
  } else {
    lines.push(JSON.stringify(obj));
  }
  process.stdout.write(lines.join("\n") + "\n");
}

export function fail(error: string, message: string, extra: object = {}): never {
  emit({ status: "ERROR", error, message, ...extra });
  process.exit(0); // exit 0: the agent reads the structured error, not the code
}
