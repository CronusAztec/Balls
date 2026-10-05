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
}

/** What every hero moment shares: ball and wall glow and the trails on (first in the link, so an entry leaves these keys alone). */
export const HERO_BASE_QUERY = "glow=1&trails=1&wglow=1";

export const HERO_MOMENTS: Record<ModeId, HeroMoment> = {
  classic: { moment: "the ring field about to break: the inner ring bursting in a white flash, the rest still closed", query: "wbreak=all&r=11", seed: 1, atSec: 2.65, tint: "#c04dff" },
  accumulation: { moment: "frozen balls ringing the spiked arena, the live ball racing its last 0.2 s", query: "spikes=1&at=3&r=11&wt=4", seed: 5, atSec: 10.25, camera: { zoom: 1.1 }, tint: "#ff4fd8" },
  multiply: { moment: "the arena packed with rainbow balls, the first ones spilling out of the gap", query: "rball=1&r=10&gap=0.6&msc=5", seed: 2, atSec: 10, tint: "#ffd23f" },
  lines: { moment: "the string art fanned: rainbow lines from the ball to the rim", query: "rlines=1&ldot=1&r=10", seed: 1, atSec: 28, tint: "#4dd2ff" },
  paint: { moment: "the circle two-thirds painted in thick rainbow strokes", query: "r=14&g=100", seed: 1, atSec: 10, tint: "#ff7a3d" },
  target: { moment: "the countdown at 4: a correct hit bursting a numbered segment of the ring", query: "r=11&wt=5&tt=1.6", seed: 6, atSec: 18.4, camera: { zoom: 1.1 }, tint: "#ff4d6d" },
  portal: { moment: "a teleport: the ball bursting out of a portal in a spray of sparks", query: "r=11&wt=5&tt=1.6", seed: 1, atSec: 14.6, camera: { zoom: 1.1 }, tint: "#7c5cff" },
  shatter: { moment: "rings of rainbow segments, the ball smashing through them in a shower of shards", query: "r=11", seed: 1, atSec: 16, tint: "#5ce1e6" },
  colorMatch: { moment: "a colour match shattering a segment of the ring", query: "r=11&wt=5&tt=1.6", seed: 1, atSec: 16, camera: { zoom: 1.1 }, tint: "#ffb703" },
  grow: { moment: "the ball grown to fill most of its ring, the rainbow lines fanned", query: "glines=1&rlines=1&rball=1", seed: 1, atSec: 46, tint: "#93d119" },
  drop: { moment: "balls raining through the coloured pegs", query: "dbc=16&dsi=0.2&dsv=0.7", seed: 1, atSec: 4, tint: "#4cc9f0" },
  box: { moment: "fat squares mid-polyrhythm, the wall they just hit lit up", query: "bxa=1&bxgr=3&bxn=4", seed: 1, atSec: 17, tint: "#f72585" },
  pendulum: { moment: "the pendulum wave in a perfect fan", query: "pwn=20&pwk=24&pwt=40&pwtr=0.5", seed: 1, atSec: 1, tint: "#9d4edd" },
  polyrhythm: { moment: "sixteen voices fanned out along their chords in a rainbow wave", query: "prl=arcs", seed: 1, atSec: 3, tint: "#3ddc97" },
  collide: { moment: "squishy orbs colliding in the circle", query: "cpsq=1&cpn=60", seed: 1, atSec: 6, tint: "#80ffdb" },
  glass: { moment: "a full glass smash: the pane under Gerald shattering, shards in the air", query: "face=cute", seed: 1, atSec: 12.75, camera: { x: 0.5, y: 0.44, zoom: 1.55 }, tint: "#b8c0ff" },
  multipliers: { moment: "a swarm of clones pouring through the gates, HOME counting up", query: "mpsb=3&mprw=10", seed: 1, atSec: 5.5, camera: { x: 0.5, y: 0.54, zoom: 1.205 }, tint: "#ffd60a" },
  doublePendulum: { moment: "the double pendulum flung wide over the lit harp strings, its rainbow trail behind", query: "dprs=0&dpa1=150&dpa2=120&dptr=8", seed: 1, atSec: 8.6, tint: "#ff006e" },
  illusion: { moment: "the hidden heart emerging from the painted arena", query: "ilt=whitespace&ilpt=heart", seed: 1, atSec: 18, camera: { zoom: 1.1 }, tint: "#22d3ee" },
  stringBattle: { moment: "String Circle: flag balls with their strings fanned to the rim", query: "sbst=circle&sbh=0", seed: 1, atSec: 14, camera: { x: 0.5, y: 0.56, zoom: 1.2 }, tint: "#00f5d4" },
  powerLayers: { moment: "a big hit shattering a band of the rainbow stack", query: "pll=400&plb=none&plp=0", seed: 1, atSec: 5.6, camera: { x: 0.5, y: 0.58, zoom: 1.55 }, tint: "#ff5400" },
  race: { moment: "racers mid-track through the flippers and pegs, the leader crowned", query: "rcn=10&rcst=0&rcmm=0", seed: 1, atSec: 5, camera: { x: 0.569, y: 0.451, zoom: 1.667 }, tint: "#ef233c" },
  battle: { moment: "squares clashing with HP bars, a KO blast", query: "btn=12", seed: 1, atSec: 5.8, tint: "#ff4d4d" },
  ctf: { moment: "CAPTURE!: a flag carried home, the score ticking over", query: "ctfn=3", seed: 1, atSec: 6, tint: "#3a86ff" },
  runner: { moment: "the runner in the air over the spikes, on the beat", query: "rrn=40&rrd=1&face=cute", seed: 1, atSec: 3.6, camera: { x: 0.43, y: 0.52, zoom: 1.8 }, tint: "#06d6a0" },
  paddle: { moment: "a catch on the platform, sparks flying", query: "pdsk=1&pdsp=1", seed: 1, atSec: 8.6, camera: { x: 0.55, y: 0.756, zoom: 2.2 }, tint: "#ffbe0b" },
  vortex: { moment: "a full funnel: balls weaving down the glowing rings", query: "face=cute", seed: 1, atSec: 16, camera: { zoom: 1.4 }, tint: "#00bbf9" },
  journey: { moment: "Gerald bursting the first ring of a rings stage, the field still closed around him", query: "js=rings-l,glass,pegs,home&face=cute", seed: 1, atSec: 2, camera: { x: 0.5, y: 0.5, zoom: 1.3 }, tint: "#93d119" },
  bullseye: { moment: "BULLSEYE: a ball stuck in the bull, the starburst", query: "byi=0.4&byp=2&face=cute", seed: 1, atSec: 3.5, tint: "#ef476f" },
  beatDrop: { moment: "the ball landing on a pad on the beat in a burst of sparks", query: "face=cute&bdd=1&bda=1", seed: 1, atSec: 12.6, camera: { x: 0.38, y: 0.58, zoom: 1.8 }, tint: "#b5179e" },
  territory: { moment: "the territory map half painted, borders jagged", query: "tyb=3&tybg=0", seed: 1, atSec: 14.5, tint: "#4895ef" },
  maze: { moment: "the leader one turn from the exit, blood-red trails filling the maze behind it", query: "mzn=4&mzbg=0&mzhud=0", seed: 6, atSec: 6.7, camera: { zoom: 1.12 }, tint: "#38b000" },
  conveyor: { moment: "balls riding the belt and dropping into the rainbow rings", query: "cvi=1&cvn=12&face=cute", seed: 1, atSec: 6.8, camera: { x: 0.481, y: 0.571, zoom: 1.154 }, tint: "#f4a261" },
  orbGrid: { moment: "the orbs' wave at its peak", query: "ogC=44&ogR=43&ogD=corner&ogS=0.8&ogB=0.882&ogRhythm=corner&ogHud=0", seed: 3, atSec: 14.5, camera: { x: 0.506, y: 0.567, zoom: 1.25 }, tint: "#4cc9f0" },
  fightLeague: { moment: "Thor's Thunder Strike crashing down on Loki on the lilac stage, the HP bars ticking under the names", query: "", seed: 1, atSec: 9.45, camera: { x: 0.5, y: 0.361, zoom: 1.151 }, tint: "#ffd166" }, // --- fl-overhaul --- (Stage 3: the lilac stage, an ability firing over the foe; the final stage regenerates the picture)
  landClaim: { moment: "half the wall taken: the columns a mosaic of the four countries' colours", query: "teams=France*0055a4*%F0%9F%87%AB%F0%9F%87%B7,Brazil*009c3b*%F0%9F%87%A7%F0%9F%87%B7,Spain*aa151b*%F0%9F%87%AA%F0%9F%87%B8,Colombia*fcd116*%F0%9F%87%A8%F0%9F%87%B4&lcm=claim&lch=0&tsb=0&tn=0", seed: 3, atSec: 5, camera: { x: 0.5, y: 0.587, zoom: 1.25 }, tint: "#2a9d8f" },
};

