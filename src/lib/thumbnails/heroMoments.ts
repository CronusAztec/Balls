import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import type { HeroCamera } from "./heroFrame";

/*
 * --- mode-thumbnails --- The hero moment of every mode: the instant its card picture (public/modes/<mode>.webp) shows –
 * mid-action with the payoff on screen – as the settings of a link, a pinned seed, a second of the run and a camera, plus the
 * mode's colour for the card's edge glow. scripts/generate-mode-previews.mjs renders each one through the page's still
 * camera (window.__jumpingBallsStill: the fast export's deterministic canvas, so the same entry gives the same picture on any
 * machine) and frames it the same way for every card (lib/thumbnails/heroFrame.ts). A mode without an entry fails the
 * generator and the tests (`missingHeroModes()`): a new mode adds its line here.
 *
 * The viral bot's covers use the same idea for a clip (`heroMomentSec()`): the payoff on screen, not the first frame.
 */

export interface HeroMoment {
  /** One line: what the picture shows. */
  moment: string;
  /** The link's settings (the URL keys of lib/settings.ts and the modes' own), on top of HERO_BASE_QUERY; no mode=, no seed=. */
  query: string;
  /** The physics seed, pinned like a link's `seed=`. */
  seed: number;
  /** The second of the run pictured (simulation time). */
  atSec: number;
  /** The subject square (default: the centred square of the world – what a clip records). */
  camera?: HeroCamera;
  /** The mode's colour ("#rrggbb"): the card's edge glow. */
  tint: string;
  /**
   * --- card-looks --- The settings the mode card's link carries instead of `query` (on top of HERO_BASE_QUERY, like it): the
   * picture's look on top of the page's start pace, where the picture's own settings end no run inside the default clip or the
   * start look plays better (measured: the line's comment). Absent: the card links to `query`.
   */
  card?: string;
  /** --- card-looks --- false: the card's link leaves the picture's seed out (that run does not end inside the clip, holds included). */
  cardSeed?: false;
}

/** What every hero moment shares: ball and wall glow and the trails on (first in the link, so an entry leaves these keys alone). */
export const HERO_BASE_QUERY = "glow=1&trails=1&wglow=1";

