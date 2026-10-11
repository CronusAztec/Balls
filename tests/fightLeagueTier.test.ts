import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { FL_STRENGTH } from "@/lib/physics/modes/fightLeagueRatings";
import { flShortName } from "@/lib/physics/modes/fightLeagueRoster";
import {
  FL_TIER_ABOVE,
  FL_TIER_BELOW,
  FL_TIERS,
  FL_TIER_SIZES,
  flTierEntries,
  flTierFileName,
  flTierGroupKey,
  flTierGroupRows,
  flTierGroups,
  flTierLayout,
  flTierOfRank,
  flTierWinText,
  parseFlTierGroup,
  type FlTier,
  type FlTierGroup,
} from "@/lib/physics/modes/fightLeagueTier";
import { tierCard } from "@/components/simulator/fightLeague/cards";
import { SITE_SLUG } from "@/lib/site";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- fl-overhaul --- (Stage 6) The tier list card: the S–D rows by rank quantiles of the tuner's round-robin win shares (top 15 %
 * S, next 20 % A, middle 30 % B, next 20 % C, bottom 15 % D – symmetric), every fighter placed once at both sizes, the card drawn
 * into a fake canvas without a throw (no image, no logo), and its words in the three languages.
 */

const count = (tiers: FlTier[], t: FlTier) => tiers.filter((x) => x === t).length;
const tiersOf = (n: number) => Array.from({ length: n }, (_, r) => flTierOfRank(r, n));
const LOCALES = { en, pl, es } as const;
const labels = (locale: keyof typeof LOCALES, group: string) => {
  const c = LOCALES[locale].Controls as Record<string, string>;
  return { title: String(new IntlMessageFormat(c.flTierTitle, locale).format({ group })), subtitle: c.flTierSubtitle, disclaimer: c.flTierDisclaimer };
};

