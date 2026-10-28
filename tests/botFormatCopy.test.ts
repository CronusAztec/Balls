import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { FORMAT_COPY_FIELDS, FORMAT_HOOK_FIELDS, FORMAT_PLACEHOLDERS, formatText, lookCopy, recipeCopyPath, recipeCopyVars, recipeText, templateName, thingOf, type BotCopy, type BotLocale } from "@/lib/bot/copy";
import { defaultSettings } from "@/lib/settings";
import { evenCaptionLines, planClip, type ClipPlan } from "@/lib/bot/planner";
import { HOOK_VARIANTS } from "@/lib/crew/roles";
import { numbersIn } from "@/lib/crew/clip";
import { wordCount } from "@/lib/crew/simplicity";
import { BINDINGS, BOT_LOOKS, SIMPLE_TEXT, TEMPLATE_FORMAT_IDS, allTemplates, plannedRecipe, simpleHookText, simplePayoffText, templateById, templateNameOf, templateRecipeById, thingKeyOf, variantKeyOf, type TemplateFormatId } from "@/lib/bot/templates";

/*
 * --- templates --- The formats' words (AI studio step 2: messages/*.json ViralBot.formats, ViralBot.things, ViralBot.looks, read
 * by lib/bot/copy.ts): every format's eight fields, a noun for each of the 48 modes and the two looks, in English, Polish and
 * Spanish; every hook of every format, on every mode bound to it and in every locale, inside the Simple look's lines (at most 7
 * words on at most 2 lines, 42 characters in English and 52 in Polish and Spanish, numbers the clip has); a template without a
 * recipe planned in its format's words, a template that wraps one in its recipe's; and a template's name, "{Mode name} ·
 * {Format name}".
 */

// Planning simulates physics seed by seed: a busy machine can take many times the usual couple of seconds per test.
vi.setConfig({ testTimeout: 60_000 });

const LOCALES: readonly BotLocale[] = ["en", "pl", "es"];
const MESSAGES = { en, pl, es } as const;
const COPY: Record<BotLocale, BotCopy> = { en: en.ViralBot as BotCopy, pl: pl.ViralBot as BotCopy, es: es.ViralBot as BotCopy };
/** A hook's characters at most, as drawn (docs/COPY-STYLE.md: the social card's 42 in English; Polish and Spanish run longer). */
const HOOK_CHARS: Record<BotLocale, number> = { en: 42, pl: 52, es: 52 };
/** The size the Simple look draws a hook and a closing question at (planner.ts clipCaptions), and a payoff's words. */
const HOOK_SIZE = 1.2;
const PAYOFF_SIZE = 1.3;
/** The hook fields: the three variants (FORMAT_HOOK_FIELDS) and the hook of a clip cut before its payoff. */
const HOOK_FIELDS = [...Object.values(FORMAT_HOOK_FIELDS), "cliffHook"] as const;
/**
 * The values a format's words are filled with at their longest: the clip's seconds in the long bucket's 90, a count of four
 * digits (a binding's stake: the layers, the bricks), the mascot and a winner of two words.
 */
const LONGEST = { seconds: 90, count: 9999, name: "Gerald", winner: "Harley Quinn" } as const;

const placeholdersOf = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
/** A word that ends a clause (planner.ts CLAUSE_END: a sentence's end or a colon). */
const CLAUSE_END = /[.!?…:]["'”’»)\]]*$/u;
/** Whether a text's two lines break at a clause where it has two (the Simple look breaks a text where a reader would). */
function breaksAtItsClause(text: string, lines: readonly string[]): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  const clauses = words.some((w, i) => i < words.length - 1 && CLAUSE_END.test(w));
  return lines.length < 2 || !clauses || CLAUSE_END.test(lines[0]);
}
const formatsOf = (locale: BotLocale) => (MESSAGES[locale].ViralBot as unknown as { formats: Record<string, Record<string, string>> }).formats;
const modesOf = (format: TemplateFormatId): ModeId[] => BINDINGS.filter((b) => b.format === format).map((b) => b.mode);
/** A format's words for one of its modes, filled as a plan fills them at their longest. */
const filled = (locale: BotLocale, format: TemplateFormatId, field: string, mode: ModeId) => formatText(COPY[locale], format, field, { ...LONGEST, thing: thingOf(COPY[locale], mode) });
const chars = (text: string) => [...text].length;

