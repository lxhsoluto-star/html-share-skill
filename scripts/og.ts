import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const FONT_REGULAR = join(scriptsDir, "fonts", "Inter-Regular.ttf");
const FONT_BOLD = join(scriptsDir, "fonts", "Inter-Bold.ttf");

let wasmReady = false;
async function ensureWasm() {
  if (wasmReady) return;
  const pkg = dirname(require.resolve("@resvg/resvg-wasm"));
  await initWasm(readFileSync(join(pkg, "index_bg.wasm")));
  wasmReady = true;
}

// Old-UA trick: Google Fonts serves TTF (satori can't read WOFF2) to legacy UAs.
const LEGACY_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.30 " +
  "(KHTML, like Gecko) Version/5.0 Safari/534.30";

const cjkCache = new Map<string, ArrayBuffer | null>();
async function loadCjkFont(text: string): Promise<ArrayBuffer | null> {
  const key = [...new Set(text)].sort().join("");
  if (cjkCache.has(key)) return cjkCache.get(key)!;
  try {
    const api = `https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@700&text=${encodeURIComponent(text)}`;
    const css = await fetch(api, { headers: { "User-Agent": LEGACY_UA } }).then((r) => r.text());
    // CJK subsets come back as url(https://fonts.gstatic.com/l/font?kit=…) with
    // no file extension, so pull whatever is inside the first url(...).
    const url = css.match(/src:\s*url\((https:\/\/[^)]+)\)/)?.[1];
    if (!url) throw new Error("no font url");
    const data = await fetch(url).then((r) => r.arrayBuffer());
    cjkCache.set(key, data);
    return data;
  } catch {
    cjkCache.set(key, null);
    return null;
  }
}

const div = (style: Record<string, unknown>, children: unknown) => ({
  type: "div",
  props: { style, children },
});

function titleSize(t: string): number {
  if (t.length <= 26) return 78;
  if (t.length <= 48) return 62;
  if (t.length <= 80) return 48;
  return 40;
}

export interface OgInput {
  title: string;
  domain: string;
}

// Render a 1200×630 branded preview PNG. Returns null on any failure so the
// upload still proceeds (we just skip the image, keeping text OG meta).
export async function generateOg({ title, domain }: OgInput): Promise<Buffer | null> {
  try {
    const text = (title || "Shared HTML").slice(0, 120);
    const regular = readFileSync(FONT_REGULAR);
    const bold = readFileSync(FONT_BOLD);

    const tree = div(
      {
        width: 1200,
        height: 630,
        display: "flex",
        flexDirection: "column",
        padding: "72px",
        background: "#0a0b0f",
        color: "#e9eaf0",
        fontFamily: "Inter",
        position: "relative",
      },
      [
        // top gradient hairline
        div(
          {
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 12,
            background: "linear-gradient(90deg, #7c8cff, #36e0d0)",
          },
          "",
        ),
        // brand row
        div({ display: "flex", alignItems: "center" }, [
          div(
            {
              width: 52,
              height: 52,
              borderRadius: 14,
              marginRight: 18,
              background: "linear-gradient(135deg, #7c8cff, #36e0d0)",
            },
            "",
          ),
          div({ fontSize: 32, fontWeight: 700, color: "#36e0d0" }, domain),
        ]),
        // title
        div(
          {
            display: "flex",
            flexGrow: 1,
            alignItems: "center",
            fontSize: titleSize(text),
            fontWeight: 700,
            lineHeight: 1.15,
            color: "#f3f4f8",
            letterSpacing: "-0.02em",
          },
          text,
        ),
        // footer
        div({ fontSize: 27, color: "#8b91a3" }, "Shared via html-share · scan or tap to open"),
      ],
    );

    const svg = await satori(tree as never, {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Inter", data: regular, weight: 400, style: "normal" },
        { name: "Inter", data: bold, weight: 700, style: "normal" },
      ],
      loadAdditionalAsset: async (_code: string, segment: string) => {
        const f = await loadCjkFont(segment);
        return f
          ? [{ name: "NotoSansSC", data: f, weight: 700 as const, style: "normal" as const }]
          : [];
      },
    });

    await ensureWasm();
    const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } })
      .render()
      .asPng();
    return Buffer.from(png);
  } catch {
    return null;
  }
}
