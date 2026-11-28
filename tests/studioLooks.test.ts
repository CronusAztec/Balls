import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { defaultSettings, settingsFromSearchParams, type SimulatorSettings } from "@/lib/settings";
import { clipStartSettings } from "@/lib/clipPacing";
import { DAILY_POOL } from "@/lib/dailyCore";
import { GALLERY } from "@/content/gallery";
import { LOOK_NAMES, looksOf, settingsQueryOf } from "@/content/looks";
import { HERO_BASE_QUERY, HERO_MOMENTS, cardHref, cardQuery, heroQuery } from "@/lib/thumbnails/heroMoments";
import { activeLook, cardLinkPatch, lookPatch, lookRow, lookSettings, selectedMode } from "@/lib/studioLooks";
import { MAKE_CLIP_ENDING, makeClipPick, makeClipTemplates, wantsMadeClip } from "@/lib/bot/makeClip";
import { planTemplate } from "@/lib/bot/planner";
import { readyTemplates, templateById, templatePlayOf } from "@/lib/bot/templates";
import { BOT_DEFAULT_FAMILIES } from "@/lib/bot/playbook";
import type { BotCopy } from "@/lib/bot/copy";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- card-looks --- --- studio-looks --- --- make-clip --- A mode card opens the look its picture shows (heroMoments.ts
 * cardQuery), the studio's Looks row puts a mode's looks on through the panel's update path (src/content/looks.ts,
 * lib/studioLooks.ts), and "Make me a clip" picks a ready template to plan (lib/bot/makeClip.ts).
 */

const pairs = (query: string) => [...new URLSearchParams(query).entries()];
const startLook = (mode: ModeId): SimulatorSettings => ({ ...defaultSettings(mode), ...clipStartSettings(mode) });