export const HERO_MOMENTS: Record<ModeId, HeroMoment> = {
  classic: { moment: "the ring field about to break: the inner ring bursting in a white flash, the rest still closed", query: "wbreak=all&r=11", seed: 1, atSec: 2.65, tint: "#c04dff", card: "gap=1&s=500&shake=0.3&wbreak=all&resn=1&r=11" /* --- card-looks --- (the start look's pace, clip-start: the picture's own settings end no run of 8 by 45 s; this one 7 of 8 by 27 s, seed 1 out at 18.1 s) */ },
  accumulation: { moment: "frozen balls ringing the spiked arena, the live ball racing its last 0.2 s", query: "spikes=1&at=3&r=11&wt=4", seed: 5, atSec: 10.25, camera: { zoom: 1.1 }, tint: "#ff4fd8", card: "at=3&gap=0.35&s=450&spikes=1&wt=4" /* --- card-looks --- (the start look's pace with the spikes: 8 of 8 by 27 s, the picture's 3 of 8; seed 5 out at 16.4 s) */ },
  multiply: { moment: "the race near its limit: the ring packed with balls in their generations' colours, the count over 180 in the middle", query: "mrace=1" /* --- review fix (B5) --- (the studio's start look, the race to 200: seed 2 full at 21.3 s, over at 22.8 s; the old picture's link ended on no seed and buzzed at 200 balls) */, seed: 2, atSec: 18.6, tint: "#ffd23f" },
  lines: { moment: "the string art fanned: rainbow lines from the ball to the rim", query: "rlines=1&ldot=1&r=10", seed: 1, atSec: 28, tint: "#4dd2ff" },
  paint: { moment: "the circle two-thirds painted in thick rainbow strokes", query: "r=14&g=100", seed: 1, atSec: 10, tint: "#ff7a3d" },
  target: { moment: "the countdown at 4: a correct hit bursting a numbered segment of the ring", query: "r=11&wt=5&tt=1.6&tc=10&s=400" /* --- clip-pacing --- (as picked: ten numbers at speed 400) */, seed: 6, atSec: 18.4, camera: { zoom: 1.1 }, tint: "#ff4d6d", card: "r=11&wt=5&tt=1.6" /* --- card-looks --- (the page's seven numbers at speed 700: 8 of 8 by 27 s, the picture's 0 of 8; seed 6 done at 13.3 s) */ },
  portal: { moment: "a teleport: the ball bursting out of a portal in a spray of sparks", query: "r=11&wt=5&tt=1.6", seed: 1, atSec: 14.6, camera: { zoom: 1.1 }, tint: "#7c5cff" },
  shatter: { moment: "rings of rainbow segments, the ball smashing through them in a shower of shards", query: "r=11" /* --- review fix B3 --- (the page's pace, six rings of even bricks: the ball bursts through the last ring at 11.8 s, every ring cracked and lit) */, seed: 3, atSec: 11.8, tint: "#5ce1e6" },
  colorMatch: { moment: "a colour match shattering a segment of the ring", query: "r=11&wt=5&tt=1.6&cms=12&cmc=7&s=400" /* --- clip-pacing --- (as picked: twelve segments in seven colours at speed 400) */, seed: 1, atSec: 16, camera: { zoom: 1.1 }, tint: "#ffb703", card: "r=11&wt=5&tt=1.6" /* --- card-looks --- (the page's eight segments in three colours: 7 of 8 by 27 s, the picture's 0 of 8; seed 1 out at 13.6 s) */ },
  grow: { moment: "the ball warmed to amber a bounce from filling its ring, the meter round the rim nearly closed, its hit markers fading", query: "gLaw=multiply&gFill=finish&gStep=4&gStart=15&gHue=1&gMark=1&gPitch=1" /* --- review fix (B5) --- (the studio's start look: seed 1 full at 20.2 s; the old picture's link never filled) */, seed: 1, atSec: 19.6, tint: "#93d119" },
  drop: { moment: "balls raining through the coloured pegs", query: "dbc=16&dsi=0.2&dsv=0.7", seed: 1, atSec: 4, tint: "#4cc9f0" },
  box: { moment: "fat squares mid-polyrhythm, the wall they just hit lit up", query: "bxa=1&bxgr=3&bxn=4", seed: 1, atSec: 17, tint: "#f72585", card: "bxn=4" /* --- card-looks --- (the page's tall box and growth: at zero by 30 s on 7 of 8, the square box 0 of 8, a median 37 s; seed 1 at 29.2 s) */ },
  pendulum: { moment: "the pendulum wave in a perfect fan", query: "pwn=20&pwk=24&pwt=40&pwtr=0.5", seed: 1, atSec: 1, tint: "#9d4edd", card: "pwn=20&pwtr=0.5" /* --- card-looks --- (the page's 24 s cycle: IN LINE! at 24.0 s, the picture's at 40.0 s) */ },
  polyrhythm: { moment: "sixteen voices fanned out along their chords in a rainbow wave", query: "prl=arcs&prcs=30" /* --- clip-pacing --- (as picked: the 30 s cycle) */, seed: 1, atSec: 3, tint: "#3ddc97", card: "prl=arcs" /* --- card-looks --- (the page's 24 s cycle: IN PHASE! at 24.0 s, the picture's at the 30 s clip's last frame) */ },
  collide: { moment: "squishy orbs colliding in the circle", query: "cpsq=1&cpn=60", seed: 1, atSec: 6, tint: "#80ffdb" },
  glass: { moment: "a full glass smash: the pane under Gerald shattering, shards in the air", query: "face=cute", seed: 1, atSec: 12.75, camera: { x: 0.5, y: 0.44, zoom: 1.55 }, tint: "#b8c0ff" },
  multipliers: { moment: "a swarm of clones pouring through the gates, HOME counting up", query: "mpsb=3&mprw=10", seed: 1, atSec: 5.5, camera: { x: 0.5, y: 0.54, zoom: 1.205 }, tint: "#ffd60a" },
  doublePendulum: { moment: "the double pendulum flung wide over the lit harp strings, its rainbow trail behind", query: "dprs=0&dpa1=150&dpa2=120&dptr=8", seed: 1, atSec: 8.6, tint: "#ff006e" },
  illusion: { moment: "the hidden heart emerging from the painted arena", query: "ilt=whitespace&ilpt=heart", seed: 1, atSec: 18, camera: { zoom: 1.1 }, tint: "#22d3ee" },
  stringBattle: { moment: "String Circle: flag balls with their strings fanned to the rim", query: "sbst=circle&sbh=0", seed: 1, atSec: 14, camera: { x: 0.5, y: 0.56, zoom: 1.2 }, tint: "#00f5d4", card: "sbst=circle&sbh=0&sbd=25" /* --- card-looks --- (the circle with the mode's own Clip Limit: judged at 25.0 s on every seed, its hold inside the clip; the circle alone ran 31–43 s, 0 of 8 by 30 s) */ },
  powerLayers: { moment: "a big hit shattering a band of the rainbow stack", query: "pll=400&plb=none&plp=0", seed: 1, atSec: 5.6, camera: { x: 0.5, y: 0.58, zoom: 1.55 }, tint: "#ff5400" },
  race: { moment: "racers mid-track through the flippers and pegs, the leader crowned", query: "rcn=10&rcl=8&rcst=0&rcmm=0" /* --- finales-in-clip --- (B6: the picture's 8-screen track written out) */, seed: 1, atSec: 5, camera: { x: 0.569, y: 0.451, zoom: 1.667 }, tint: "#ef233c", card: "rcst=0&rcmm=0" /* --- card-looks --- (the page's eight racers: a median 29.6 s, ten racers 29.9 s; seed 1 finishes at 27.1 s, with ten 30.9 s; --- finales-in-clip --- the page's 6-screen track: seed 1 over at 19.6 s, the podium from 16.1 s) */ },
  battle: { moment: "squares clashing with HP bars, a KO blast", query: "btn=12", seed: 1, atSec: 5.8, tint: "#ff4d4d", cardSeed: false /* --- card-looks --- (seed 1's winner at 29.1 s leaves no room for the 3 s hold: the card leaves the seed out) */ },
  ctf: { moment: "CAPTURE!: a flag carried home, the score ticking over", query: "ctfn=3", seed: 1, atSec: 6, tint: "#3a86ff", card: "" /* --- card-looks --- (the page's two a side: a median 23 s, three a side 27 s, the 3 s hold past the clip; seed 1 won at 15.1 s) */ },
  runner: { moment: "the runner in the air over the spikes, on the beat", query: "rrn=40&rrd=1&face=cute", seed: 1, atSec: 3.6, camera: { x: 0.43, y: 0.52, zoom: 1.8 }, tint: "#06d6a0", card: "rrd=1&face=cute" /* --- card-looks --- (the page's 24 obstacles at the picture's density: LEVEL COMPLETE by 27 s on 6 of 6, the page's own 0 of 6 and the picture's 40 obstacles 38–40 s; seed 1 at 25.1 s; --- finales-in-clip --- the page's 18 obstacles: seed 1 at 20.6 s) */ },
  paddle: { moment: "a catch on the platform, sparks flying", query: "pdsk=1&pdsp=1", seed: 1, atSec: 8.6, camera: { x: 0.55, y: 0.756, zoom: 2.2 }, tint: "#ffbe0b", card: "pdsp=1" /* --- card-looks --- (the page's paddle skill: GAME OVER by 27 s on 4 of 8, the page's own 2 of 8 and the picture's perfect paddle never; seed 1 at 24.7 s; --- finales-in-clip --- with the page's goal of 20 a run ends on a win or a GAME OVER: seed 1 out at 15 catches, over at 24.7 s) */ },
  vortex: { moment: "a full funnel: balls weaving down the glowing rings", query: "face=cute&vxrl=stagger" /* --- finales-in-clip --- (B6: the picture's stagger release written out) */, seed: 1, atSec: 16, camera: { zoom: 1.4 }, tint: "#00bbf9", card: "face=cute" /* --- finales-in-clip --- (the page's ring release: 22.5 s on every seed; the stagger ran 29–31 s, seed 1 30.9 s, and the card left the seed out) */ },
  journey: { moment: "Gerald bursting the first ring of a rings stage, the field still closed around him", query: "js=rings-l,glass,pegs,home&face=cute", seed: 1, atSec: 2, camera: { x: 0.5, y: 0.53, zoom: 1.4 } /* --- low-findings --- (the stage label framed out) */, tint: "#93d119" },
  bullseye: { moment: "BULLSEYE: a ball stuck in the bull, the starburst", query: "byi=0.4&byp=2&face=cute", seed: 1, atSec: 3.5, camera: { x: 0.5, y: 0.56, zoom: 1.2 } /* --- low-findings --- (the corner counters framed out) */, tint: "#ef476f" },
  mergeRing: { moment: "a merge in the pile: the halo around the pair, the crown tier lit on the ladder, the rainbow rim", query: "mrg=1" /* --- clip-pacing --- (as picked: seven tiers, a ball every 0.4 s, three spawn tiers – --- merge-ring-staged --- the page's own pace now – and gravity 1, the page's is 3) */, seed: 1, atSec: 12, tint: "#f472b6", card: "" /* --- card-looks --- (the page's gravity 3: a verdict by 27 s on 8 of 8, gravity 1 on 5 of 8; seed 1 at 20.5 s) */ }, // --- merge-ring ---
  spiralGlass: { moment: "the outer band bored open, a ring of coloured balls circling the glass core, shards flying off its face", query: "sgv=1.2&sgh=2" /* --- clip-pacing --- (as picked: glass of two hits) */, seed: 1, atSec: 30, tint: "#e879f9", card: "sgv=1.2" /* --- card-looks --- (the page's glass of one hit: GLASS CLEARED at 19.3–19.9 s, two hits 26–27 s, past the banner's room; seed 1 at 19.8 s) */ }, // --- spiral-glass ---
  songRing: { moment: "five of seven note tiles lit round the ring, the ball lighting the fifth in a burst of sparks, the playhead sweeping on", query: "", seed: 1, atSec: 8.87, tint: "#a78bfa" }, // --- song-ring ---
  sandPlate: { moment: "the sixth note's figure drawn in sand, the last loose grains streaming onto its lines, the dots climbing under the plate", query: "", seed: 1, atSec: 11.2, tint: "#34d399" }, // --- sand-plate --- (--- review fix (C3) --- 1.2 s into the sixth note of 2 s)
  blueprint: { moment: "Ring Breaker: the swarm filling the arena as the last ring shatters", query: "blp=ringBreaker", seed: 1, atSec: 11.9, tint: "#22d3ee" }, // --- blueprint --- (Mode Lab's card: a catalog game with every ball on screen; --- review fix (blueprint) --- 11.9 s since the rings sit inside a solid rim and seed 1 ends at 12.0 s)
  beatDrop: { moment: "the ball landing on a pad on the beat in a burst of sparks", query: "face=cute&bdd=1&bda=1", seed: 1, atSec: 12.6, camera: { x: 0.38, y: 0.58, zoom: 1.8 }, tint: "#b5179e" },
  territory: { moment: "the territory map half painted, borders jagged, a blast and a whirl biting into the other side" /* --- territory-swing --- */, query: "tyb=3&tybg=0", seed: 1, atSec: 14.5, camera: { x: 0.5, y: 0.545, zoom: 1.1 } /* --- low-findings --- (PICK A SIDE and the clock framed out, the score bar kept) */, tint: "#4895ef" },
  maze: { moment: "the leader one turn from the exit, blood-red trails filling the maze behind it", query: "mzn=4&mzbg=0&mzhud=0", seed: 6, atSec: 6.7, camera: { zoom: 1.12 }, tint: "#38b000" },
  conveyor: { moment: "balls riding the belt and dropping into the rainbow rings", query: "cvi=1&cvn=12&face=cute", seed: 1, atSec: 6.8, camera: { x: 0.481, y: 0.571, zoom: 1.154 }, tint: "#f4a261" },
  orbGrid: { moment: "the orbs' wave at its peak", query: "ogC=44&ogR=43&ogD=corner&ogS=0.8&ogB=0.882&ogRhythm=corner&ogHud=0&ogCycle=30" /* --- finales-in-clip --- (B6: the picture's 30 s cycle written out) */, seed: 3, atSec: 14.5, camera: { x: 0.506, y: 0.567, zoom: 1.25 }, tint: "#4cc9f0", card: "ogC=44&ogR=43&ogD=corner&ogS=0.8&ogB=0.882&ogRhythm=corner&ogHud=0" /* --- finales-in-clip --- (the page's 26 s cycle: IN PHASE at 26.0 s and its card and chord inside the clip; at 30 s the landing was the clip's last frame) */ },
  fightLeague: { moment: "Thor's Thunder Strike crashing down on Loki on the noir stage: white hit particles over the black arena, the HP numbers in the discs", query: "", seed: 1, atSec: 9.45, camera: { x: 0.5, y: 0.361, zoom: 1.151 }, tint: "#ffd166" }, // --- fl-overhaul --- (Stage 3: an ability firing over the foe; --- fl-noir --- the noir stage is the default look)
  landClaim: { moment: "half the wall taken: the columns a mosaic of the four countries' colours", query: "teams=France*0055a4*%F0%9F%87%AB%F0%9F%87%B7,Brazil*009c3b*%F0%9F%87%A7%F0%9F%87%B7,Spain*aa151b*%F0%9F%87%AA%F0%9F%87%B8,Colombia*fcd116*%F0%9F%87%A8%F0%9F%87%B4&lcm=claim&lch=0&tsb=0&tn=0", seed: 3, atSec: 5, camera: { x: 0.5, y: 0.587, zoom: 1.25 }, tint: "#2a9d8f" },
  // --- colour-sort ---
  colourSort: { moment: "the bullseye almost sorted: every colour in its own band, the last stragglers slipping through the turning gates", query: "lh=0", seed: 1, atSec: 9, tint: "#5b8cff" },
  starChords: { moment: "the five stars just closed together: every chord drawn, the inner circles lit, the closing flash", query: "lh=0", seed: 1, atSec: 12.3, camera: { zoom: 1.2 }, tint: "#b9a8ff" }, // --- chord-stars ---
  // --- bead-hoops --- (the account's navy page)
  hoops: { moment: "all eight beads up at the top spin, lined up level across the face-on rainbow hoops (g/ω² under the centre)", query: "bg1=0b1020&bg2=0b1020", seed: 1, atSec: 12.9, tint: "#f2c46a", card: "bg1=0b1020&bg2=0b1020&lh=1&hpw0=0.5" /* --- finales-in-clip --- (B6: the studio's start look – the title, the live counter and a spin from 0.5: the first bead up at 4 s, all eight by 19 s) */ },
  ellipseFoci: { moment: "the volley mid-flight on the felt: a rainbow arc of comets bouncing off the rail toward the far focus", query: "lh=0&efTr=0.45", seed: 2, atSec: 2.2, tint: "#93d119" }, // --- ellipse-foci ---
  beatMachine: { moment: "the marble xylophone mid-tune: marbles falling from their tubes onto the rainbow bars, one bouncing off a struck bar, others riding the lift", query: "lh=0", seed: 1, atSec: 3.5, camera: { zoom: 1.15 }, tint: "#c08a3f" }, // --- beat-machine ---
  waveTank: { moment: "the seven-gap grating: tall spiky ridges just past the slate barrier, a few sharp beams fanning toward the bells, the centre bells glowing amber", query: "lh=0&wtR=56&wtT=42", seed: 1, atSec: 22, camera: { y: 0.51, zoom: 1.28 }, tint: "#c8d6ff" }, // --- wave-tank ---
  brickRebuild: { moment: "the emblem half smashed: a hundred hollow balls tearing through the navy field, the teal ring and the amber square, grey ghosts of the last bricks shrinking away", query: "brV=600&lh=0", seed: 1, atSec: 9, tint: "#2fb7b4" }, // --- brick-rebuild ---
  drawingMachine: { moment: "earth and venus at year 8.0: the five-petal flower of blue-to-magenta chords complete round the amber sun, the cream pentagram joining the five conjunction marks", query: "dmm=orbits&lh=0", seed: 1, atSec: 15, tint: "#f6dc9a", card: "bg1=05060c&bg2=05060c&dmm=orbits" /* --- finales-in-clip --- (B6: the studio's start look – the orbits on their dark sky with the loop HUD) */ }, // --- drawing-machine ---
  perfectFit: { moment: "the 10 × 6 box two-thirds full of glossy pentominoes, one falling straight into its slot, the tray above thinning out", query: "lh=0", seed: 1, atSec: 5.1, tint: "#7a6bff" }, // --- perfect-fit ---
};

