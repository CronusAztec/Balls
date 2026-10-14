/**
 * Rasterises public/icon.svg into the PNG icons of the installable app (feature pwa) with the Chromium that
 * Playwright installs (the same browser the smoke test uses). Run it after changing the icon and commit the
 * PNGs:
 *   node scripts/generate-icons.mjs
 *
 *  - public/icons/icon-192.png, icon-512.png   "any" icons: the SVG as it is, transparent background;
 *  - public/icons/icon-maskable-512.png        "maskable": full-bleed dark background, the artwork inside the
 *                                              80 % safe circle so any launcher mask (circle, squircle…) keeps it;
 *  - public/icons/apple-touch-icon.png (180)   iOS home screen: opaque (iOS fills transparency with black) and
 *                                              slightly inset, as iOS rounds the corners itself.
 *  - public/icons/icon-48.png                  --- seo --- a 48 px "any" icon (Google lists a site's favicon in multiples of 48 px);
 *  - public/favicon.ico                        --- seo --- 32 and 48 px PNG images in one ICO file: what browsers, Bing and old
 *                                              crawlers ask for at /favicon.ico when a page names no icon (the layout names them all).
 * The background is the site's page colour (PWA_BACKGROUND_COLOR in src/lib/pwa.ts).
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const root = process.cwd();
const svg = fs.readFileSync(path.join(root, "public", "icon.svg"), "utf8");
const pwaTs = fs.readFileSync(path.join(root, "src", "lib", "pwa.ts"), "utf8");
const background = pwaTs.match(/PWA_BACKGROUND_COLOR = "(#[0-9a-fA-F]{3,8})"/)?.[1] ?? "#0b0b0d";
const outDir = path.join(root, "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

/** size: output pixels; scale: share of the side the SVG's viewBox takes; opaque: fill the background. */
const ICONS = [
  { file: "icon-192.png", size: 192, scale: 1, opaque: false },
  { file: "icon-512.png", size: 512, scale: 1, opaque: false },
  // icon.svg's artwork reaches 48 % of the side from the centre (ring r=46 + half its stroke); at 0.8 it stays
  // within 38.4 % – inside the maskable safe zone (a circle of radius 40 %).
  { file: "icon-maskable-512.png", size: 512, scale: 0.8, opaque: true },
  { file: "apple-touch-icon.png", size: 180, scale: 0.86, opaque: true },
  // --- seo --- the browser-tab sizes: icon-48.png is a file of its own, both sizes also go into public/favicon.ico
  { file: "icon-48.png", size: 48, scale: 1, opaque: false, ico: true },
  { file: null, size: 32, scale: 1, opaque: false, ico: true },
];

/** --- seo --- An ICO file holding PNG images (every browser since Vista reads them): the 6-byte header, one 16-byte entry per image, then the PNGs. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // width, height (0 means 256)
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}
const icoImages = [];

const launchOpts = {};
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launchOpts);
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  for (const icon of ICONS) {
    const inner = Math.round(icon.size * icon.scale);
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(
      `<!DOCTYPE html><html><body style="margin:0;width:${icon.size}px;height:${icon.size}px;display:flex;align-items:center;justify-content:center;background:${icon.opaque ? background : "transparent"}">` +
        `<img src="${dataUrl}" width="${inner}" height="${inner}" style="display:block"></body></html>`,
    );
    await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
    const png = await page.screenshot({ omitBackground: !icon.opaque, clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
    if (icon.ico) icoImages.push({ size: icon.size, png });
    if (!icon.file) continue; // an image that only goes into favicon.ico
    const file = path.join(outDir, icon.file);
    fs.writeFileSync(file, png);
    console.log(`generate-icons: wrote ${path.relative(root, file)} (${icon.size}×${icon.size}${icon.opaque ? `, on ${background}` : ", transparent"})`);
  }
} finally {
  await browser.close();
}
// --- seo --- public/favicon.ico: the 32 and 48 px images, smallest first
const icoFile = path.join(root, "public", "favicon.ico");
fs.writeFileSync(icoFile, buildIco(icoImages.sort((a, b) => a.size - b.size)));
console.log(`generate-icons: wrote ${path.relative(root, icoFile)} (${icoImages.map((i) => `${i.size}×${i.size}`).join(" and ")})`);
