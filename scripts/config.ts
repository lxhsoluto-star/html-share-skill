import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SkillConfig {
  email: string | null;
  cli_token: string | null;
  api_base: string;
  output_dir: string;
  default_expiry: string | null;
  inline_threshold: number;
  mobile_fix: boolean;
}

const DEFAULTS: SkillConfig = {
  email: null,
  cli_token: null,
  api_base: "https://sharehtml.net",
  output_dir: "html-share",
  default_expiry: null,
  inline_threshold: 4096,
  mobile_fix: true,
};

// EXTEND.md lives next to SKILL.md (one dir up from scripts/).
export function extendPath(scriptsDir: string): string {
  return join(scriptsDir, "..", "EXTEND.md");
}

// Minimal frontmatter parser: `key: value` lines between --- fences.
export function loadConfig(scriptsDir: string): SkillConfig {
  const p = extendPath(scriptsDir);
  const cfg: SkillConfig = { ...DEFAULTS };
  if (!existsSync(p)) return cfg;
  const text = readFileSync(p, "utf8");
  const m = text.match(/^---\s*([\s\S]*?)\s*---/);
  const block = m ? m[1] : text;
  for (const line of block.split("\n")) {
    const mm = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!mm) continue;
    const key = mm[1];
    let raw = mm[2].trim();
    if (raw === "" || raw === "null") {
      (cfg as any)[key] = key in DEFAULTS ? (DEFAULTS as any)[key] : null;
      if (raw === "null") (cfg as any)[key] = null;
      continue;
    }
    if (raw === "true") (cfg as any)[key] = true;
    else if (raw === "false") (cfg as any)[key] = false;
    else if (/^\d+$/.test(raw)) (cfg as any)[key] = parseInt(raw, 10);
    else (cfg as any)[key] = raw.replace(/^["']|["']$/g, "");
  }
  return cfg;
}

export function saveConfig(scriptsDir: string, cfg: SkillConfig): void {
  const lines = [
    "---",
    "version: 1",
    `email: ${cfg.email ?? "null"}`,
    `cli_token: ${cfg.cli_token ?? "null"}`,
    `api_base: ${cfg.api_base}`,
    `output_dir: ${cfg.output_dir}`,
    `default_expiry: ${cfg.default_expiry ?? "null"}`,
    `inline_threshold: ${cfg.inline_threshold}`,
    `mobile_fix: ${cfg.mobile_fix}`,
    "---",
    "",
    "<!-- html-share skill config. cli_token is a secret — keep this file gitignored. -->",
    "",
  ];
  writeFileSync(extendPath(scriptsDir), lines.join("\n"));
}