/** The modes of `ids` (MODE_IDS) without a hero moment in `table`: the generator refuses to run while any is missing. */
export function missingHeroModes(table: Readonly<Record<string, HeroMoment | undefined>> = HERO_MOMENTS, ids: readonly string[] = MODE_IDS): string[] {
  return ids.filter((id) => !table[id]);
}

// --- card-looks ---
/**
 * The link of a mode's card (a query string without "?"): the mode, the shared look, the picture's settings – or its `card`
 * settings, the look on top of the page's start pace – and the picture's seed, so a laptop's stage (the 800 × 450 world the
 * pictures are rendered in) plays the very run the card shows. The seed stays out where that run does not end inside the clip
 * (`cardSeed: false`). The modes wall, the studio's mode picker and the landing page's picture row link here.
 */
export function cardQuery(mode: ModeId, table: Readonly<Record<string, HeroMoment | undefined>> = HERO_MOMENTS): string {
  const entry = table[mode];
  if (!entry) throw new Error(`The mode "${mode}" has no hero moment – add one to HERO_MOMENTS (src/lib/thumbnails/heroMoments.ts).`);
  return [`mode=${mode}`, HERO_BASE_QUERY, entry.card ?? entry.query, entry.cardSeed === false ? "" : `seed=${entry.seed}`].filter(Boolean).join("&");
}