describe("the mode cards' links (card-looks)", () => {
  it("open every mode with the shared look, the card's settings and the picture's seed unless the card leaves it out", () => {
    for (const id of MODE_IDS) {
      const e = HERO_MOMENTS[id];
      const params = new URLSearchParams(cardQuery(id));
      expect(params.get("mode"), id).toBe(id);
      expect(params.get("seed"), id).toBe(e.cardSeed === false ? null : String(e.seed));
      for (const [key, value] of pairs(HERO_BASE_QUERY)) expect(params.get(key), `${id} ${key}`).toBe(value);
      for (const [key, value] of pairs(e.card ?? e.query)) expect(params.getAll(key), `${id} ${key}`).toEqual([value]);
      expect(cardHref(id)).toBe(`/simulator?${cardQuery(id)}`);
      const s = settingsFromSearchParams(params);
      expect(s.mode, id).toBe(id);
      expect(s.showGlow && s.showTrails, id).toBe(true);
      expect(s.watermarkText + s.topText + s.bottomText, id).toBe("");
      expect(s.captions ?? [], id).toEqual([]);
    }
  });

  it("a card's own settings name no mode, seed or shared key, and every key changes the mode's settings (no typo, no no-op)", () => {
    const own = MODE_IDS.filter((id) => HERO_MOMENTS[id].card !== undefined);
    expect(own.length).toBeGreaterThan(10);
    for (const id of own) {
      const card = HERO_MOMENTS[id].card ?? "";
      const keys = pairs(card).map(([k]) => k);
      for (const banned of ["mode", "seed", "cap", "top", "bottom", "wm", ...pairs(HERO_BASE_QUERY).map(([k]) => k)]) expect(keys, `${id} sets ${banned}`).not.toContain(banned);
      const plain = settingsFromSearchParams(new URLSearchParams(`mode=${id}`));
      for (const [key, value] of pairs(card)) {
        const one = new URLSearchParams(`mode=${id}`);
        one.set(key, value);
        expect(settingsFromSearchParams(one), `${id}: ${key}=${value} changes nothing`).not.toEqual(plain);
      }
    }
  });

  it("Classic's and Accumulation's cards carry the start look's pace: their link base runs past the clip", () => {
    for (const id of ["classic", "accumulation"] as const) {
      const s = settingsFromSearchParams(new URLSearchParams(cardQuery(id)));
      for (const [key, value] of Object.entries(clipStartSettings(id))) expect(s[key as keyof SimulatorSettings], `${id} ${key}`).toEqual(value);
    }
  });

  // --- review fix (D1) --- a card is a link, read as written: a mode the page starts in a look of its own (clipStartSettings) opens
  // that look from its card too (the Beat Machine's card opened the seeded phrase with no tune, counter or chord, the Wave Tank's on
  // one gap), and keeps the loop HUD that carries the start look's counter
  it("opens every mode with a start look in that look, the loop HUD on where the start look leaves it", () => {
    const staged = MODE_IDS.filter((id) => Object.keys(clipStartSettings(id)).length > 0);
    expect(staged).toEqual(expect.arrayContaining(["classic", "accumulation", "waveTank", "beatMachine"]));
    // --- pace-as-look --- (round two A3a) a paced mode's start look is its pace, and its card names it; three cards play their
    // picture's own value of one field instead (Beat Runner's density 1, the Journey's four stages, the Maze's 12 columns, the
    // link base's), which the picker's patch carries onto the start look. (--- card-looks --- round two A5: Bullseye's card plays
    // the start look's ten shots with the last one in the bull; its picture's bull on shot 2 ended the run in about 9 s)
    expect(staged).toEqual(expect.arrayContaining(["race", "pendulum", "maze", "runner"]));
    const CARD_OWN: Partial<Record<ModeId, Partial<SimulatorSettings>>> = { runner: { runnerDensity: 1 }, journey: { journeyStages: "rings-l,glass,pegs,home" }, maze: { mzCols: 12 } };
    for (const id of staged) {
      const s = settingsFromSearchParams(new URLSearchParams(cardQuery(id)));
      const own = (CARD_OWN[id] ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(clipStartSettings(id))) expect(s[key as keyof SimulatorSettings], `${id} ${key}`).toEqual(key in own ? own[key] : value);
      expect(cardLinkPatch(id, cardQuery(id)).patch, id).toMatchObject(own);
      if (clipStartSettings(id).loopHud === undefined) expect([id, s.loopHud]).toEqual([id, startLook(id).loopHud]);
    }
  });

  // --- card-words --- (round two A5) a card opens the first visit's words in every mode, not only in a mode with a start look:
  // the loop HUD's title and counter, String Battle's, the Maze's, the Orbs' and Land Claim's HUD, and Power Layers' rule pills and
  // sound badge. Ten cards took their picture's HUD-off keys and opened without them (final review: m3-cards-hud-off,
  // modes-missed-17, m1-card-route-loses-words), the picture's clean look leaking into the link: the picture keeps it (`query`),
  // the card leaves it out
  it("keeps the first visit's HUD on every mode's card", () => {
    const HUD = ["loopHud", "sbHud", "mzHud", "ogHud", "lcHud", "plPills", "plBadge"] as const;
    // --- card-words --- (round two A-g3 review) every other HUD switch and HUD title too, so another HUD-off key of a picture
    // cannot leak into its card unseen. Four dressings stay as the picture has them, by the plan (A5): the Maze's flashing-lights
    // badge (mzbg=0, a style point on the later list: m3-maze-polish), Territory's (tybg=0: its card is its picture's query) and
    // Land Claim's ball names and scoreboard (tn=0, tsb=0: A5 took only the picture's lch=0 out of its card)
    const MORE_HUD = ["loopHudTitle", "loopHudSubtitle", "sbBadge", "sbTitle", "journeyHud", "sgHud", "tyHud", "tyBadge", "flHud", "bounceMathHud", "mzBadge", "efCounter", "bmCounter", "wtLabel", "rcCupTitle", "lcTitle", "nameLabel", "showBallNames", "showScoreboard"] as const;
    const PICTURE_DRESSING: Partial<Record<ModeId, readonly (typeof MORE_HUD)[number][]>> = { maze: ["mzBadge"], territory: ["tyBadge"], landClaim: ["showBallNames", "showScoreboard"] };
    for (const id of MODE_IDS) {
      const s = settingsFromSearchParams(new URLSearchParams(cardQuery(id)));
      const first = startLook(id);
      for (const key of HUD) expect([id, key, s[key]]).toEqual([id, key, first[key]]);
      const picture = settingsFromSearchParams(new URLSearchParams(heroQuery(id)));
      for (const key of MORE_HUD) expect([id, key, s[key]]).toEqual([id, key, (PICTURE_DRESSING[id]?.includes(key) ? picture : first)[key]]);
    }
    // each kept dressing is one the picture turns off: none is a stale exception that would excuse a card
    for (const [id, keys] of Object.entries(PICTURE_DRESSING) as [ModeId, readonly (typeof MORE_HUD)[number][]][]) {
      const picture = settingsFromSearchParams(new URLSearchParams(heroQuery(id)));
      for (const key of keys) expect([id, key, picture[key]]).not.toEqual([id, key, startLook(id)[key]]);
    }
  });
});

