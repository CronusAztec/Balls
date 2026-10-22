import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- ai-guard --- One parity check over the whole of the three catalogs (messages/en.json, pl.json, es.json), so a new
 * namespace – an AI or Blueprint panel, say – is covered without a test of its own:
 *  - the flattened key sets are identical (5,800 keys in 73 namespaces when this was written);
 *  - every value is a string (a list's items count as keys of their own, `key[i]`), and every message compiles as ICU MessageFormat (tags on, the way next-intl compiles a message
 *    it formats with values);
 *  - each key's ICU arguments (and rich-text tags) have the same names in every locale – a renamed `{count}` in one
 *    translation would show the raw braces or throw;
 *  - no message carries a `TODO(` marker.
 * The problems that already existed when the test was written are on the KNOWN list. The list only shrinks: a new problem
 * fails, and so does a KNOWN entry that no longer occurs (remove it).
 */

type Catalog = Record<string, unknown>;
const CATALOGS: Record<string, Catalog> = { en, pl, es };
const LOCALES = Object.keys(CATALOGS);

/**
 * Problems that existed when this test was written: `<locale> <key>: <problem>`. Fix one and delete its line.
 * Controls.flEntrantsTip: its `<division or genre>` and `<id>` read as rich-text tags. The tooltip passes no values, so
 * next-intl shows the text as it is in production; a call with values (or the dev build) would report INVALID_TAG.
 */
const KNOWN: readonly string[] = [
  "en Controls.flEntrantsTip: does not compile (INVALID_TAG)",
  "pl Controls.flEntrantsTip: does not compile (INVALID_TAG)",
  "es Controls.flEntrantsTip: does not compile (INVALID_TAG)",
];

/** Every leaf of a catalog with its dotted key (a list's items as `key[i]`: Layout.features, Press.usage.items). */
function flatten(node: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(node)) node.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  else out.set(prefix, node);
  return out;
}

/** The argument names (and `<tag>` names) a parsed message uses, sorted and unique. */
function argumentNames(elements: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) out.add(el.value);
    else if (el.type === TYPE.select || el.type === TYPE.plural) {
      out.add(el.value);
      for (const option of Object.values(el.options)) argumentNames(option.value, out);
    } else if (el.type === TYPE.tag) {
      out.add(`<${el.value}>`);
      argumentNames(el.children, out);
    }
  }
  return out;
}

/** Every parity problem of the catalogs, one line each (the KNOWN format). */
function parityProblems(catalogs: Record<string, Catalog>): string[] {
  const problems: string[] = [];
  const flat = Object.fromEntries(Object.entries(catalogs).map(([locale, c]) => [locale, flatten(c)]));
  const reference = flat.en;
  for (const locale of Object.keys(flat)) {
    if (locale === "en") continue;
    for (const key of reference.keys()) if (!flat[locale].has(key)) problems.push(`${locale} ${key}: missing (en has it)`);
    for (const key of flat[locale].keys()) if (!reference.has(key)) problems.push(`${locale} ${key}: extra (en does not have it)`);
  }
  const args = new Map<string, Map<string, string>>();
  for (const [locale, entries] of Object.entries(flat)) {
    for (const [key, value] of entries) {
      if (typeof value !== "string") {
        problems.push(`${locale} ${key}: not a string (${value === null ? "null" : typeof value})`);
        continue;
      }
      if (value.includes("TODO(")) problems.push(`${locale} ${key}: TODO( marker`);
      try {
        const names = [...argumentNames(parse(value))].sort().join(", ");
        if (!args.has(key)) args.set(key, new Map());
        args.get(key)!.set(locale, names);
      } catch (err) {
        problems.push(`${locale} ${key}: does not compile (${(err as Error).message})`);
      }
    }
  }
  for (const [key, byLocale] of args) {
    const want = byLocale.get("en");
    if (want === undefined) continue;
    for (const [locale, names] of byLocale) if (locale !== "en" && names !== want) problems.push(`${locale} ${key}: arguments {${names}}, en has {${want}}`);
  }
  return problems;
}

describe("i18n parity: en, pl and es", () => {
  const problems = parityProblems(CATALOGS);

  it("covers the three locales and the whole catalog", () => {
    expect(LOCALES).toEqual(["en", "pl", "es"]);
    expect(flatten(en).size).toBeGreaterThanOrEqual(5800);
  });

  it("has no parity problem beyond the KNOWN list (same keys, strings that compile, the same ICU arguments, no TODO)", () => {
    expect(problems.filter((p) => !KNOWN.includes(p))).toEqual([]);
  });

  it("keeps the KNOWN list exact: an entry that no longer occurs is removed", () => {
    expect(KNOWN.filter((k) => !problems.includes(k))).toEqual([]);
  });

  it("detects each kind of problem (a synthetic catalog)", () => {
    const found = parityProblems({
      en: { A: { hi: "Hi {name}", n: "{count, plural, one {# ball} other {# balls}}", tag: "Read <b>this</b>", gone: "x", odd: "{a" } },
      pl: { A: { hi: "Cześć {imie}", n: "{count, plural, one {# piłka} few {# piłki} other {# piłek}}", tag: "Przeczytaj <i>to</i>", odd: "{a", extra: "TODO(pl)", list: ["a", 2] } },
    });
    expect(found).toEqual([
      "pl A.gone: missing (en has it)",
      "pl A.extra: extra (en does not have it)",
      "pl A.list[0]: extra (en does not have it)",
      "pl A.list[1]: extra (en does not have it)",
      "en A.odd: does not compile (EXPECT_ARGUMENT_CLOSING_BRACE)",
      "pl A.odd: does not compile (EXPECT_ARGUMENT_CLOSING_BRACE)",
      "pl A.extra: TODO( marker",
      "pl A.list[1]: not a string (number)",
      "pl A.hi: arguments {imie}, en has {name}",
      "pl A.tag: arguments {<i>}, en has {<b>}",
    ]);
  });
});