/** The studio link of a mode's card, relative to the locale (for next-intl's Link): `/simulator?<cardQuery>`. */
export function cardHref(mode: ModeId): string {
  return `/simulator?${cardQuery(mode)}`;
}
// --- end card-looks ---

/** The simulator link (a query string without "?") of a mode's hero moment: the mode, the shared look, its keys and its seed. */
export function heroQuery(mode: ModeId, table: Readonly<Record<string, HeroMoment | undefined>> = HERO_MOMENTS): string {
  const entry = table[mode];
  if (!entry) throw new Error(`The mode "${mode}" has no hero moment – add one to HERO_MOMENTS (src/lib/thumbnails/heroMoments.ts).`);
  return [`mode=${mode}`, HERO_BASE_QUERY, entry.query, `seed=${entry.seed}`].filter(Boolean).join("&");
}

/* ------------------------------------------------------------------ a clip's hero moment (the viral bot's covers) */

/** A hero picture shows the payoff on screen: this long after it lands (the burst, the banner, the shards in the air). */
export const HERO_PAYOFF_LAG_SEC = 0.25;
/** …and stays clear of a clip's last moments (the end screen, the recorder's tail). */
export const HERO_TAIL_SEC = 0.5;
/** Where in a clip without a payoff the picture is taken when the mode's card second is past its end (the payoff band's middle). */
export const HERO_BAND_SHARE = 0.85;