describe("the tier quantiles", () => {
  it("cuts a ranking 15 / 20 / 30 / 20 / 15 %, the same from both ends", () => {
    expect(tiersOf(10)).toEqual(["S", "A", "A", "B", "B", "B", "B", "C", "C", "D"]);
    const thirty = tiersOf(30);
    expect(FL_TIERS.map((t) => count(thirty, t))).toEqual([4, 6, 10, 6, 4]);
    expect(FL_TIERS.map((t) => count(tiersOf(20), t))).toEqual([3, 4, 6, 4, 3]);
    for (let n = 1; n <= 80; n++) {
      const t = tiersOf(n);
      expect(count(t, "S"), `n ${n}`).toBe(count(t, "D"));
      expect(count(t, "A"), `n ${n}`).toBe(count(t, "C"));
      // in rank order, never back up a tier
      for (let r = 1; r < n; r++) expect(FL_TIERS.indexOf(t[r]), `n ${n} rank ${r}`).toBeGreaterThanOrEqual(FL_TIERS.indexOf(t[r - 1]));
      if (n >= 20) {
        expect(Math.abs(count(t, "S") - 0.15 * n), `n ${n}`).toBeLessThanOrEqual(1);
        expect(Math.abs(count(t, "S") + count(t, "A") - 0.35 * n), `n ${n}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("ranks a group by the tuner's round-robin win share (then strength, then roster order)", () => {
    const group: FlTierGroup = { kind: "division", id: "marvel" };
    const entries = flTierEntries(flTierGroupRows(group));
    expect(entries).toHaveLength(flTierGroupRows(group).length);
    for (let i = 1; i < entries.length; i++) expect(entries[i].win).toBeLessThanOrEqual(entries[i - 1].win);
    for (const e of entries) expect(e.win).toBe(FL_STRENGTH[e.row.id]?.win ?? 50);
    expect(entries.map((e) => e.tier)).toEqual(tiersOf(entries.length));
    expect(flTierWinText({ win: 57, est: false })).toBe("57%");
    expect(flTierWinText({ win: 50, est: true })).toBe("50%*");
  });

  it("offers every division with two fighters or more, then the five genres, and reads their keys back", () => {
    const groups = flTierGroups();
    expect(groups.filter((g) => g.kind === "conference")).toHaveLength(5);
    expect(groups.some((g) => g.kind === "division" && g.id === "wildcard")).toBe(false);
    for (const g of groups) expect(parseFlTierGroup(flTierGroupKey(g))).toEqual(g);
    expect(parseFlTierGroup("division:nope")).toBeNull();
    expect(parseFlTierGroup(42)).toBeNull();
    expect(flTierFileName({ kind: "division", id: "starWars" }, 1080, 1350)).toBe(`${SITE_SLUG}-fight-league-tier-starwars-1080x1350.png`);
  });
});

describe("the tier list card", () => {
  it("places every fighter of every group exactly once, inside its row and the card, at both sizes", () => {
    for (const group of flTierGroups()) {
      const ids = flTierGroupRows(group).map((r) => r.id);
      for (const size of Object.values(FL_TIER_SIZES)) {
        const L = flTierLayout(group, size.width, size.height);
        const placed = L.rows.flatMap((row) => row.cells.map((c) => c.entry.row.id));
        const where = `${flTierGroupKey(group)} ${size.width}x${size.height}`;
        expect([...placed].sort(), where).toEqual([...ids].sort());
        expect(L.rows.map((r) => r.tier), where).toEqual([...FL_TIERS]);
        for (const row of L.rows) {
          expect(row.y + row.h, where).toBeLessThan(L.footerY);
          for (const c of row.cells) {
            expect(c.entry.tier, where).toBe(row.tier);
            expect(c.x - c.r, where).toBeGreaterThan(L.pad + L.labelW);
            expect(c.x + c.r, where).toBeLessThan(size.width - L.pad);
            expect(c.y - FL_TIER_ABOVE * c.r, where).toBeGreaterThanOrEqual(row.y - 1e-6);
            expect(c.y + FL_TIER_BELOW * c.r, where).toBeLessThanOrEqual(row.y + row.h + 1e-6);
          }
          // no two balls of a row overlap
          for (let i = 0; i < row.cells.length; i++) for (let j = i + 1; j < row.cells.length; j++) expect(Math.hypot(row.cells[i].x - row.cells[j].x, row.cells[i].y - row.cells[j].y), where).toBeGreaterThan(2 * row.cells[i].r);
        }
      }
    }
  });

  it("draws into a fake canvas without a throw: every fighter's name once, the title and the disclaimer, no image", () => {
    for (const group of [{ kind: "division", id: "marvel" }, { kind: "conference", id: "games" }] as FlTierGroup[]) {
      for (const size of Object.values(FL_TIER_SIZES)) {
        const canvas = fakeCanvas(size.width, size.height);
        const words = labels("en", group.id === "marvel" ? "Marvel" : "Video games");
        const L = tierCard(canvas.ctx as unknown as CanvasRenderingContext2D, group, size, words);
        const texts = canvas.ctx.calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
        for (const row of L.rows) for (const cell of row.cells) expect(texts.filter((t) => t === flShortName(cell.entry.row)).length, cell.entry.row.id).toBeGreaterThanOrEqual(1);
        expect(texts.filter((t) => FL_TIERS.includes(t as FlTier))).toHaveLength(5);
        expect(texts).toContain(words.title);
        expect(texts).toContain(words.disclaimer);
        expect(canvas.ctx.calls.filter((c) => c.name === "drawImage")).toHaveLength(0);
        expect(canvas.ctx.calls.filter((c) => c.name === "save").length).toBe(canvas.ctx.calls.filter((c) => c.name === "restore").length);
        for (const t of texts) expect(t.toLowerCase()).not.toMatch(/ballthing|tiktok|instagram/);
      }
    }
  });

  it("names the card in en, pl and es: the group, the sim, the disclaimer", () => {
    for (const locale of ["en", "pl", "es"] as const) {
      const w = labels(locale, "Marvel");
      expect(w.title, locale).toContain("Marvel");
      expect(w.title, locale).toContain("Fight League");
      expect(w.subtitle.length, locale).toBeGreaterThan(10);
      expect(w.disclaimer.length, locale).toBeGreaterThan(20);
      for (const k of ["flTierList", "flTierListTip", "flTierDivisions", "flTierConferences", "flTierPost", "flTierStory"]) expect((LOCALES[locale].Controls as Record<string, string>)[k], `${locale} ${k}`).toBeTruthy();
    }
  });
});
