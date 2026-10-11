/*
 * --- ellipse-foci --- The loop HUD's counter in the right plural form. A counter template may carry ICU's plural argument for
 * its count – "{count, plural, one {{count} pass} other {{count} passes}}" – so "1 pass" and "3 passes" both read right, and
 * Polish gets its few/many forms ("2 przejścia", "5 przejść"). `hudCounterText()` (hud.ts) picks the form before it fills in the
 * placeholders; a template without the plural argument is returned as it is. The choice follows ICU: an exact `=n` option
 * first, then the language's plural category (Intl.PluralRules), else `other`; `#` in the chosen form is the count.
 *
 * A template is parsed once (the counter is drawn every frame) and a language's rules are made once.
 */

/** The plural argument's opening (the count is the only counted placeholder of the HUD's templates). */
const PLURAL_OPEN = "{count, plural,";

interface PluralTemplate {
  head: string;
  tail: string;
  options: Map<string, string>;
}

const parsedTemplates = new Map<string, PluralTemplate | null>();
const rulesByLocale = new Map<string, Intl.PluralRules>();

/** The index of the brace that closes the one opened at `from` (−1 when it never closes). */
function closingBrace(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The plural argument of `template` split into what comes before it, its options and what comes after it (null: malformed). */
export function parseHudPlural(template: string): PluralTemplate | null {
  const start = template.indexOf(PLURAL_OPEN);
  if (start < 0) return null;
  const end = closingBrace(template, start);
  if (end < 0) return null;
  const body = template.slice(start + PLURAL_OPEN.length, end);
  const options = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    const keyFrom = i;
    while (i < body.length && body[i] !== "{" && !/\s/.test(body[i])) i++;
    const key = body.slice(keyFrom, i);
    while (i < body.length && /\s/.test(body[i])) i++;
    if (!key || body[i] !== "{") return null;
    const close = closingBrace(body, i);
    if (close < 0) return null;
    options.set(key, body.slice(i + 1, close));
    i = close + 1;
  }
  return options.has("other") ? { head: template.slice(0, start), tail: template.slice(end + 1), options } : null;
}

function rulesFor(locale?: string): Intl.PluralRules {
  const key = locale ?? "";
  let rules = rulesByLocale.get(key);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale || "en");
    } catch {
      rules = new Intl.PluralRules("en");
    }
    rulesByLocale.set(key, rules);
  }
  return rules;
}

/** `template` with its plural argument (if any) resolved for `count` in `locale`'s plural rules (English without one). */
export function hudPluralText(template: string, count: number, locale?: string): string {
  if (!template.includes(PLURAL_OPEN)) return template;
  let parsed = parsedTemplates.get(template);
  if (parsed === undefined) {
    parsed = parseHudPlural(template);
    parsedTemplates.set(template, parsed);
  }
  if (!parsed || !Number.isFinite(count)) return template;
  const form = parsed.options.get(`=${count}`) ?? parsed.options.get(rulesFor(locale).select(count)) ?? parsed.options.get("other") ?? "";
  return parsed.head + form.replace(/#/g, String(count)) + parsed.tail;
}
