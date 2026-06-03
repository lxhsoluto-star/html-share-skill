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

// Emit a single JSON result line on stdout (the agent consumes this).
export function emit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export function fail(error: string, message: string, extra: object = {}): never {
  emit({ status: "ERROR", error, message, ...extra });
  process.exit(0); // exit 0: the agent reads the structured error, not the code
}
