import { flWinnerShownMs, type FightLeagueView } from "@/lib/physics/modes/fightLeague";
import { flNameColor, flPlateLayout } from "@/lib/physics/modes/fightLeagueFx";
import type { FightLeagueLabels } from "./frame";
import { INK } from "./palette";
import type { FlTextCache, FlTextStyle } from "./text";

/**
 * --- fl-overhaul --- (Stage 3) The portrait plates of a 9:16 export: in the bars above and below the exported square
 * (drawn through the recorder's background hook, before the square and the watermark – which they never cover), at least 6 %
 * from the frame's edges and never over the square (the owner's Top / Bottom Text lives inside it): on top "THOR vs LOKI" in
 * the fighters' colours with the division under it, at the bottom "WHO WINS?" during the fight, "SUDDEN DEATH" while the
 * arena shrinks and "[name] WINS" once the verdict's card is up. No wordmark, no reference branding.
 */

const SEP = " vs ";

/**
 * Draws the plates into an export frame `w` × `h` whose square lands at `squareTop`…`squareBottom` (frame px). Returns
 * whether they were drawn (a portrait frame with bars tall enough, and a match to name).
 */
export function drawPlates(ctx: CanvasRenderingContext2D, text: FlTextCache, view: FightLeagueView, L: FightLeagueLabels, w: number, h: number, squareTop: number, squareBottom: number): boolean {
  const lay = flPlateLayout(w, h, squareTop, squareBottom);
  if (!lay.show || view.fighters.length === 0) return false;
  const prev = text.scale;
  text.scale = 1;
  const fs = lay.fontSize;
  // the top plate: the names in their colours, joined by "vs" (a team's names by "+")
  const sides: { names: string; color: string }[] = [];
  if (view.match === "2v2") {
    for (let t = 0; t < 2; t++) {
      const members = view.fighters.filter((f) => f.team === t);
      if (members.length === 0) continue;
      sides.push({ names: members.map((f) => f.row.name).join(" + "), color: flNameColor(members[0].row.body, members[0].row.accent) });
    }
  } else for (const f of view.fighters) sides.push({ names: f.row.name, color: flNameColor(f.row.body, f.row.accent) });
  const style = (color: string): FlTextStyle => ({ role: "display", color, stroke: INK, strokeK: 0.1 });
  const parts = sides.map((s) => text.upperOf(s.names));
  const sepW = text.width(SEP.toUpperCase(), 0.7 * fs, style("#ffffff"));
  let total = 0;
  for (const p of parts) total += text.width(p, fs, style("#ffffff"));
  total += sepW * Math.max(0, parts.length - 1);
  const k = total > lay.maxWidth ? lay.maxWidth / total : 1;
  let x = lay.centerX - (total * k) / 2;
  for (let i = 0; i < parts.length; i++) {
    const pw = text.draw(ctx, parts[i], x, lay.topY, fs * k, style(sides[i].color), "left");
    x += pw;
    if (i < parts.length - 1) {
      x += text.draw(ctx, SEP.toUpperCase(), x, lay.topY, 0.7 * fs * k, style("#ffffff"), "left");
    }
  }
  const div = view.fighters[0].row.division;
  const sameDivision = view.fighters.every((f) => f.row.division === div);
  if (sameDivision) text.draw(ctx, text.upperOf(L.division(div)), lay.centerX, lay.topY + 0.95 * fs, lay.subFontSize, { role: "ui", color: "#ffffff", stroke: INK, strokeK: 0.14, weight: 700 }, "center", lay.maxWidth);
  // the bottom plate: who wins, sudden death, the winner
  let bottom = L.whoWins;
  let color = "#ffffff";
  if (view.finished && view.timeMs >= flWinnerShownMs(view) - 1e-6) {
    if (view.doubleKo) bottom = L.doubleKo;
    else if (view.winnerTeam < 0) bottom = L.draw;
    else {
      const winners = view.fighters.filter((f) => f.team === view.winnerTeam);
      bottom = L.winsPlate(winners.map((f) => f.row.name).join(" + "));
      if (winners[0]) color = flNameColor(winners[0].row.body, winners[0].row.accent);
    }
  } else if (view.suddenMs >= 0 && !view.finished) {
    bottom = L.suddenDeath;
    color = "#fca5a5";
  }
  text.draw(ctx, text.upperOf(bottom), lay.centerX, lay.bottomY, fs, style(color), "center", lay.maxWidth);
  text.scale = prev;
  return true;
}
