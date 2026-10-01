import { describe, expect, it } from "vitest";
import path from "path";
import { APP_ORIGIN, contentType, isAppUrl, isExternalWebUrl, resolveSiteRequest, startUrl, type StatLike } from "../src/protocol";
import { appLocations } from "../src/paths";

/* --- desktop-exe --- app:// serves the static export like GitHub Pages (scripts/serve-static.mjs) */

const root = path.resolve("/site");
const files = new Set(["404.html", "en/index.html", "en/simulator/index.html", "sw.js", "_next/static/chunks/a.js", "en/about.html"].map((f) => path.join(root, f)));
const dirs = new Set([root, path.join(root, "en"), path.join(root, "en/simulator"), path.join(root, "empty")]);
const fsLike: StatLike = { kind: (p) => (files.has(p) ? "file" : dirs.has(p) ? "dir" : null) };

describe("app:// resolution", () => {
  it("serves index.html of a folder and redirects to the trailing slash", () => {
    expect(resolveSiteRequest(root, "/en/simulator/", "", fsLike)).toEqual({ kind: "file", file: path.join(root, "en/simulator/index.html"), status: 200 });
    expect(resolveSiteRequest(root, "/en/simulator", "?mode=glass", fsLike)).toEqual({ kind: "redirect", location: `${APP_ORIGIN}/en/simulator/?mode=glass` });
    expect(resolveSiteRequest(root, "/_next/static/chunks/a.js", "", fsLike)).toMatchObject({ kind: "file", status: 200 });
    expect(resolveSiteRequest(root, "/en/about", "", fsLike)).toEqual({ kind: "file", file: path.join(root, "en/about.html"), status: 200 });
  });
  it("answers unknown paths with 404.html and never leaves the export", () => {
    expect(resolveSiteRequest(root, "/nope/", "", fsLike)).toEqual({ kind: "file", file: path.join(root, "404.html"), status: 404 });
    expect(resolveSiteRequest(root, "/empty/", "", fsLike)).toMatchObject({ status: 404 });
    expect(resolveSiteRequest(root, "/../../etc/passwd", "", fsLike)).toMatchObject({ status: 404 });
    expect(resolveSiteRequest(root, "/%2e%2e/%2e%2e/etc/passwd", "", fsLike)).toMatchObject({ status: 404 });
    expect(resolveSiteRequest(root, "/%E0%A4%A", "", fsLike)).toMatchObject({ status: 404 });
    expect(resolveSiteRequest(root, "/x", "", { kind: () => null })).toEqual({ kind: "missing" });
  });
  it("types files, picks the start page and tells app from web links", () => {
    expect(contentType("a.js")).toMatch(/javascript/);
    expect(contentType("a.webp")).toBe("image/webp");
    expect(contentType("x.unknown")).toBe("application/octet-stream");
    expect(startUrl("pl-PL")).toBe("app://jumpingballslive/pl/simulator/");
    expect(startUrl("de-DE")).toBe("app://jumpingballslive/en/simulator/");
    expect(isAppUrl("app://jumpingballslive/en/")).toBe(true);
    expect(isAppUrl("app://evil/en/")).toBe(false);
    expect(isAppUrl("file:///C:/x")).toBe(false);
    expect(isExternalWebUrl("https://github.com/CronusAztec/Balls/releases")).toBe(true);
    expect(isExternalWebUrl("file:///etc/passwd")).toBe(false);
    expect(isExternalWebUrl("javascript:alert(1)")).toBe(false);
  });
  it("finds the site and data folders packaged, from a checkout and portable", () => {
    const packaged = appLocations({ packaged: true, resourcesPath: "/app/resources", appPath: "/app/resources/app.asar", userData: "/home/u/.config/JumpingBallsLive" });
    expect(packaged.siteRoot).toBe(path.join("/app/resources", "site"));
    expect(packaged.playbook).toBe(path.join("/app/resources", "playbook", "virality-playbook.md"));
    expect(packaged.modelsDir).toBe(path.join("/home/u/.config/JumpingBallsLive", "models"));
    const dev = appLocations({ packaged: false, resourcesPath: "", appPath: "/repo/desktop", userData: "/tmp/u" });
    expect(dev.siteRoot).toBe(path.resolve("/repo/out"));
    const portable = appLocations({ packaged: true, resourcesPath: "/r", appPath: "/r/app.asar", userData: "/u", portableDir: "/usb" });
    expect(portable.dataDir).toBe(path.join("/usb", "JumpingBallsLive-data"));
  });
});