describe("the formats' words (ViralBot.formats, things and looks)", () => {
  it("has every format's eight fields, a noun for each of the 48 modes and the two looks, in en, pl and es, with plain placeholders only", () => {
    for (const locale of LOCALES) {
      const formats = formatsOf(locale);
      expect([locale, Object.keys(formats)]).toEqual([locale, [...TEMPLATE_FORMAT_IDS]]);
      for (const format of TEMPLATE_FORMAT_IDS) {
        expect([locale, format, Object.keys(formats[format])]).toEqual([locale, format, [...FORMAT_COPY_FIELDS]]);
        for (const field of FORMAT_COPY_FIELDS) {
          const text = formats[format][field];
          const where = `${locale} ${format}.${field}`;
          expect([where, typeof text, text.trim() === text && text.length > 0]).toEqual([where, "string", true]);
          // plain `{name}` placeholders (no ICU plural or select: copy.ts fills them as next-intl does), the formats' own, the same in every locale
          expect(text, where).not.toMatch(/\{\w+\s*,/);
          for (const p of placeholdersOf(text)) expect(FORMAT_PLACEHOLDERS, `${where}: {${p}}`).toContain(p);
          expect([where, placeholdersOf(text)]).toEqual([where, placeholdersOf(formatsOf("en")[format][field])]);
        }
      }
      // a noun for every mode, in MODE_IDS order: one or two words, no placeholder
      const things = (MESSAGES[locale].ViralBot as unknown as { things: Record<string, string> }).things;
      expect([locale, Object.keys(things)]).toEqual([locale, [...MODE_IDS]]);
      for (const mode of MODE_IDS) {
        const thing = thingOf(COPY[locale], mode);
        expect([locale, mode, thing.length > 0, wordCount(thing) <= 2, /[{}]/.test(thing)]).toEqual([locale, mode, true, true, false]);
        expect(copyPath(COPY[locale], thingKeyOf(mode))).toBe(thing);
      }
      // the two looks: a name of one word and one line
      for (const look of BOT_LOOKS) {
        const { name, line } = lookCopy(COPY[locale], look);
        expect([locale, look, wordCount(name), line.length > 20 && line.length <= 80]).toEqual([locale, look, 1, true]);
      }
    }
    // the hook variants are the crew's (the brainstormer pitches a, b or c)
    expect(Object.keys(FORMAT_HOOK_FIELDS)).toEqual([...HOOK_VARIANTS]);
  });

  it("fits every hook in every locale in the Simple look's lines: at most 7 words on 2 lines, 42 characters in English and 52 in Polish and Spanish, on every mode of its format", () => {
    let checked = 0;
    for (const locale of LOCALES) {
      for (const format of TEMPLATE_FORMAT_IDS) {
        for (const field of HOOK_FIELDS) {
          for (const mode of modesOf(format)) {
            const hook = filled(locale, format, field, mode);
            const where = `${locale} ${format}.${field} on ${mode}: "${hook}"`;
            expect(hook.length, where).toBeGreaterThan(0);
            expect(wordCount(hook), where).toBeLessThanOrEqual(SIMPLE_TEXT.hookWordsMax);
            const lines = evenCaptionLines(hook, HOOK_SIZE);
            expect(lines.length, where).toBeLessThanOrEqual(2);
            // at the hook's own size, a hook of two clauses breaks between them ("Out of step." / "Not for long."): no clause wider than a line
            expect([where, lines.join(" / "), breaksAtItsClause(hook, lines)]).toEqual([where, lines.join(" / "), true]);
            expect(chars(hook), where).toBeLessThanOrEqual(HOOK_CHARS[locale]);
            // the Simple look draws it as written (nothing to cut), and it states only the clip's numbers: one, its seconds, its count (G4)
            expect(simpleHookText(hook), where).toBe(hook);
            for (const n of numbersIn(hook)) expect([1, LONGEST.seconds, LONGEST.count], where).toContain(n);
            checked++;
          }
        }
      }
    }
    // 48 modes x 4 hooks x 3 locales
    expect(checked).toBe(MODE_IDS.length * HOOK_FIELDS.length * LOCALES.length);
  });

  it("draws the payoff's words and the closing question in the Simple look's lines, and names each format in a few words", () => {
    for (const locale of LOCALES) {
      for (const format of TEMPLATE_FORMAT_IDS) {
        for (const mode of modesOf(format)) {
          const payoff = filled(locale, format, "payoff", mode);
          const question = filled(locale, format, "cliffQuestion", mode);
          const where = `${locale} ${format} on ${mode}: "${payoff}" / "${question}"`;
          // the payoff: at most 3 words (simplePayoffText leaves it whole), on at most 2 lines
          expect([where, wordCount(payoff) <= SIMPLE_TEXT.payoffWordsMax, simplePayoffText(payoff) === payoff, evenCaptionLines(payoff, PAYOFF_SIZE).length <= 2]).toEqual([where, true, true, true]);
          // the closing question: a question, at most 7 words on 2 lines
          expect([where, /\?/.test(question), wordCount(question) <= SIMPLE_TEXT.hookWordsMax, evenCaptionLines(question, HOOK_SIZE).length <= 2]).toEqual([where, true, true, true]);
          for (const n of numbersIn(`${payoff} ${question}`)) expect([1, LONGEST.count], where).toContain(n);
        }
        const name = formatText(COPY[locale], format, "name");
        expect([locale, format, wordCount(name) <= 3, chars(name) <= 24]).toEqual([locale, format, true, true]);
        expect(formatText(COPY[locale], format, "postQuestion"), `${locale} ${format}`).toMatch(/\?$/);
      }
    }
  });

  it("fills {thing} with its mode's noun, a capital at a sentence's start, and leaves no brace: an unfilled placeholder is no text", () => {
    const thing = (locale: BotLocale, mode: ModeId) => ({ thing: thingOf(COPY[locale], mode) });
    expect(formatText(COPY.en, "getOut", "hook", thing("en", "shatter"))).toBe("Will the ball get out?");
    expect(formatText(COPY.en, "getOut", "cliffHook", thing("en", "shatter"))).toBe("The ball vs the clock.");
    expect(formatText(COPY.pl, "getOut", "hook", thing("pl", "shatter"))).toBe("Piłka w pułapce. Uda się wyjść?");
    expect(formatText(COPY.es, "getOut", "hook", thing("es", "colorMatch"))).toBe("¿Hay salida para la pelota?");
    expect(formatText(COPY.es, "getOut", "cliffHook", thing("es", "journey"))).toBe("Gerald contra el reloj.");
    expect(formatText(COPY.es, "lineUp", "hookB", thing("es", "orbGrid"))).toBe("¿Se alinearán las esferas?");
    expect(formatText(COPY.pl, "fill", "cliffHook", thing("pl", "perfectFit"))).toBe("Klocki kontra ostatnia luka.");
    expect(formatText(COPY.en, "whoWins", "hookC", thing("en", "maze"))).toBe("The balls. Only one wins.");
    // a placeholder without a value, or with an empty one, leaves no text at all
    expect(formatText(COPY.en, "getOut", "hook")).toBe("");
    expect(formatText(COPY.en, "count", "payoff")).toBe("");
    expect(formatText(COPY.en, "count", "payoff", { count: " " })).toBe("");
    expect(formatText(COPY.en, "count", "payoff", { count: 120 })).toBe("120! 🤯");
    expect(formatText(COPY.pl, "whoWins", "payoff", { winner: "Blaze" })).toBe("Blaze wygrywa! 🏆");
    expect(formatText(COPY.es, "whoWins", "payoff", { winner: "Blaze" })).toBe("¡Blaze gana! 🏆");
    // the recipe fields a format has none of: its name as the series, its closing question as a cliffhanger's post question
    expect([formatText(COPY.en, "getOut", "series"), formatText(COPY.en, "getOut", "cliffPostQuestion"), formatText(COPY.en, "getOut", "keywords"), formatText(COPY.en, "getOut", "hashtags")]).toEqual(["Get out", "Out or not? 👇", "", ""]);
    expect(formatText(COPY.en, "nope", "hook", thing("en", "classic"))).toBe("");
  });

  it("keeps the proven templates' own words and gives a template without a recipe its format's: recipeText reads the one the recipe names", () => {
    const own = allTemplates().filter((t) => t.recipe === null);
    const wrapped = allTemplates().filter((t) => t.recipe !== null);
    // (--- templates --- AI studio step 3: and two variants of proven bindings that play their own way, Classic's one ring and Grow's
    // fill that ends the run)
    expect([own.length, wrapped.length]).toEqual([34, 21]);
    for (const t of wrapped) {
      const r = plannedRecipe(t)!;
      expect([t.id, r.formatCopy, recipeCopyPath(r)]).toEqual([t.id, undefined, `recipes.${t.recipe!.copyKey}`]);
      for (const locale of LOCALES) for (const field of ["name", "hook", "payoff", "cliffQuestion", "postQuestion"]) expect(recipeText(COPY[locale], r, field), `${locale} ${t.id}.${field}`).toBe(recipeText(COPY[locale], t.recipe!, field));
    }
    for (const t of own) {
      const r = plannedRecipe(t);
      if (!r) continue; // (an outcome only its own search finds: nothing to plan)
      const s = defaultSettings(t.mode);
      expect([t.id, r.formatCopy, recipeCopyPath(r), r.copyVars?.(s)]).toEqual([t.id, true, `formats.${t.format.id}`, { thing: `things.${t.mode}` }]);
      for (const locale of LOCALES) {
        const vars = { ...LONGEST, ...recipeCopyVars(COPY[locale], r, s) };
        expect(recipeText(COPY[locale], r, "hook", vars), `${locale} ${t.id}`).toBe(filled(locale, t.format.id, "hook", t.mode));
        expect(recipeText(COPY[locale], r, "series"), `${locale} ${t.id}`).toBe(formatText(COPY[locale], t.format.id, "name"));
      }
    }
    // a ready template speaks with its recipe's words, and – --- templates --- (AI studio step 3) one without a recipe with its format's
    for (const t of allTemplates().filter((x) => x.ready)) expect([t.id, templateRecipeById(t.id)!.formatCopy]).toEqual([t.id, t.recipe ? undefined : true]);
    expect(allTemplates().filter((x) => x.ready && !x.recipe).length).toBeGreaterThan(0);
  });

  it("plans a template without a recipe in its format's words, in every locale: its mode's noun in the hook, the cliffhanger's own hook, the post, no brace", () => {
    // (--- templates --- AI studio step 3: Shatter's binding cuts before its escape and asks its format's own hook in either ending,
    // so the cliffhanger's own hook is proven on Shatter's adapter asked for both endings, and on Shatter as it is offered)
    const shatter = templateById("get-out-shatter")!;
    const conveyor = templateById("count-conveyor")!;
    const drawn = (plan: ClipPlan, role: string) => plan.captionRoles.flatMap((r, i) => (r === role ? [plan.settings.captions[i].text] : []));
    const { hookKey: _offered, ...asked } = plannedRecipe(shatter)!;
    const bothEndings = { ...asked, endings: ["resolved", "cliffhanger"] as const };
    expect([_offered, plannedRecipe(shatter)!.endings]).toEqual(["hook", ["cliffhanger"]]);
    for (const locale of LOCALES) {
      const copy = COPY[locale];
      const options = { copy, locale, look: "simple" as const, search: false, episode: 3, index: 1 };
      // the template as it is offered: its format's hook, cut before the escape
      const offered = planClip(plannedRecipe(shatter)!, 2, "shorts", { ...options, template: shatter.id });
      expect([locale, offered.ending, offered.hook]).toEqual([locale, "cliffhanger", formatText(copy, "getOut", "hook", { seconds: offered.settings.recordingDuration, thing: thingOf(copy, "shatter") })]);
      for (const ending of ["resolved", "cliffhanger"] as const) {
        const plan = planClip(bothEndings, 2, "shorts", { ...options, ending, template: shatter.id });
        const where = `${locale} ${shatter.id} ${ending}`;
        const vars = { seconds: plan.settings.recordingDuration, thing: thingOf(copy, "shatter") };
        expect([where, plan.ending]).toEqual([where, ending]);
        expect(plan.hook, where).toBe(formatText(copy, "getOut", ending === "cliffhanger" ? "cliffHook" : "hook", vars));
        // the hook is drawn whole, on at most 2 lines; the series is the format's name; the post opens with the hook
        expect([where, drawn(plan, "hook").join(" "), drawn(plan, "hook").length <= 2]).toEqual([where, plan.hook, true]);
        expect([where, plan.series.name, plan.post.caption.startsWith(plan.hook)]).toEqual([where, formatText(copy, "getOut", "name"), true]);
        if (ending === "cliffhanger") expect([where, drawn(plan, "question").join(" ")]).toEqual([where, formatText(copy, "getOut", "cliffQuestion")]);
        else expect([where, plan.post.question]).toEqual([where, formatText(copy, "getOut", "postQuestion")]);
        expect(JSON.stringify([plan.hook, plan.payoff.text, plan.post, plan.settings.captions]), where).not.toMatch(/\{\w+\}/);
      }
      // a payoff whose number no binding fills yet ("{count}!") draws no words, never a brace
      const count = planClip(plannedRecipe(conveyor)!, 1, "reels", { ...options, template: conveyor.id });
      const where = `${locale} ${conveyor.id}`;
      expect([where, count.hook, count.payoff.text, drawn(count, "payoff")]).toEqual([where, formatText(copy, "count", "hook"), "", []]);
      expect(JSON.stringify([count.post, count.settings.captions]), where).not.toMatch(/\{\w+\}/);
    }
  });

  it("names every template \"{Mode name} · {Format name}\" from the site's mode names, a further variant with its recipe's name, unique in every locale", () => {
    for (const locale of LOCALES) {
      const modes = MESSAGES[locale].Modes as unknown as Record<string, { name: string }>;
      const names = allTemplates().map((t) => templateNameOf(t, COPY[locale], modes[t.mode].name));
      expect(new Set(names).size, locale).toBe(names.length);
      for (const [i, t] of allTemplates().entries()) {
        const base = `${modes[t.mode].name} · ${formatText(COPY[locale], t.format.id, "name")}`;
        // (--- templates --- AI studio step 3: a further variant without a recipe adds its own name, ViralBot.variants)
        const variantName = t.recipe ? recipeText(COPY[locale], t.recipe, "name") : String(copyPath(COPY[locale], `variants.${variantKeyOf(t)}`));
        expect(names[i], `${locale} ${t.id}`).toBe(t.binding.variants[0].id === t.id ? base : `${base} · ${variantName}`);
      }
    }
    const en = (id: string) => templateNameOf(templateById(id)!, COPY.en, (MESSAGES.en.Modes as unknown as Record<string, { name: string }>)[templateById(id)!.mode].name);
    expect([en("get-out-shatter"), en("get-out-classic"), en("get-out-classic-gerald"), en("who-wins-fight-league-upset")]).toEqual(["Shatter · Get out", "Classic · Get out", "Classic · Get out · Gerald escapes", "Fight League · Who wins · Fight upset"]);
    // --- templates --- (AI studio step 3) the variants without a recipe, by their own names, in every locale
    expect([en("get-out-classic-ring"), en("fill-grow-fills")]).toEqual(["Classic · Get out · One ring", "Grow · Fill it · Fill to finish"]);
    for (const locale of LOCALES) {
      const variants = (MESSAGES[locale].ViralBot as unknown as { variants: Record<string, string> }).variants;
      expect([locale, Object.keys(variants)]).toEqual([locale, ["ring", "fills"]]);
      for (const name of Object.values(variants)) expect([locale, name, wordCount(name) <= 4, /[{}]/.test(name)]).toEqual([locale, name, true, false]);
    }
    expect(templateName(COPY.pl, "Rozbicie", "getOut")).toBe("Rozbicie · Ucieczka");
    expect(templateName(COPY.es, " ", "lineUp")).toBe("En línea");
  });
});

/** The string at a dotted path of the copy (copy.ts copyString, read here without it). */
function copyPath(copy: BotCopy, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), copy);
}
