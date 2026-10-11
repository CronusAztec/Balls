import { SITE_SLUG } from "@/lib/site";
import { FL_STRENGTH } from "./fightLeagueRatings";
import { FL_CONFERENCES, FL_CONFERENCE_IDS, FL_DIVISIONS, fightersOf, isFlConference, isFlDivision, type FlConference, type FlDivision, type FlFighterRow } from "./fightLeagueRoster";

/*
 * --- fl-overhaul --- (Stage 6) The tier list card's layout (pure: no DOM). A division's or a conference's fighters ranked by
 * their round-robin win share in the balance tuner's duels (`FL_STRENGTH[id].win`, Stage 2's ratings – the same numbers the
 * win chance reads) and cut into five rows by rank quantiles: the top 15 % S, the next 20 % A, the middle 30 % B, the next
 * 20 % C, the bottom 15 % D. The cut is symmetric (a rank's share is measured from the nearer end, so a division has as many
 * S as D and as many A as C). Each fighter is placed exactly once – a mini ball in its colours and look, its short name and its
 * win share – in rows that wrap to more lines when a conference fills them. The card is drawn by `tierCard()` in
 * components/simulator/fightLeague/cards.ts at 1080 × 1350 (a feed post) or 1080 × 1920 (a story): its title
 * "<Division> tier list (Fight League sim)", the disclaimer line, no logo and no reference branding.
 */

export const FL_TIERS = ["S", "A", "B", "C", "D"] as const;
export type FlTier = (typeof FL_TIERS)[number];
/** Each tier's share of the ranking, top to bottom. */
export const FL_TIER_SHARES: Readonly<Record<FlTier, number>> = { S: 0.15, A: 0.2, B: 0.3, C: 0.2, D: 0.15 };
/** The tier rows' colours (our own; dark ink text on each). */
export const FL_TIER_COLORS: Readonly<Record<FlTier, string>> = { S: "#ff7a7a", A: "#ffb35c", B: "#ffe066", C: "#a3e635", D: "#7cc7ff" };

export const FL_TIER_SIZES = { post: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 } } as const;
export type FlTierSize = keyof typeof FL_TIER_SIZES;

export type FlTierGroup = { kind: "division"; id: FlDivision } | { kind: "conference"; id: FlConference };

/** The groups a tier list can be made of: every division with two fighters or more, then the conferences. */
export function flTierGroups(): FlTierGroup[] {
  const out: FlTierGroup[] = [];
  for (const id of FL_DIVISIONS) if (fightersOf(id).length >= 2) out.push({ kind: "division", id });
  for (const id of FL_CONFERENCE_IDS) out.push({ kind: "conference", id });
  return out;
}

/** "division:marvel" / "conference:comics". */
export function flTierGroupKey(group: FlTierGroup): string {
  return `${group.kind}:${group.id}`;
}

export function parseFlTierGroup(value: unknown): FlTierGroup | null {
  if (typeof value !== "string") return null;
  const [kind, id] = value.split(":");
  if (kind === "division" && isFlDivision(id)) return { kind, id };
  if (kind === "conference" && isFlConference(id)) return { kind, id };
  return null;
}

/** The fighters of a group in roster order. */
export function flTierGroupRows(group: FlTierGroup): FlFighterRow[] {
  if (group.kind === "division") return [...fightersOf(group.id)];
  return (FL_CONFERENCES[group.id] as readonly FlDivision[]).flatMap((d) => [...fightersOf(d)]);
}

/**
 * The tier of rank `rank` (0 the best) of `n`: its percentile (rank + 0.5) / n, taken from the nearer end – the top half
 * against S (< 15 %) and A (< 35 %), the bottom half against D and C the same way – so the cut is symmetric.
 */
export function flTierOfRank(rank: number, n: number): FlTier {
  const p = (rank + 0.5) / Math.max(1, n);
  if (p <= 0.5) return p < FL_TIER_SHARES.S ? "S" : p < FL_TIER_SHARES.S + FL_TIER_SHARES.A ? "A" : "B";
  const q = 1 - p;
  return q < FL_TIER_SHARES.D ? "D" : q < FL_TIER_SHARES.D + FL_TIER_SHARES.C ? "C" : "B";
}

export interface FlTierEntry {
  row: FlFighterRow;
  /** Its round-robin win share (%), and whether it is an estimate (a fighter the tuner never rated: 50 %). */
  win: number;
  est: boolean;
  rank: number;
  tier: FlTier;
}

/** The ranked entries of some fighters: by win share, then strength, then roster order (stable). */
export function flTierEntries(rows: readonly FlFighterRow[]): FlTierEntry[] {
  const scored = rows.map((row, i) => {
    const r = FL_STRENGTH[row.id];
    return { row, win: r ? r.win : 50, strength: r ? r.strength : 1, est: !r, i };
  });
  scored.sort((a, b) => b.win - a.win || b.strength - a.strength || a.i - b.i);
  return scored.map((s, rank) => ({ row: s.row, win: s.win, est: s.est, rank, tier: flTierOfRank(rank, scored.length) }));
}