describe("the select-mode event's detail (card-looks)", () => {
  it("reads a mode id and a card's mode with its link, and nothing else", () => {
    expect(selectedMode("portal")).toEqual({ mode: "portal", look: null });
    expect(selectedMode({ mode: "portal", look: cardQuery("portal") })).toEqual({ mode: "portal", look: cardQuery("portal") });
    expect(selectedMode({ mode: "portal" })).toEqual({ mode: "portal", look: null });
    for (const bad of ["nope", 3, null, undefined, {}, { mode: "nope", look: "x" }]) expect(selectedMode(bad)).toBeNull();
  });

  it("puts a card's settings on top of the mode the page switched to, and pins its seed", () => {
    for (const id of MODE_IDS) {
      const { patch, seed } = cardLinkPatch(id, cardQuery(id));
      expect(seed, id).toBe(HERO_MOMENTS[id].cardSeed === false ? null : HERO_MOMENTS[id].seed);
      const base = defaultSettings(id);
      const opened = { ...base, ...patch };
      expect(opened, id).toEqual(settingsFromSearchParams(new URLSearchParams(cardQuery(id))));
      // --- pace-as-look --- (round two A3a) a key of the patch differs from the link base or from the start look the page is in,
      // and on the start look the patch opens the card's own run (the picker plays what the wall's card link plays)
      const start = startLook(id);
      for (const key of Object.keys(patch) as (keyof SimulatorSettings)[]) expect([patch[key], patch[key]], `${id} ${key}`).not.toEqual([base[key], start[key]]);
      expect({ ...start, ...patch }, id).toEqual(settingsFromSearchParams(new URLSearchParams(cardQuery(id))));
      expect(opened.showTrails && opened.showGlow, id).toBe(true);
    }
  });
});

describe("the studio's Looks row (studio-looks)", () => {
  it("lists Plain, the card's look, the mode's gallery presets and its daily challenge's look, named in every language", () => {
    for (const id of MODE_IDS) {
      const looks = looksOf(id);
      expect(looks[0].kind, id).toBe("plain");
      expect(looks[1], id).toMatchObject({ kind: "card", query: [HERO_BASE_QUERY, HERO_MOMENTS[id].card ?? HERO_MOMENTS[id].query].filter(Boolean).join("&") });
      expect(looks.filter((l) => l.kind === "gallery").map((l) => l.id), id).toEqual(GALLERY.filter((p) => p.mode === id).map((p) => p.id));
      expect(looks.some((l) => l.kind === "daily"), id).toBe(DAILY_POOL.some((d) => d.mode === id));
      expect(new Set(looks.map((l) => l.id)).size, id).toBe(looks.length);
      for (const look of looks) {
        expect(new URLSearchParams(look.query).has("mode") || new URLSearchParams(look.query).has("seed"), `${id} ${look.id}`).toBe(false);
        for (const locale of routing.locales) expect(look.name[locale]?.trim().length, `${id} ${look.id} ${locale}`).toBeGreaterThan(2);
      }
    }
    expect(settingsQueryOf("mode=classic&wc=8&seed=7")).toBe("wc=8");
  });

  it("names its own looks as the copy style asks: short, every language its own, no dash or semicolon", () => {
    for (const name of Object.values(LOOK_NAMES)) {
      for (const locale of routing.locales) {
        expect([...name[locale]].length, name.en).toBeLessThanOrEqual(20);
        expect(name[locale], name.en).not.toMatch(/[—;]| – /);
      }
      expect(name.pl).not.toBe(name.en);
      expect(name.es).not.toBe(name.en);
    }
  });

  it("Plain is the page's start look, any other look its link read on the mode's link base", () => {
    expect(lookSettings("classic", { kind: "plain", query: "" })).toEqual(startLook("classic"));
    expect(lookSettings("pendulum", { kind: "card", query: "pwn=20" }).pwCount).toBe(20);
    expect(lookSettings("pendulum", { kind: "card", query: "" })).toEqual(defaultSettings("pendulum"));
  });

  it("every look of every mode goes on by its patch, shows as the one on, and Plain takes the row's fields back to the start look", () => {
    for (const id of MODE_IDS) {
      const row = lookRow(id);
      expect(row.looks.length, id).toBeGreaterThanOrEqual(2);
      expect(row.keys.length, id).toBeGreaterThan(0);
      const plain = startLook(id);
      expect(activeLook(row, plain), id).toBe("plain");
      for (const look of row.looks) {
        const patch = lookPatch(row, look, plain);
        for (const key of Object.keys(patch)) expect(row.keys, `${id} ${look.id} ${key}`).toContain(key);
        const on = { ...plain, ...patch };
        expect(activeLook(row, on), `${id} ${look.id}`).toBe(look.id);
        expect(lookPatch(row, look, on), `${id} ${look.id} on already`).toEqual({});
        const back = { ...on, ...lookPatch(row, row.looks[0], on) };
        for (const key of row.keys) expect(back[key], `${id} ${look.id} back ${key}`).toEqual(plain[key]);
      }
      // (a field the visitor changed that no look sets stays; a look's field changed by hand leaves no look on)
      const own = { ...plain, topText: "Mine" };
      expect(lookPatch(row, row.looks[1], own).topText, id).toBeUndefined();
    }
  });

  it("shows a look once when two come out the same, and none while the visitor has changed one of the row's fields", () => {
    const row = lookRow("pendulum");
    const card = row.looks.find((l) => l.id === "card")!;
    const on = { ...startLook("pendulum"), ...lookPatch(row, card, startLook("pendulum")) };
    expect(activeLook(row, { ...on, pwCount: on.pwCount + 1 })).toBeNull();
    expect(activeLook(row, { ...on, mode: "classic" })).toBeNull();
    for (const id of MODE_IDS) {
      const looks = lookRow(id).looks;
      const keys = lookRow(id).keys;
      for (let i = 0; i < looks.length; i++) for (let j = i + 1; j < looks.length; j++) expect(keys.every((k) => JSON.stringify(looks[i].settings[k]) === JSON.stringify(looks[j].settings[k])), `${id} ${looks[i].id} = ${looks[j].id}`).toBe(false);
    }
  });
});