export type HeroMomentSource = "payoff" | "cut" | "card" | "band";

/**
 * The hero second of a clip of `clipSec`: the payoff on screen when it comes inside the clip – no later than the last moment a
 * picture may take (`clipSec` − `HERO_TAIL_SEC`), the picture up to `HERO_PAYOFF_LAG_SEC` after it; the clip's last moment when
 * it is cut before the payoff (a cliffhanger – the closest it gets) or the payoff lands in the clip's tail (the picture then
 * precedes it: "cut", not "payoff"); otherwise the mode's card second when the clip reaches it, else the middle of the payoff band.
 */
export function heroMomentSec(input: { mode: string; clipSec: number; payoffSec: number | null; cutGapSec?: number | null }): { sec: number; source: HeroMomentSource } {
  const clip = Number.isFinite(input.clipSec) && input.clipSec > 0 ? input.clipSec : 0;
  const latest = Math.max(0, clip - HERO_TAIL_SEC);
  const round = (v: number) => Math.round(Math.max(0, Math.min(latest, v)) * 1000) / 1000;
  const payoff = input.payoffSec;
  if (payoff !== null && Number.isFinite(payoff) && payoff >= 0) {
    const cut = (input.cutGapSec ?? null) !== null && (input.cutGapSec as number) > 0;
    // --- low-findings --- "the payoff on screen" only when the frame can show it: a payoff past the clip's last moment that
    // a picture may take (`latest`, before the tail) is shown as the last moment before it – the frame precedes the payoff
    if (!cut && payoff <= latest) return { sec: round(payoff + HERO_PAYOFF_LAG_SEC), source: "payoff" };
    return { sec: round(latest), source: "cut" };
  }
  const card = (HERO_MOMENTS as Readonly<Record<string, HeroMoment | undefined>>)[input.mode]?.atSec;
  if (card !== undefined && card <= latest) return { sec: round(card), source: "card" };
  return { sec: round(HERO_BAND_SHARE * clip), source: "band" };
}