/** A cell's height in ball radii: the crest above the ball (FL_TIER_ABOVE), the ball, the name and the share (FL_TIER_BELOW). */
export const FL_TIER_ABOVE = 1.6;
export const FL_TIER_BELOW = 2.5;
export const FL_TIER_CELL_H = FL_TIER_ABOVE + FL_TIER_BELOW;

export interface FlTierCell {
  entry: FlTierEntry;
  /** The ball's centre and radius (card px). */
  x: number;
  y: number;
  r: number;
}

export interface FlTierRowLayout {
  tier: FlTier;
  /** The row's band (card px): the label box on the left, the cells right of it. */
  y: number;
  h: number;
  cells: FlTierCell[];
}

export interface FlTierLayout {
  width: number;
  height: number;
  group: FlTierGroup;
  /** The margins and the label column (card px). */
  pad: number;
  labelW: number;
  /** The title's baseline centre and font size; the disclaimer's. */
  titleY: number;
  titleSize: number;
  subtitleY: number;
  subtitleSize: number;
  footerY: number;
  footerSize: number;
  /** The cells' name and number font sizes. */
  nameSize: number;
  winSize: number;
  rows: FlTierRowLayout[];
  /** Every fighter of the group, ranked. */
  entries: FlTierEntry[];
}

/**
 * Lays out the card of `group` at `width` × `height`: the title band, five tier rows sharing the height by the lines their
 * fighters need (the biggest ball that fits every row – at most 0.055 of the width), the disclaimer at the bottom.
 */
export function flTierLayout(group: FlTierGroup, width: number, height: number): FlTierLayout {
  const entries = flTierEntries(flTierGroupRows(group));
  const pad = Math.round(0.04 * width);
  const titleSize = Math.round(0.052 * width);
  const subtitleSize = Math.round(0.024 * width);
  const footerSize = Math.round(0.019 * width);
  const titleY = pad + titleSize;
  const subtitleY = titleY + 1.5 * subtitleSize;
  const top = subtitleY + 1.4 * subtitleSize;
  const footerY = height - pad;
  const bottom = footerY - 2.2 * footerSize;
  const labelW = Math.round(0.13 * width);
  const gap = Math.round(0.008 * height);
  const areaW = width - 2 * pad - labelW - gap;
  const areaH = bottom - top - (FL_TIERS.length - 1) * gap;
  const byTier = FL_TIERS.map((tier) => entries.filter((e) => e.tier === tier));
  // the biggest ball radius r with every row's lines fitting: a cell is 2.9 r wide and FL_TIER_CELL_H r tall – the crest
  // (up to 1.5 r above the centre), the ball, the name and the win share (down to 2.45 r below it)
  let r = 0.055 * width;
  let cols = 1;
  let lines: number[] = [];
  for (let guard = 0; guard < 200; guard++) {
    cols = Math.max(1, Math.floor(areaW / (2.9 * r)));
    lines = byTier.map((t) => Math.max(1, Math.ceil(t.length / cols)));
    const need = lines.reduce((a, b) => a + b, 0) * FL_TIER_CELL_H * r;
    if (need <= areaH || r < 6) break;
    r *= 0.95;
  }
  const lineH = FL_TIER_CELL_H * r;
  const spare = Math.max(0, areaH - lines.reduce((a, b) => a + b, 0) * lineH);
  const totalLines = lines.reduce((a, b) => a + b, 0);
  const rows: FlTierRowLayout[] = [];
  let y = top;
  FL_TIERS.forEach((tier, k) => {
    const h = lines[k] * lineH + (spare * lines[k]) / totalLines;
    const cells: FlTierCell[] = [];
    const list = byTier[k];
    const perLine = Math.min(cols, Math.max(1, list.length));
    list.forEach((entry, i) => {
      const line = Math.floor(i / cols);
      const col = i % cols;
      const inLine = Math.min(perLine, list.length - line * cols);
      const cellW = areaW / Math.max(cols, 1);
      const left = pad + labelW + gap + (areaW - inLine * cellW) / 2;
      const rowH = h / lines[k];
      cells.push({ entry, x: left + (col + 0.5) * cellW, y: y + line * rowH + (rowH - lineH) / 2 + FL_TIER_ABOVE * r, r });
    });
    rows.push({ tier, y, h, cells });
    y += h + gap;
  });
  return { width, height, group, pad, labelW, titleY, titleSize, subtitleY, subtitleSize, footerY, footerSize, nameSize: Math.max(10, 0.62 * r), winSize: Math.max(9, 0.5 * r), rows, entries };
}

/** The card's file name: `<site>-fight-league-tier-<group>-<w>x<h>.png` (SITE_SLUG names every download). */
export function flTierFileName(group: FlTierGroup, width: number, height: number): string {
  return `${SITE_SLUG}-fight-league-tier-${group.id.toLowerCase()}-${width}x${height}.png`;
}

/** A win share as the card writes it: a whole percent. */
export function flTierWinText(entry: Pick<FlTierEntry, "win" | "est">): string {
  return `${Math.round(entry.win)}%${entry.est ? "*" : ""}`;
}
