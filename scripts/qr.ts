import QRCode from "qrcode";

export async function terminalQr(text: string): Promise<string> {
  try {
    return await QRCode.toString(text, { type: "terminal", small: true });
  } catch {
    return "";
  }
}

export async function saveQr(
  text: string,
  pngPath: string,
  svgPath: string,
): Promise<void> {
  await QRCode.toFile(pngPath, text, { width: 512, margin: 2 });
  const svg = await QRCode.toString(text, { type: "svg", margin: 2 });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(svgPath, svg);
}
