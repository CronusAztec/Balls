import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { NOT_FOUND_CLIENT_NAMESPACES, PAGE_CLIENT_NAMESPACES, SHARED_CLIENT_NAMESPACES, pageClientNamespaces, pickMessages } from "@/i18n/clientMessages";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- review fix (performance) --- Every exported page embeds the messages its client provider gets. The layout passes only
 * the shared namespaces and a page adds its own (i18n/clientMessages.ts), so this walks each page's imports and checks that
 * every `useTranslations("…")` a client component on it reads is in its list – a missing one would render the key instead
 * of the text. (The simulator page gets the whole catalogue.)
 */

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const APP = path.join(SRC, "app", "[locale]");

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const file = base + ext;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

/** The namespaces client components reachable from `file` read ("*" for a `useTranslations()` of the whole catalogue). */
function clientNamespaces(file: string, inClient: boolean, seen = new Map<string, boolean>(), out = new Set<string>()): Set<string> {
  if (seen.get(file) === true || (seen.has(file) && !inClient)) return out;
  seen.set(file, inClient);
  const src = fs.readFileSync(file, "utf8");
  const client = inClient || /^\s*["']use client["']/.test(src);
  if (client) {
    for (const m of src.matchAll(/useTranslations\(\s*(?:["'`]([\w.]+)["'`])?\s*\)/g)) out.add(m[1] ? m[1].split(".")[0] : "*");
    if (/useMessages\(\)/.test(src)) out.add("*");
  }
  for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
    const target = resolveImport(file, m[1]);
    if (target && target.startsWith(path.join(SRC, "components"))) clientNamespaces(target, client, seen, out);
  }
  return out;
}

/** Every page of the locale segment: its route ("" = the landing page) and file. */
function pages(): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  const walk = (dir: string, route: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${route}/${entry.name}`);
      else if (entry.name === "page.tsx" || entry.name === "not-found.tsx") out.push({ route: entry.name === "page.tsx" ? route : `${route}#not-found`, file: path.join(dir, entry.name) });
    }
  };
  walk(APP, "");
  return out;
}

describe("client message namespaces", () => {
  it("cover every namespace the client components of each page read", () => {
    const list = pages();
    expect(list.map((p) => p.route)).toEqual(expect.arrayContaining(["", "/simulator", "/feedback", "/about", "#not-found"]));
    for (const { route, file } of list) {
      const used = clientNamespaces(file, false);
      if (route === "/simulator") {
        // The whole catalogue: the panel reads nearly everything (useTranslations() of the root, useMessages()).
        expect(used.has("*"), route).toBe(true);
        expect(fs.readFileSync(file, "utf8")).toMatch(/<NextIntlClientProvider>/);
        continue;
      }
      const allowed = new Set(pageClientNamespaces(route.replace("#not-found", "")));
      for (const ns of used) expect(allowed.has(ns), `${route || "/"} reads ${ns}`).toBe(true);
    }
  });

  it("cover the static 404 page, which renders the navbar and the footer on the client", () => {
    const used = clientNamespaces(path.join(SRC, "components", "site", "NotFoundStatic.tsx"), false);
    expect([...used].sort()).toEqual([...NOT_FOUND_CLIENT_NAMESPACES].sort());
  });

  it("exist in every locale and pick only what is asked for", () => {
    const all = [...SHARED_CLIENT_NAMESPACES, ...NOT_FOUND_CLIENT_NAMESPACES, ...Object.values(PAGE_CLIENT_NAMESPACES).flat()];
    for (const messages of [en, pl, es] as Record<string, unknown>[]) for (const ns of all) expect(messages[ns], ns).toBeTypeOf("object");
    const picked = pickMessages(en as Record<string, unknown>, pageClientNamespaces("/feedback"));
    expect(Object.keys(picked).sort()).toEqual(["DesktopLink", "Feedback", "Gallery", "Navbar", "Pwa"]); // --- desktop-exe --- (DesktopLink)
    expect(pickMessages(en as Record<string, unknown>, ["NoSuchNamespace"])).toEqual({});
    // The shared set is a small part of the catalogue the pages embedded before.
    expect(JSON.stringify(pickMessages(en as Record<string, unknown>, SHARED_CLIENT_NAMESPACES)).length).toBeLessThan(JSON.stringify(en).length / 10);
  });
});