/** The modes of `ids` (MODE_IDS) without a hero moment in `table`: the generator refuses to run while any is missing. */
export function missingHeroModes(table: Readonly<Record<string, HeroMoment | undefined>> = HERO_MOMENTS, ids: readonly string[] = MODE_IDS): string[] {
  return ids.filter((id) => !table[id]);
}

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
 * The hero second of a clip of `clipSec`: the payoff on screen when it comes inside the clip; the clip's last moment when it
 * is cut before the payoff (a cliffhanger – the closest it gets); otherwise the mode's card second when the clip reaches it,
 * else the middle of the payoff band.
 */
export function heroMomentSec(input: { mode: string; clipSec: number; payoffSec: number | null; cutGapSec?: number | null }): { sec: number; source: HeroMomentSource } {
  const clip = Number.isFinite(input.clipSec) && input.clipSec > 0 ? input.clipSec : 0;
  const latest = Math.max(0, clip - HERO_TAIL_SEC);
  const round = (v: number) => Math.round(Math.max(0, Math.min(latest, v)) * 1000) / 1000;
  const payoff = input.payoffSec;
  if (payoff !== null && Number.isFinite(payoff) && payoff >= 0) {
    const cut = (input.cutGapSec ?? null) !== null && (input.cutGapSec as number) > 0;
    if (!cut && payoff <= clip) return { sec: round(payoff + HERO_PAYOFF_LAG_SEC), source: "payoff" };
    return { sec: round(latest), source: "cut" };
  }
  const card = (HERO_MOMENTS as Readonly<Record<string, HeroMoment | undefined>>)[input.mode]?.atSec;
  if (card !== undefined && card <= latest) return { sec: round(card), source: "card" };
  return { sec: round(HERO_BAND_SHARE * clip), source: "band" };
}