describe("Make me a clip (make-clip)", () => {
  const COPY = { en: en.ViralBot as BotCopy, pl: pl.ViralBot as BotCopy, es: es.ViralBot as BotCopy };

  it("plans one of the mode's own ready templates, those that end resolved first, on every platform they play", () => {
    for (const id of MODE_IDS) {
      const own = readyTemplates("all").filter((t) => t.mode === id && templatePlayOf(t.id)?.platforms.includes("reels"));
      const { own: isOwn, ids } = makeClipTemplates(id, "reels");
      expect(isOwn, id).toBe(own.length > 0);
      expect(ids.length, id).toBeGreaterThan(0);
      if (isOwn) {
        expect([...ids].sort(), id).toEqual(own.map((t) => t.id).sort());
        const resolved = ids.map((t) => templatePlayOf(t)!.endings.includes(MAKE_CLIP_ENDING));
        expect(resolved, id).toEqual([...resolved].sort((a, b) => Number(b) - Number(a)));
      }
    }
  });

  it("gives a mode without a template another mode's, from the daily bot's series, that ends resolved", () => {
    const without = MODE_IDS.filter((id) => !makeClipTemplates(id, "reels").own);
    expect(without.length).toBeGreaterThan(0);
    for (const id of without) {
      for (const t of makeClipTemplates(id, "reels").ids) {
        const info = templateById(t)!;
        expect(info.mode, `${id} ${t}`).not.toBe(id);
        expect(BOT_DEFAULT_FAMILIES, `${id} ${t}`).toContain(info.family);
        expect(templatePlayOf(t)!.endings, `${id} ${t}`).toContain(MAKE_CLIP_ENDING);
      }
    }
  });

  it("is the same press for the same turn and salt, and Another moves on to the mode's next template and a new plan seed", () => {
    const first = makeClipPick("classic", "reels", 0, "abc")!;
    expect(makeClipPick("classic", "reels", 0, "abc")).toEqual(first);
    expect(first).toMatchObject({ mode: "classic", own: true, template: makeClipTemplates("classic", "reels").ids[0] });
    const next = makeClipPick("classic", "reels", 1, "abc")!;
    expect(next.planSeed).not.toBe(first.planSeed);
    const ids = makeClipTemplates("classic", "reels").ids;
    expect(next.template).toBe(ids[1 % ids.length]);
    const lines = MODE_IDS.find((id) => !makeClipTemplates(id, "reels").own)!;
    const other = makeClipPick(lines, "reels", 0, "abc")!;
    expect(other.own).toBe(false);
    expect(other.mode).not.toBe(lines);
  });

  it("plans a clip it can open: the template's mode, a pinned seed, a hook and a whole clip length", () => {
    const pick = makeClipPick("polyrhythm", "reels", 0, "test")!;
    const clip = planTemplate(pick.template, pick.planSeed, "reels", { copy: COPY.en, ending: MAKE_CLIP_ENDING, maxSeeds: 2 });
    expect(clip.settings.mode).toBe("polyrhythm");
    expect(Number.isInteger(clip.seed)).toBe(true);
    expect(clip.hook.trim().length).toBeGreaterThan(3);
    expect(Number.isInteger(clip.settings.recordingDuration)).toBe(true);
    expect(clip.settings.recordingDuration).toBe(clip.timing.recordingDuration);
    expect(clip.look).toBe("simple");
    expect(clip.settings.topText + clip.settings.bottomText).toBe("");
  });

  it("reads the studio address's switch", () => {
    expect(wantsMadeClip("?make=1")).toBe(true);
    expect(wantsMadeClip("mode=classic&make=1")).toBe(true);
    for (const search of ["", "?make=0", "?make", "?mode=classic"]) expect(wantsMadeClip(search)).toBe(false);
  });
});
