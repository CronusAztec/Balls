import type { FlDivision, FlPrimitive, FlShape, FlWeaponKind } from "@/lib/physics/modes/fightLeagueRoster";

/**
 * --- fl-overhaul --- (Stage 4) Fight League's sound tables – DATA in the recipe notation of flSynth.ts (`role(N) layer + …`;
 * F the fighter's note folded into C4–B4 and snapped to the scale, R the scale's root in C5–B5, H a family set's own pitch,
 * a plain number a fixed timbre that is never snapped). flSoundResolve.ts picks a cue's recipe: a custom clip of the user, else
 * the fighter's signature set (FL_SIGNATURES – bespoke roles over a family set at its pitch, FL_FAMILY_SETS), with its
 * division's tint layered on (FL_DIVISION_TINTS), else its weapon kind's (FL_WEAPON_SOUNDS) or its ability primitive's
 * (FL_PRIMITIVE_SOUNDS) row; the match stings (FL_MATCH_SOUNDS) and the announcer's calls (FL_ANNOUNCER) resolve directly.
 * Every row is normalised before its bus by the generated trims (flRecipeTrims.ts: one-shot peak 0.40, charge 0.30, held
 * 0.25), so a row's `p` gains only balance its own layers.
 *
 * AVOID-LIST – the review list every row below was checked against (and any new row must be): ORIGINAL SYNTHESIS ONLY.
 *  - No sample, rip, re-recording or re-synthesis of a source cue: no film's energy-blade hum, ignition or swing recording;
 *    no respirator breath; no monster's, dinosaur's or giant ape's roar recording (ours are formant growls); no shooter's
 *    shield-recharge, rifle or shotgun recording; no block game's fuse hiss, explosion, hurt or teleport sound; no
 *    construction-shooter build or dance-bomb music; no crewmate meeting alarm or kill sting; no blocky-avatar "oof"; no
 *    portal gun's own shot; no pocket-monster cry, level-up or healing jingle; no maze-eater's chomp, siren or death warble;
 *    no plumber's jump, coin, power-up or star music; no hedgehog's ring or spin-dash recording; no hero-of-time "secret
 *    found" jingle; no cartoon studio's stings, laughs or catch-phrase voices; no sailor's pipe toots.
 *  - No voice line, word or imitation of an actor, character or announcer: the announcer is a deep synthetic vowel shape
 *    (`fmt`) or an instrumental sting, never a name, a move name ("Hadouken", "Kamehameha", "Get over here"), a chant, a
 *    laugh, a scream or a catch-phrase.
 *  - No source melody or jingle of three notes or more: no hero theme, victory fanfare (the winner's is our own two-chord
 *    gesture), spy-film riff, adventure march, pirate jig, horror-film ostinato or nursery rhyme, synth-wave arpeggio of a
 *    streaming series, space-opera march or imperial theme, wizard-school celesta motif, frontier whistle, fantasy-epic
 *    opening, monk chant or metal riff.
 *  - No iconic two-note figure in its original interval, register and timbre: no low-string semitone shark ostinato, no
 *    coin's rising fourth, no ring chime's original pair (ours: a fifth, C7 → G7), no doorbell-like meeting bong.
 *  - Names are plain-text labels of an unaffiliated fan simulation; no reference account or game is named in any string.
 *  - The owner's licensed audio enters ONLY through the custom clip slots (flClips.ts): it stays on the device, is never
 *    shipped, uploaded, put in a link or a project, and never tracked (.gitignore: fight-sounds/, *.jumpingballslive.zip; a
 *    test allows tracked audio only under public/hitSounds/ and public/wallBreak/).
 */

/** A weapon kind's roles: the attack (swing for melee, shoot for ranged kinds and throws), the hit, a block, a thrown weapon caught, a ricochet. */
export type FlWeaponRole = "swing" | "shoot" | "hit" | "block" | "return" | "ricochet" | "clash" | "blink" | "heavy" | "snag" | "fuse";
/** An ability primitive's roles ("standard" = charge + telegraph + fire). */
export type FlPrimRole = "charge" | "telegraph" | "fire" | "sustain" | "impact" | "end" | "explode" | "spin" | "fuse" | "ringBlades";

/* ------------------------------------------------------------------ weapon kinds (21) */

export const FL_WEAPON_SOUNDS: Readonly<Record<FlWeaponKind, Readonly<Partial<Record<FlWeaponRole, string>>>>> = {
  sword: {
    swing: "swing(175) wn bp900>3200/150q1.4 e15/160 p1.2 + pn lp700 e20/120 p.5",
    hit: "hit(422) bar F*2 [.14/420 .08/340 .05/260 .02/180] + wn hp4200 d35 p.13 + sin 180>120/60 d70 p.14",
    clash: "clash(380) bar F*3 [.14/380 .09/300 .05/220] + bar F*3.17 [.1/320 .06/240] + wn bp4000q2 d40 p.35 + wn hp5000 d8 p.2 x4/18±6*.8",
  },
  hammer: {
    swing: "swing(260) pn bp300>700/260q.9 e40/220 p1.7 + sin 60 e30/180 p.17",
    shoot: "shoot(960) pn a9/.8 bp520q1.2 e60/100/.8/200h p1.7",
    return: "return(82) wn hp2000 d20 p.32 + sin 220>180/60 d80 p.29",
    hit: "hit(302) sin 110>45/220 e3/260 p.28 + bn lp900 d90 p.3 + bar F*0.5 [.04/300 .03/220]",
  },
  fists: {
    swing: "swing(88) pn bp1200>600/90q1 e8/80 p2.4",
    hit: "hit(132) sin 150>55/120 d130 p.28 + wn bp2500q.8 d12 p.39 + pn lp2000 d60 p.3",
    heavy: "heavy(222) sin 90>38/200 ws2 d220 p.24 + bn lp700 d120 p.27 + wn bp2000q.8 d14 p.27",
  },
  claws: {
    swing: "swing(119) wn bp2000>4500/50q1.6 e4/45 p1.4 x3/35*.9 L/R.3alt",
    hit: "hit(111) wn hp3000 d60 p.29 x3/25*.8 + saw 400>200/80 bp1500q2 d80 p.29",
  },
  chain: {
    swing: "swing(260) wn bp3500q4 d8 p1.4 x8/28±8*.9 + pn a14/.6 bp1400q1 e40/220 p1.7",
    shoot: "shoot(250) wn bp1500>3500/250q2 e20/230 p1.2 + wn bp3500q4 d8 p1.1 x6/30±6*.9",
    hit: "hit(222) sin 120>50/200 d220 p.21 + bar 2200 [.05/150 .03/100] + bn lp1000 d80 p.25 + wn bp3500q4 d8 p.49 x4/22±6*.8",
    return: "return(150) wn bp3500q4 d8 p1.2 x5/26±6*.9 + wn bp2800>1400/140q2 e10/140 p.8",
  },
  bow: {
    shoot: "shoot(261) ks F*0.5 d.99 d260 p.42 + wn bp3000>1600/150q6 e10/140 p.78 @15",
    hit: "hit(41) sin 900>300/25 d40 p.3 + wn bp1800q1.5 d40 p.75",
  },
  gun: {
    shoot: "shoot(122) wn bp1500q.9 ws2 d90 p.51 + wn hp4000 d20 p.11 + sin 130>42/110 d120 p.19",
    ricochet: "ricochet(202) sin 2400>1600/180 d200 p.29 + wn bp3000q3 d30 p1",
    hit: "hit(46) wn bp2500q1 d30 p.98 + sin 600>250/40 d45 p.26",
  },
  shotgun: {
    shoot: "shoot(521) pn lp3500>900/250 ws3 d260 p.23 + sin 90>35/250 d260 p.18 + wn bp1200q1 d40 p.64 + wn bp1800q2 d15 p.37 @380 + wn bp2600q2 d20 p.29 @470 + sin 300>150/40 d50 p.05 @470",
    hit: "hit(67) wn bp3000q2 d10 p1.6 x5/12±8*.85",
  },
  wand: {
    shoot: "shoot(153) sin F*4>F*8/120 v30/40 e3/150 p.26 + wn hp5000 d80 p.14",
    hit: "hit(252) sin F*4 d250 p.19 + sin F*6 d200 p.14 + sin F*8.04 d160 p.08 + sin 5000 d30 p.09 x4/30*.8^1.06",
  },
  staff: {
    shoot: "shoot(370) sin F*0.5>F*0.75/250 e20/350 p.33 + tri F>F*1.5/250 lp1200 e20/300 p.14",
    hit: "hit(605) sin F*2 e5/600 p.19 + sin F*4 e5/450 p.11 + sin F*6 e5/300 p.06 + pn lp900 e5/120 p.55",
    // the orb turning back: the launch reversed and softer
    return: "return(350) sin F*0.75>F*0.5/250 e250/100 p.2 + tri F*1.5>F/250 lp1000 e250/90 p.08",
  },
  book: {
    shoot: "shoot(312) wn hp3500 d18 p.4 x3/35*.9 + sin F*4 d220 p.3 @90",
    hit: "hit(352) pn lp1200 d60 p.97 + sin F*4 d350 p.2 + sin F*6 d250 p.13",
  },
  cards: {
    shoot: "shoot(125) wn a40/.9 bp2200q2 e5/120 p.96",
    hit: "hit(151) wn hp5000 d35 p.26 + sin F*4 d150 p.12 + sin F*11.04 d110 p.07",
    blink: "blink(61) sin 2000>200/60 d60 p.27 + wn hp4000 d40 p.23",
  },
  fire: {
    shoot: "shoot(930) pn bp380>1400/300q.8 e80/100/.8/150h p1.2 + bn lp300 e60/100/.8/150h p.39 + wn hp6000 d6 p.12 x12/65±40",
    hit: "hit(122) wn hp3000 d120 p.18 + pn lp600 d80 p.74",
  },
  beam: {
    shoot: "shoot(405) saw F*2 a60/.3 m.5i2 bp1800q2 e5/40/.8/60h p.49 + wn bp3500q3 e5/40/.6/60h p.32",
    hit: "hit(56) wn hp4000 d50 p.27 + sin 1500>900/50 d55 p.18",
  },
  spark: {
    shoot: "shoot(141) wn hp2500 d6 p.39 x10/14±8*.92 + sqr 120 bp1500q2 ws4 d120 p.18",
    hit: "hit(31) wn hp3500 d25 p.32 + sin 2000 d30 p.17",
  },
  web: {
    shoot: "shoot(82) wn bp2500>900/70q2.5 d80 p1.4 + sin 1100>500/60 d60 p.11",
    hit: "hit(123) pn lp1200 e3/90 p1.3 + sin 300>180/120 v12/40 e3/120 p.21",
  },
  ice: {
    shoot: "shoot(202) wn hp4000>7000/140 e10/130 p.23 + sin 2637 m3.5i1.5>0/200 d200 p.17",
    hit: "hit(252) wn bp5000q6 d6 p1 x8/25±10*.9 + bar 2200 [.11/250 .07/180] + bn lp700 d90 p.44",
  },
  shield: {
    shoot: "shoot(640) pn a12/.7 bp900q1.2 e40/100/.8/200h p1.6",
    hit: "hit(602) bar F [.16/600 .09/480 .06/360 .03/250] + wn hp3000 d25 p.15 + sin 140>80/100 d120 p.16",
    block: "block(202) bar F*4 [.19/200 .12/150] + wn hp2500 d18 p.28",
    return: "return(150) bar F*2 [.1/150 .05/110] + sin 160>110/60 d80 p.18",
    ricochet: "ricochet(300) bar F*1.5 [.12/300 .07/220] + wn hp3000 d15 p.2",
  },
  tail: {
    swing: "swing(220) pn bp400>1600/220q1 e30/190 p1.7 + wn hp3000 d15 p.14 @200",
    hit: "hit(162) pn lp1500 d100 p.47 + sin 120>60/150 d160 p.21",
  },
  // --- the Stage 2 kinds: our own whip crack and lob ---
  whip: {
    swing: "swing(175) pn bp600>2400/150q1 e20/150 p1.4 + wn hp3500 d12 p.9 @150 + sin 1800>900/20 d25 p.12 @150",
    hit: "hit(110) wn bp3000q1.2 ws2 d30 p.9 + pn lp1800 d90 p.6 + sin 260>160/80 d110 p.16",
    snag: "snag(400) wn bp2200>700/250q2 e10/260 p.9 + saw 140>110/350 bp900q6 e20/380 p.35",
  },
  bomb: {
    shoot: "shoot(350) sin 220>160/60 d70 p.3 + wn bp1800>3200/300q4 e20/330 p.5 + pn lp900 d40 p.4",
    fuse: "fuse(held) wn a23/.6 hp4500 e5/50/.9/40h p.22 + wn hp3000 d5 p.3 x8/70±30*.95",
    hit: "hit(800) sin 75>28/800 ws2 d800 p.24 + bn lp800 d650 p.3 + wn bp1000q1 d45 p.75 + wn bp2600q2 d20 p.2 x6/70±30*.85",
  },
};

/* ------------------------------------------------------------------ ability primitives (26) */

/** The shared power-down chirp of the bursts' end. */
const POWER_DOWN = "end(120) sin 1600>500/120 d120 p.3";

export const FL_PRIMITIVE_SOUNDS: Readonly<Record<FlPrimitive, Readonly<Partial<Record<FlPrimRole, string>>>>> = {
  speedBurst: {
    charge: "charge(500) saw F>F*2/500 lp600>2000/500 e200/300 p.29",
    telegraph: "telegraph(400) saw 200>800/400 lp600>4000/400q1.5 e300/100 p.24 + pn bp800>3000/400 e300/100 p.64",
    fire: "fire(250) pn bp600>3000/250q1 e10/240 p2 + sin 400>1600/150 e5/150 p.12",
    end: POWER_DOWN,
  },
  damageBurst: {
    charge: "charge(500) saw 55 v5/7 lp200>800/500 e200/300 p.25",
    telegraph: "telegraph(400) saw 55 lp300>1500/400 ws3 e300/100 p.27 + saw 110.6 lp300>1500/400 e300/100 p.12",
    fire: "fire(322) sin 70>40/300 d320 p.31 + saw F*0.5 lp1800 ws2 e5/200 p.12 + saw F*0.75 lp1800 ws2 e5/200 p.08",
    end: POWER_DOWN,
  },
  attackSpeedBurst: {
    charge: "charge(369) wn bp2500q4 d8 p1 x5/90*1.1",
    telegraph: "telegraph(400) wn bp2500q4 d8 p1 x9/40*1.05 + sqr F*2>F*4/400 lp2000 e300/100 p.11",
    fire: "fire(300) wn a30/.9 bp2000q2 e10/290 p1 + saw F>F*2/300 lp2500 e10/290 p.11",
    end: POWER_DOWN,
  },
  invulnerable: {
    charge: "charge(500) tri F*2>F*3/500 v6/12 e200/300 p.3",
    telegraph: "telegraph(400) sin F*2 e300/100 p.17 + sin F*2.5 e300/100 p.14 + sin F*3 e300/100 p.11",
    fire: "fire(630) tri F*2 v6/15 e30/300/.4/300 p.2 + tri F*2.5 v6/15 e30/300/.4/300 p.14 + tri F*3 e30/300/.4/300 p.11 + wn hp6000 e5/200 p.08",
    end: "end(122) sin 2000>800/120 d120 p.4",
    impact: "impact(140) tri F*4>F*2/120 d140 p.2 + wn hp4000 d30 p.2",
  },
  freezeAll: {
    charge: "charge(500) wn hp2000>5000/500 e200/300 p.19",
    telegraph: "telegraph(400) wn hp2000>6000/400 e300/100 p.23 + sin 2637 v8/30 e300/100 p.1",
    fire: "fire(502) wn bp5000q2 d30 p.94 + bar 1800 [.1/500 .07/380 .03/260] + bn lp400 e10/300 p.32",
    impact: "impact(167) wn bp5000q6 d6 p1.9 x6/30±10*.85",
  },
  choke: {
    charge: "charge(500) sin 70 a7/.5 e200/300 p.33",
    telegraph: "telegraph(400) sin 70 a7/.6 e300/100 p.39 + tri 140 a7/.6 e300/100 p.19",
    fire: "fire(500) pn bp400>200/500q3 e30/470 p2.2 + saw 90>70/500 bp800q8 e30/470 p1.1",
    sustain: "sustain(held) sin 70 a4/.7 e50/100/1/200h p.19 + saw 90 a4/.5 bp800q10 e50/100/1/200h p.37",
    impact: "impact(322) sin 100>35/300 d320 p.26 + bn lp800 d150 p.29",
  },
  arenaCuts: {
    charge: "charge(500) sin 3000 v4/20 e200/300 p.3",
    telegraph: "telegraph(400) wn hp6000 e300/100 p.15 + sin 3000 m1.37i1>.2/400 e300/100 p.19",
    fire: "fire(302) wn hp3000>7000/200 e5/200 p.19 + bar 2600 [.15/300 .09/200]",
    impact: "impact(202) wn bp6000>1500/90q2 d90 p.87 + bar 2600 [.09/200 .05/140]",
  },
  beam: {
    charge: "charge(500) saw F>F*1.5/500 lp400>1200/500 e200/300 p.33",
    telegraph: "telegraph(400) saw F>F*2/400 lp400>3000/400 e300/100 p.27 + pn bp500>2500/400 e300/100 p.67",
    fire: "fire(202) pn lp2000 d150 p.65 + sin 60 d200 p.22",
    sustain: "sustain(held) saw F*0.5 a20/.3 lp1600 e30/100/.85/200h p.11 + saw F*0.505 lp1600 e30/100/.85/200h p.08 + saw F lp1600 e30/100/.85/200h p.06 + pn bp900q.8 e30/100/.85/200h p.42",
  },
  volley: {
    charge: "charge(411) wn bp2000q3 d10 p1 x5/100",
    telegraph: "telegraph(400) sqr F>F*2/400 lp1500 e300/100 p.14 + wn bp1500q3 d10 p1.7 x8/45",
    fire: "fire(191) wn bp1800q1.2 d40 p.95 x6/30*.9 + sin 300>120/80 d90 p.26",
    explode: "explode(602) sin 80>30/600 d600 p.23 + bn lp1500>300/500 ws2 d550 p.22 + wn bp1200q1 d50 p.62 + wn bp3000q2 d20 p.18 x6/60±30*.8",
  },
  shockwave: {
    charge: "charge(500) sin 40>60/500 e200/300 p.31",
    telegraph: "telegraph(400) pn bp200>800/400 e350/50 p.62 + sin 40>80/400 e350/50 p.26",
    fire: "fire(622) sin 80>30/600 ws1.5 d620 p.24 + bn lp600 d500 p.32 + wn bp1000q1 d40 p.73",
    fuse: "fuse(held) wn a23/.6 hp5000 e5/50/.9/30h p.22 + wn hp3000 d5 p.25 x10/90±40",
    spin: "spin(400) wn a12/.8 bp1000>4000/400q1 e20/380 p1.1 + sin 400>900/400 e20/380 p.09",
  },
  pull: {
    charge: "charge(500) pn bp1500>600/500 e200/300 p.86",
    telegraph: "telegraph(400) pn bp2500>500/400q1 e350/50 p1.3",
    fire: "fire(300) sin 200>600/120 e5/150 p.21 + wn bp600>2400/300q1.5 e10/290 p1.3 + wn bp3500q4 d8 p.7 x6/45*.9",
    sustain: "sustain(held) saw 110>90/700 bp900q6 e20/100/.7/150h p.88",
  },
  decoys: {
    charge: "charge(500) sin F*2 v7/25 e200/300 p.15 + sin F*2.02 e200/300 p.16",
    telegraph: "telegraph(400) sin F*2 v7/30 e300/100 p.18 + sin F*2.03 v5/30 e300/100 p.18 + sin F*3.01 e300/100 p.11",
    fire: "fire(165) pn bp1500q1 e5/120 p1.3 x2/40 L/R.5alt + sin 600>1200/80 d90 p.14 x2/40",
    impact: "impact(71) sin 900>300/60 d70 p.28 + wn bp2000q1 d40 p.62",
  },
  heal: {
    charge: "charge(500) tri F*2 v5/8 e200/300 p.3",
    telegraph: "telegraph(445) tri F*2 e5/200 p.41 + tri F*2.5 e5/200 p.34 @80 + tri F*3 e5/200 p.34 @160 + tri F*4 e5/200 p.27 @240",
    fire: "fire(640) sin F*2 e40/600 p.15 + sin F*2.5 e40/600 p.11 + sin F*3 e40/600 p.11 + sin F*4 e40/500 p.06 + sin 4000 d40 p.04 x6/30^1.06",
  },
  fireRing: {
    charge: "charge(500) pn bp300>900/500 e200/300 p.98",
    telegraph: "telegraph(400) pn bp200>1200/400q.8 e350/50 p1.4",
    fire: "fire(222) bn lp800 e5/200 p.79 + sin 70>45/200 d220 p.25",
    sustain: "sustain(held) pn a5/.3 bp700q.7 e50/100/.8/250h p.81 + wn hp6000 d6 p.09 x30/70±40",
    ringBlades: "ringBlades(held) wn a10/.8 bp2000q1.5 e30/100/.8/200h p.83",
  },
  giantHit: {
    charge: "charge(500) saw 110>165/500 lp600 e200/300 p.25",
    telegraph: "telegraph(400) saw 110>220/400 lp400>2500/400 ws2 e350/50 p.25 + pn bp300>1500/400 e350/50 p.68",
    fire: "fire(302) bar 1500 [.26/300 .16/200]",
    impact: "impact(602) sin 100>35/500 ws2 d520 p.19 + wn bp1500q.9 d50 p.53 + bn lp1000 d400 p.25 + bar F*0.5 [.03/600 .02/400]",
  },
  lightning: {
    charge: "charge(446) wn hp3000 d5 p.29 x6/80±40",
    telegraph: "telegraph(400) wn hp3000 d5 p.3 x16/25±15 + saw 60 lp800 ws4 e300/100 p.17",
    fire: "fire(830) wn hp2000 d30 p.38 + wn bp3000q1 d20 p.46 x4/45±20*.8 + bn lp200 e30/800 p.63",
    impact: "impact(102) wn hp2500 d6 p.4 x6/12±6*.9 + sqr 90 bp1500q2 ws4 d100 p.29",
  },
  confuse: {
    charge: "charge(500) sin F*2 v6/150 e200/300 p.3",
    telegraph: "telegraph(400) sin F*2 v6/300 e300/100 p.4",
    fire: "fire(700) saw 400>250/700 v5/40 lp2000>500/700 e20/680 p.18 + saw 404>247/700 v5.5/40 lp2000>500/700 e20/680 p.18 + wn hp3000 e50/450 p.15",
  },
  blinkStrike: {
    charge: "charge(500) sin 300>600/500 e200/300 p.3",
    telegraph: "telegraph(400) sin 300>1200/400 v20/20 e300/100 p.28 + wn hp4000 e300/100 p.09",
    fire: "fire(61) sin 2000>200/60 d60 p.27 + wn hp4000 d40 p.23",
    impact: "impact(80) wn hp3500 d40 p.3 + sin 1800>600/60 d70 p.15",
  },
  summon: {
    charge: "charge(500) pn bp300>800/500 e200/300 p.98",
    telegraph: "telegraph(400) pn bp300>1500/400 e300/100 p.86 + sin 200>400/400 e300/100 p.18",
    fire: "fire(305) sin 120>60/300 e5/300 p.23 + pn lp800 e5/250 p.48 + sin 150>600/100 d100 p.12 x2/80",
    end: "end(185) pn bp1200q1 e5/120 p2.1 x2/60*.8",
    impact: "impact(120) pn lp1400 d90 p.8 + sin 200>120/100 d120 p.18",
  },
  reflect: {
    charge: "charge(500) sin F*4 m1.41i1>0/500 e200/300 p.3",
    telegraph: "telegraph(400) sin F*4 m1.41i2>.5/400 e300/100 p.4",
    fire: "fire(502) sin F*4 m1.41i3>0/400 d500 p.26 + wn hp5000 d100 p.14",
    impact: "impact(91) sin 2500>3500/80 d90 p.23 + wn hp4000 d20 p.28",
  },
  disarm: {
    charge: "charge(371) wn bp3000q5 d10 p1.2 x4/120",
    telegraph: "telegraph(400) sin 800>1600/400 e300/100 p.4",
    fire: "fire(411) sin 800>2400/80 d80 p.41 + sin 1200 m2.76i1>0/150 d150 p.31 @60 x4/60±20*.7^.9",
    end: "end(20) wn bp2000q2 d15 p.9 + sin 3200 d12 p.06",
  },
  slowTime: {
    charge: "charge(500) sin F>F*0.9/500 e200/300 p.3",
    telegraph: "telegraph(400) sin 800>400/400 e300/100 p.25 + pn lp3000>1000/400 e300/100 p.35",
    fire: "fire(610) sin 800>100/600 e10/600 p.2 + sin 1200>150/600 e10/600 p.1 + pn lp3000>300/600 e10/600 p.37 + sin 60 d120 p.36 x2/180*.7",
    sustain: "sustain(held) sin 55 a1.2/.6 e100/100/1/300h p.24 + tri 110 e100/100/.5/300h p.09",
    end: "end(205) sin 100>800/200 e5/200 p.22 + pn bp400>3000/200 e5/200 p.85",
  },
  // --- the Stage 2 primitives: our own trap, barrier, transformation and drain ---
  trap: {
    charge: "charge(500) wn bp2800q5 d8 p1.1 x7/80*1.05 + sin 900 d20 p.08 x7/80",
    telegraph: "telegraph(400) saw 120>180/400 bp1100q7 e300/100 p.6 + wn bp3500q6 d6 p.8 x6/60",
    fire: "fire(190) sin 240>140/60 d80 p.3 + wn bp2400q3 d18 p1.2 @40 + sin 1800 m2.76i1>0/120 d150 p.1 @40",
    impact: "impact(285) wn bp2600q1.5 ws2 d35 p1.3 + sin 1300>900/40 d60 p.18 + tri 140>260/180 v14/30 e5/240 p.2 @40",
  },
  wall: {
    charge: "charge(500) bn lp300>700/500 a6/.4 e200/300 p.7 + wn bp900q2 d10 p.6 x5/90±30",
    telegraph: "telegraph(400) bn lp200>900/400 e350/50 p.9 + sin 50>90/400 e350/50 p.25",
    fire: "fire(530) bn bp300>1200/300q1 e20/300 p1.3 + sin 70>45/200 d250 p.28 @250 + wn bp1500q1 d40 p.6 @280",
    impact: "impact(90) wn bp1800q1 d40 p.8 + pn lp1200 d90 p.5",
  },
  transform: {
    charge: "charge(500) saw F*0.5>F*0.75/500 lp400>1200/500 e200/300 p.25 + saw F*0.505>F*0.757/500 lp400>1200/500 e200/300 p.2",
    telegraph: "telegraph(400) saw 80>160/400 lp300>2000/400 ws2 e300/100 p.3 + pn bp400>1600/400 e300/100 p.6",
    fire: "fire(620) wn bp900q.8 d40 p.9 + sin 65>35/600 ws1.5 d620 p.26 + pn lp1400>400/500 e10/520 p.5",
    end: "end(280) pn bp1600>500/250q1 e10/260 p1.1 + sin 600>200/250 d280 p.12",
  },
  drain: {
    charge: "charge(500) sin 70 a3/.6 e200/300 p.35 + tri 140 a3/.5 e200/300 p.12",
    telegraph: "telegraph(400) pn bp3000>500/400q1.2 e380/20 p1.2 + sin 220>110/400 e380/20 p.14",
    fire: "fire(410) pn bp400>1600/250q1 e10/400 p1.1 + sin 110>80/400 a5/.6 e10/400 p.28",
    sustain: "sustain(held) sin 55 a1.5/.7 e100/100/.9/250h p.3 + saw 110 a1.5/.5 lp400 e100/100/.9/250h p.12",
  },
};

/* ------------------------------------------------------------------ family sets (a signature at a pitch H) */

/**
 * The family sets a signature may start from, written around H – its own pitch (Hz) – so one set serves several fighters:
 * the energy-blade family pitched by the blade's colour ("saber at H 82"), a blaster, katanas, slashers, brawlers, … Every
 * family is our own synthesis (see the avoid-list).
 */
export const FL_FAMILIES = ["saber", "blaster", "katana", "greatsword", "slasher", "chainsaw", "brawler", "martial", "speedster", "arcane", "pyro", "storm", "gunslinger", "tech", "beast", "cartoon", "bomber", "aqua", "frost", "darklord", "wildwest", "ghost", "psychic", "retro", "blocky", "symbiote"] as const;
export type FlFamily = (typeof FL_FAMILIES)[number];

export const FL_FAMILY_SETS: Readonly<Record<FlFamily, Readonly<Record<string, string>>>> = {
  // An energy blade: two detuned saws a few cents apart over a hum, a doppler swing, a spark-burn hit (no film recording).
  saber: {
    loop: "loop(held) saw H v.3/6 a11/.15 lp1100 e60/100/1/150h p.12 + saw H*1.006 lp1100 e60/100/1/150h p.09 + sqr H*2.01 lp500 e60/100/1/150h p.04 + bn lp300 e60/100/1/150h p.1",
    ignite: "ignite(265) saw H*4>H/250 lp4000>900/250 e5/60/.6/200 p.19 + wn bp3000>800/250q1 e5/250 p.39 + sin 300>120/250 e5/250 p.16",
    swing: "swing(280) saw H>H*1.5/140>H@140/140 lp1200>2500/140 e30/250 p.23 + pn bp1200>2400/150q1 e30/220 p1.1",
    hit: "hit(151) wn bp2500q1 ws3 d90 p.3 + saw H*6>H*3/120 lp5000 ws2 d150 p.11 + wn hp4000 d5 p.09 x6/15±8*.85 + sin 180>90/100 d120 p.14",
    clash: "clash(450) wn bp2500q1 ws3 d90 p.37 + saw H*6>H*3/120 lp5000 ws2 d150 p.13 + wn a35/.6 bp1800q.8 e10/40/.6/300h100 p.23 + wn hp4000 d5 p.1 x10/30±15*.9",
    retract: "retract(225) saw H>H*4/220 lp900>4000/220 e5/220 p.23 + wn bp800>3000/220 e5/220 p.66",
  },
  // A space blaster's FM "pew" (H = 150 for the classic bolt).
  blaster: {
    shoot: "shoot(151) saw H*12>H*2/150 m.5i3>0/150 lp6000 d150 p.24 + wn hp4000 d30 p.17 + sin H*6>H*1.333/80 d90 p.16",
    hit: "hit(80) wn bp2800q1 d40 p.8 + sin H*8>H*3/60 d80 p.15",
  },
  // A thin blade: an airy swish, a high bar ring at H, a drawn-blade shing for the ability.
  katana: {
    swing: "swing(150) wn hp2400>6000/120 e8/140 p.55 + sin H*2 v6/20 e10/140 p.04",
    hit: "hit(380) bar H [.13/380 .07/300 .04/220] + wn hp5000 d20 p.2 + sin 170>110/60 d70 p.12",
    fire: "fire(420) wn hp3000>7000/250 e5/260 p.2 + bar H*1.5 [.12/400 .07/300]",
  },
  greatsword: {
    swing: "swing(260) pn bp500>1600/240q.9 e30/230 p1.5 + sin 70 e20/200 p.12",
    hit: "hit(450) bar H [.15/450 .09/350 .05/250] + bn lp900 d90 p.35 + sin 120>70/80 d100 p.2",
    fire: "fire(520) pn bp300>2400/400q.8 e20/480 p1.2 + bar H*2 [.12/500 .07/360] @20",
  },
  // A knife from the dark: a quick swish, a wet thud with a little ring, a low dissonant swell on the charge.
  slasher: {
    swing: "swing(135) wn bp3000>1200/120q1.2 e5/130 p.8",
    hit: "hit(250) pn lp1200 d60 p.9 + wn bp2500q2 d40 p.5 + bar H [.06/240 .03/160] @10",
    charge: "charge(500) saw 55 lp250 e300/200 p.18 + saw 58.3 lp250 e300/200 p.15 + sin H*2 v8/40 e300/200 p.02",
  },
  // A motor blade: an amplitude-modulated, driven saw (H the engine's note).
  chainsaw: {
    swing: "swing(300) saw H a28/.7 lp1800 ws2 e20/180/.7/100 p.16 + wn bp1500q1 a28/.6 e20/280 p.3",
    hit: "hit(240) saw H*1.5 a40/.8 lp2500 ws3 d240 p.16 + wn bp2200q1 d60 p.5",
    ringBlades: "ringBlades(held) saw H a30/.7 lp2000 ws2 e30/100/.8/200h p.15 + wn bp1800q1 a30/.6 e30/100/.8/200h p.3",
  },
  // Heavy fists: a sub thump with grit (H its low note).
  brawler: {
    swing: "swing(110) pn bp700>350/100q1 e10/100 p2",
    hit: "hit(240) sin H*1.6>H*0.6/220 ws2 d240 p.24 + bn lp800 d120 p.3 + wn bp1600q1 d30 p.4",
    fire: "fire(560) sin H>H*0.5/500 ws1.5 d560 p.28 + bn lp600 d400 p.32 + wn bp900q1 d40 p.7",
  },
  // Kicks and quick strikes: a snappy whoosh, a tight slap, a rising ki whoosh.
  martial: {
    swing: "swing(90) pn bp1600>800/80q1.2 e6/84 p2.2",
    hit: "hit(140) sin H>H*0.4/120 d140 p.25 + wn bp2800q1 d15 p.45 + pn lp2400 d50 p.35",
    fire: "fire(330) pn bp400>2400/300q1 e10/320 p1.3 + sin H*2>H*4/250 e10/250 p.08",
  },
  speedster: {
    swing: "swing(115) pn bp1000>4000/110q1 e5/110 p1.6 + sin H*2>H*5/100 d110 p.06",
    hit: "hit(100) wn hp2500 d10 p.4 x4/14±6*.9 + sin 150>80/80 d100 p.2",
    fire: "fire(415) pn bp600>5000/380q1 e10/405 p1.7 + wn hp4000 d5 p.25 x10/35±15*.9",
  },
  // Spell bells on the fighter's own note.
  arcane: {
    shoot: "shoot(193) sin F*4>F*6/120 m1.5i2>0/150 e3/190 p.25 + wn hp6000 d60 p.1",
    hit: "hit(380) sin F*4 m3.5i2>0/300 d380 p.25 + sin F*8.02 d200 p.07",
    fire: "fire(600) sin F*2 e20/580 p.14 + sin F*3 e20/560 p.1 + sin F*4.01 m2i1>0/400 e20/500 p.09 + wn hp7000 e20/300 p.03",
  },
  // A roaring breath band-passed around H, crackling.
  pyro: {
    shoot: "shoot(930) pn bpH>H*3.5/300q.8 e80/100/.8/150h p1.2 + bn lp250 e60/100/.8/150h p.4 + wn hp6000 d6 p.12 x12/65±40",
    hit: "hit(120) wn hp3000 d120 p.18 + pn lpH*2 d90 p.7",
    fire: "fire(690) pn lp3000>600/650 e10/680 p.7 + sin 60>32/500 d500 p.28 + wn hp5000 d6 p.15 x10/60±30",
  },
  // Lightning: crackles over a driven square buzz at H, a thunder roll.
  storm: {
    shoot: "shoot(130) wn hp2800 d6 p.4 x8/16±8*.92 + sqr H bp1800q2 ws4 d130 p.17",
    hit: "hit(40) wn hp3200 d25 p.35 + sin H*12 d40 p.12",
    fire: "fire(790) wn hp1800 d30 p.4 + wn bp2800q1 d20 p.45 x4/50±20*.8 + bn lp220 e30/760 p.6",
  },
  // A pistol: a crack, a low thump at H, a slide click; a reload and shot for the ability.
  gunslinger: {
    shoot: "shoot(130) wn bp1800q1 ws2 d70 p.5 + wn hp5000 d18 p.12 + sin H*1.2>H*0.4/110 d130 p.2 + wn bp2600q3 d12 p.25 @110",
    hit: "hit(45) wn bp2400q1 d30 p.95 + sin 700>260/40 d45 p.24",
    fire: "fire(470) wn bp2400q3 d12 p.5 + wn bp1800q3 d12 p.45 @150 + wn bp1500q1 ws2 d80 p.6 @300 + sin H>H*0.4/150 d170 p.22 @300",
  },
  // Sci-fi: an FM zap falling from H, a rising charge.
  tech: {
    shoot: "shoot(190) sin H>H*0.25/180 m2i3>0/180 d190 p.24 + wn bp3000q1 d50 p.4",
    hit: "hit(140) sin H*2>H/120 d140 p.18 + wn hp4000 d40 p.25",
    fire: "fire(500) saw H*0.25>H/450 lp1200>4000/450 e30/450 p.18 + sin H*2 v12/20 e300/200 p.08",
  },
  // A creature: a raking hit and an original formant growl at H (never a film's roar).
  beast: {
    hit: "hit(160) wn hp2600 d50 p.3 x2/30*.8 + pn lp1400 d120 p.6 + sin 120>60/120 d160 p.18",
    fire: "fire(900) fmt a>O@700 pH*1.3>H*2>H*0.9 sh.7 v6/30 ws4 e40/860 p.4 + pn bp1100q2 e50/800 p.35 + bn lp200 e40/860 p.15",
    ko: "ko(900) fmt a>O@700 pH*1.2>H*1.8>H*0.8 sh.7 v6/30 ws4 e40/860 p.4 + bn lp200 e40/860 p.15",
    win: "win(700) fmt a>O@500 pH*1.4>H*2>H*1.2 sh.7 v6/30 ws4 e40/660 p.38 + bn lp200 e40/660 p.12",
  },
  // Slapstick: a bonk with a springy tail, a slide-up swing (generic foley, no studio sting).
  cartoon: {
    swing: "swing(200) sin H*2>H*4/180 e10/190 p.14 + pn bp1500q1 e10/150 p.7",
    hit: "hit(305) sin 320>120/80 d110 p.3 + wn bp1800q2 d25 p.6 + tri H*2>H/180 v14/30 e5/240 p.12 @60",
    fire: "fire(490) tri H>H*3/400 v8/20 e10/480 p.2 + wn hp5000 d30 p.1 @400",
  },
  // A fuse and a blast (H the boom's note) – generic, not the block game's.
  bomber: {
    fuse: "fuse(held) wn a23/.6 hp4500 e5/50/.9/30h p.22 + wn hp3000 d5 p.3 x10/80±35*.95",
    hit: "hit(480) sin H*1.2>H*0.5/450 ws2 d480 p.25 + bn lp800 d400 p.3 + wn bp1200q1 d40 p.6",
    fire: "fire(800) sin H>H*0.38/800 ws2 d800 p.25 + bn lp700 d700 p.32 + wn bp900q1 d50 p.75 + bn bp400q2 d40 p.3 x6/60±30*.85",
  },
  // Water: rising bubbles at H, a splash.
  aqua: {
    shoot: "shoot(250) sin H>H*2/60 d70 p.18 x4/45±15^1.15 + pn bp1200q1 e10/240 p.7",
    hit: "hit(120) pn lp1600 d120 p.9 + sin H*0.6>H*1.2/80 d90 p.16 + wn bp3000q2 d30 p.35",
    fire: "fire(690) pn bp500>2200/600q.7 e30/660 p1.2 + sin H>H*2.5/50 d60 p.12 x8/70±30^1.04",
  },
  // Ice: a crystalline hiss with a glassy FM ping at H.
  frost: {
    shoot: "shoot(210) wn hp4000>8000/200 e10/200 p.22 + sin H m3.5i1.5>0/200 d200 p.15",
    hit: "hit(240) wn bp5000q6 d6 p1 x8/25±10*.9 + bar H [.1/240 .06/170] + bn lp700 d90 p.4",
    fire: "fire(560) wn bp5000q2 d30 p.9 + bar H*0.8 [.1/560 .06/400 .03/260] + bn lp400 e10/300 p.3",
  },
  // A tyrant: a dark driven chord on H, a grinding charge.
  darklord: {
    charge: "charge(500) saw H a4/.6 lp300>900/500 e200/300 p.25",
    hit: "hit(290) sin 90>35/280 ws2 d290 p.22 + bn lp700 d150 p.3",
    fire: "fire(890) saw H lp400 ws2 e30/860 p.14 + saw H*1.19 lp400 ws2 e30/860 p.11 + saw H*1.5 lp400 e30/860 p.08 + sin 40 e20/860 p.25",
  },
  // Rope and dust: a whip crack, a leather slap at H, a rolling rumble.
  wildwest: {
    swing: "swing(185) pn bp500>2200/170q1 e15/170 p1.4 + wn hp3500 d12 p.8 @170",
    hit: "hit(120) wn bp2600q1.2 ws2 d30 p.8 + pn lp1500 d90 p.55 + sin H>H*0.6/90 d120 p.16",
    fire: "fire(580) bn lp400>150/550 e20/560 p.7 + sin 50>35/500 d560 p.2 + wn bp700q1 d40 p.4 x5/110±30*.9",
  },
  // A haunting: a wavering sine at H rising, a reversed air swell.
  ghost: {
    charge: "charge(500) sin H*2 v5/80 e300/200 p.16 + sin H*3.02 v4/60 e300/200 p.08",
    hit: "hit(190) sin H*2>H/150 v9/40 d190 p.14 + pn lp1500 d80 p.5",
    fire: "fire(800) sin H>H*1.5/700 v6/60 e100/700 p.18 + pn bp2000>500/700q2 e300/500 p.4",
  },
  // A mind's pressure: a falling pulse, a vast reversed swell with a crack, a strained drone.
  psychic: {
    shoot: "shoot(200) sin H>H*0.5/180 d190 p.24 + pn bp800>300/180q1.5 e10/190 p.8",
    fire: "fire(750) pn bp200>2400/600q1 e600/150 p.8 + sin H*0.5 e500/250 p.2 + wn bp3000q2 d30 p.6 @620",
    sustain: "sustain(held) sin H*0.5 a2/.5 e100/100/.9/250h p.25 + saw H*0.25 lp300 a2/.4 e100/100/.9/250h p.1",
  },
  // A chip-tune voice of our own (square and pulse blips at H; its arpeggio climbs in fourths).
  retro: {
    swing: "swing(80) sqr H*2>H*3/60 lp3000 d80 p.08 + pn bp1500q1 d80 p.7",
    hit: "hit(100) p25 H*2>H/80 d100 p.14 + wn bp2500q2 d20 p.4",
    fire: "fire(410) p25 H*2 d80 p.12 x4/110^1.335",
  },
  // A blocky sandbox voice: square clicks at H.
  blocky: {
    swing: "swing(90) sqr H*3>H*4/60 lp3000 d90 p.07 + pn bp1500q1 d80 p.8",
    hit: "hit(100) sqr H*2>H/80 lp2500 d100 p.12 + wn bp2500q2 d20 p.5",
    fire: "fire(490) sqr H>H*4/400 lp1500>4000/400 e10/480 p.1 + wn hp4000 d30 p.2 @450",
  },
  // A living goo: wet tendril whips and slaps around H.
  symbiote: {
    swing: "swing(180) pn bp800>2000/180q1.2 e20/160 p1.3 + sin H*1.5>H*0.8/150 v8/40 d170 p.12",
    hit: "hit(150) pn lp900 d120 p1 + wn bp1800q2 d40 p.4 + sin H>H*0.55/120 d150 p.2",
    fire: "fire(430) pn bp300>1200/400q1 e30/400 p1.2 + saw H*0.64 a6/.5 lp400 e30/390 p.2",
  },
};

/** The pitch a family set plays at when a signature names none. */
export const FL_FAMILY_DEFAULT_H: Readonly<Record<FlFamily, number>> = { saber: 98, blaster: 150, katana: 800, greatsword: 400, slasher: 1200, chainsaw: 85, brawler: 70, martial: 200, speedster: 400, arcane: 440, pyro: 380, storm: 150, gunslinger: 120, tech: 700, beast: 110, cartoon: 330, bomber: 75, aqua: 450, frost: 2200, darklord: 52, wildwest: 200, ghost: 240, psychic: 300, retro: 300, blocky: 240, symbiote: 110 };

/** The energy blade's hum by its colour (Hz): red 80–87, purple 92, green 96–100, blue 104–108, yellow or white 112. */
export function flSaberHz(color: string | undefined): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(color ?? "");
  if (!m) return 98;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 40) return 112; // white / grey
  if (r === max && b > g + 30) return 92; // purple-ish red
  if (r === max) return g > 170 ? 112 : 84; // yellow : red
  if (b === max) return r > g ? 92 : 106; // purple : blue
  return 98; // green
}

/* ------------------------------------------------------------------ signatures (the 147 fighters) */

/**
 * A fighter's signature set: a family set at its pitch H (`family`, `h`) and roles of its own (they beat the family's). A role
 * key may name a weapon kind or a primitive after an @ ("shoot@gun", "fire@heal"): it then applies to that cue only.
 */
export interface FlSignature {
  family?: FlFamily;
  h?: number;
  roles?: Readonly<Record<string, string>>;
}

export const FL_SIGNATURES: Readonly<Record<string, FlSignature>> = {
  // ---------------------------------------------------------------- Marvel (tint: hero stab on the cast)
  thor: {
    roles: {
      hit: "hit(702) sin 110>45/220 e3/260 p.25 + bar 196 [.06/700 .04/520 .02/360] + wn hp3000 d5 p.05 x5/14±6*.95 + bn lp900 d90 p.25",
      fire: "fire(1040) wn hp1500 d25 p.43 + wn bp2500q1 d20 p.39 x5/40±20*.8 + bn lp180 e40/1000 p.63 + sin 45 e20/900 p.16",
    },
  },
  loki: { roles: { fire: "fire(432) sin F*4 d400 p.19 L.6 + sin F*6 d300 p.14 L.6 + sin F*4 d400 p.19 @30 R.6 + sin F*6 d300 p.14 @30 R.6 + pn bp1500 e5/120 p1.2" } },
  spiderman: {
    roles: {
      shoot: "shoot(71) wn bp3000>800/60q3 d70 p1.4 + sin 1400>600/50 d50 p.11 + wn hp5000 d15 p.09",
      fire: "fire(750) wn bp3000>800/60q3 d70 p1.6 x3/70*.9 + saw 140>110/600 bp1200q8 e10/590 p.47 @150",
    },
  },
  ironman: {
    roles: {
      shoot: "shoot(231) sin 1200>2400/80 e20/60 p.13 + saw 600>150/150 m2i2>0/150 lp3000 d150 p.23 @80 + wn bp2000q1 d80 p.75 @80",
      sustain: "sustain(held) saw 440 a40/.2 lp3000 e20/100/.9/200h p.1 + saw 660 lp3000 e20/100/.9/200h p.08 + sin 1760 v6/20 e20/100/.9/200h p.06 + wn bp2500q1 e20/100/.9/200h p.14",
    },
  },
  captainamerica: {
    roles: {
      hit: "hit(902) bar 523 [.13/900 .08/700 .04/500 .03/300] + wn hp3000 d20 p.12 + sin 140>80/100 d120 p.13",
      block: "block(202) bar 2093 [.18/200 .12/150] + wn hp2500 d18 p.26",
    },
  },
  hulk: {
    roles: {
      hit: "hit(262) sin 80>32/250 ws3 d260 p.2 + bn lp800 d150 p.27 + wn bp1500q1 d40 p.36 + bn bp600q2 d30 p.38 x5/30±10*.8",
      fire: "fire(902) sin 60>25/900 ws2 d900 p.28 + bn lp500 e5/800 p.37 + wn bp900q1 d40 p.84 + bn bp300q2 d40 p.45 x6/70±30*.85",
    },
  },
  venom: { family: "symbiote", h: 110 },
  thanos: { family: "darklord", h: 49, roles: { fire: "fire(850) wn bp2500q4 d10 p1.4 + wn hp3000>800/800q1 e700/150 p.3 + sin 55 e500/350 p.2" } },
  deadpool: { family: "katana", h: 1100 },
  wolverine: { family: "beast", h: 100, roles: { swing: "swing(150) wn hp3500>8000/100 e5/110 p.5 + bar 2400 [.05/150 .03/100]" } },
  // ---------------------------------------------------------------- DC (tint: hero stab)
  superman: {
    roles: {
      shoot: "shoot(425) saw 220 a50/.3 m1.5i3 lp2500 e5/40/.8/80h p.24 + wn a25/.5 hp3000 e5/40/.8/80h p.14",
      fire: "fire(805) sin 70>30/700 d700 p.26 + bn lp800 d500 p.32 + sin F*4 e5/800 p.05 + sin F*5 e5/800 p.05 + sin F*6 e5/800 p.04",
    },
  },
  batman: {
    roles: {
      shoot: "shoot(260) pn a22/.9 bp1600q2 e10/250 p2.5 + tri 700>900/250 a22/.8 lp1500 e10/250 p.1",
      fire: "fire(1250) wn bp2000q.8 d30 p1.1 + pn hp800 lp4000 e50/1200 p.48",
    },
  },
  joker: { roles: { fire: "fire(980) wn bp1500q1 d30 p1.5 + wn a4/.3 hp2500 e80/900 p.15 + saw 400>250/700 v5/40 lp2000>500/700 e20/680 p.11 + saw 404>247/700 v5.5/40 lp2000>500/700 e20/680 p.11" } },
  wonderwoman: {
    roles: {
      block: "block(251) sin 2637 d180 p.15 + sin 7278 d120 p.08 + wn hp3500 d12 p.27 + sin 1318 d250 p.08",
      fire: "fire(620) wn hp2500 d12 p.38 + pn bp800>3000/120 e5/120 p.68 + sin 1760 v6/15 e20/600 p.06 + sin 2217 v6/15 e20/600 p.05 + sin 2637 v6/15 e20/600 p.05",
    },
  },
  flash: { family: "speedster", h: 420 },
  aquaman: { family: "aqua", h: 360 },
  harleyquinn: { family: "cartoon", h: 330 },
  darkseid: { family: "darklord", h: 52, roles: { shoot: "shoot(420) saw H*4 a60/.4 m1.5i3 lp2200 e5/40/.8/80h p.22 + sin H*2 e5/40/.8/80h p.1" } },
  // ---------------------------------------------------------------- Nintendo & Sega (tint: chip chirp on swings and charges)
  mario: {
    roles: {
      intro: "intro(120) p25 330>990/110 d120 p.46",
      charge: "charge(350) p25 1046.5 d50 p.31 + p25 1568 v6/8 d300 p.32 @50",
      sustain: "sustain(held) p12 F*2 a6.67/.9 e20/100/.8/200h p.18 + sin F*8 v8/30 a10/.5 e20/100/.8/200h p.09",
      shoot: "shoot(70) p25 800>400/60 d70 p.4 + wn hp3000 d15 p.3",
      ricochet: "ricochet(60) p25 400>1000/50 d60 p.4",
    },
  },
  link: {
    roles: {
      swing: "swing(128) wn bp1200>4000/120q1.4 e8/120 p.93 + sin 2000>2600/120 e8/120 p.06",
      charge: "charge(500) sin 400>1600/500 v8/15 e200/300 p.27 + sin 5000 d30 p.09 x6/80^1.05",
      fire: "fire(710) wn a12/.8 bp1000>4000/400q1 e20/380 p1.2 + ks F*2 d.995 d400 p.2 x6/35^1.189 + sin 4186 v6/20 e10/500 p.06 @200",
    },
  },
  samus: {
    roles: {
      charge: "charge(500) saw 180>400/500 a24/.5 lp1500 e200/300 p.18 + sin F*4>F*6/500 e200/300 p.12",
      fire: "fire(402) saw 600>80/400 m.5i2>0/400 ws2 d400 p.18 + sin 80>40/400 d400 p.24 + pn lp2500 d120 p.42",
    },
  },
  captainfalcon: {
    roles: {
      telegraph: "telegraph(400) pn bp300>1500/400 e350/50 p.9 + bn lp300 e350/50 p.37 + saw 110>220/400 lp1500 ws2 e350/50 p.15",
      impact: "impact(522) sin 100>35/500 ws2 d520 p.21 + wn bp1500q.9 d50 p.62 + bn lp1000 d400 p.27 + pn bp1000q.8 e5/350 p.54 + sin 2500>1800/250 v30/50 e10/250 p.04",
    },
  },
  littlemac: {
    roles: {
      hit: "hit(41) sin 300>120/30 d40 p.26 + wn bp1500q1 d25 p.8 + pn lp1200 d40 p.44",
      fire: "fire(952) bar 880 [.17/800 .13/600 .07/400] x2/150",
    },
  },
  sonic: {
    roles: {
      charge: "charge(331) sin 2093 m3.5i1>0/200 d250 p.28 L.4 + sin 3136 m3.5i1>0/200 d300 p.28 @30 R.4",
      telegraph: "telegraph(400) saw 200>500/120 a28/.6 lp2500 e5/120 p.3 x3/130^1.25 + pn bp800>2000/400 e300/100 p.68",
      fire: "fire(255) pn bp800>4000/250q1 e5/250 p2.4 + sin 300>1500/200 e5/200 p.19",
    },
  },
  kirby: { family: "cartoon", h: 520, roles: { fire: "fire(680) pn bp3000>600/600q1.2 e400/280 p1.3 + sin 300>150/600 v10/30 e300/380 p.1" } },
  donkeykong: { family: "brawler", h: 70, roles: { fire: "fire(600) sin 90>40/120 d150 p.3 x4/150*.95 + bn lp600 d100 p.4 x4/150" } },
  bowser: { family: "pyro", h: 280, roles: { fire: "fire(890) fmt a>O@800 p90>140>70 sh.65 v5/30 ws5 e40/850 p.4 + bn lp180 e40/850 p.2 + pn bp700q2 e40/800 p.3" } },
  shadow: { family: "tech", h: 700, roles: { fire: "fire(800) pn bp4000>400/500q1 e400/100 p.9 + sin 1800>900/300 m2i2>0/300 d300 p.15 @500" } },
  // ---------------------------------------------------------------- League of Legends (tint: arcane bell on the charge)
  yuumi: {
    roles: {
      telegraph: "telegraph(400) wn hp3500 d18 p.27 x10/25 + sin F*4>F*6/400 e300/100 p.2 + saw 470>840/220 bp800>1700/220q5 e10/210 p1 @150",
      sustain: "sustain(held) sin F*4 v6/20 a8/.4 e30/100/1/200h p.08 + sin F*5 v6/20 e30/100/1/200h p.07 + sin F*6 e30/100/1/200h p.06 + wn a8/.5 hp5000 e30/100/1/200h p.04",
    },
  },
  katarina: {
    roles: {
      blink: "blink(61) sin 2200>300/60 d60 p.25 + wn hp4000 d40 p.22",
      sustain: "sustain(held) wn a16/.8 bp3000q1.5 e30/100/.8/200h p.38 + wn hp5000 d30 p.11 x20/90±40",
    },
  },
  garen: {
    roles: {
      telegraph: "telegraph(400) sin 3000>600/400 e350/50 p.18 + wn bp2000>600/400q2 e350/50 p.89",
      impact: "impact(830) sin 100>35/500 ws2 d520 p.21 + wn bp1500q.9 d50 p.61 + bn lp1000 d400 p.26 + fmt a>a@800 p131>131 e30/800 p.41 + fmt a>a@800 p196>196 e30/800 p.39 + fmt a>a@800 p262>262 e30/800 p.3",
    },
  },
  jinx: {
    roles: {
      shoot: "shoot(36) wn bp2000q1 d20 p1 + sin 1500>700/30 d35 p.15",
      fire: "fire(600) pn bp600>2000/600q1 e10/590 p2 + sin 1500>900/600 e20/580 p.07",
    },
  },
  ahri: { roles: { impact: "impact(92) pn bp2000>600/90q1 d90 p2.3 + sin 1600>800/90 v20/30 d90 p.14 + sin 5000 d30 p.06 x3/25^1.06" } },
  lux: { family: "arcane", roles: { sustain: "sustain(held) sin F*4 a8/.3 e30/100/.9/200h p.1 + sin F*5 e30/100/.9/200h p.08 + sin F*6 e30/100/.9/200h p.07 + wn bp4000q1 e30/100/.9/200h p.1" } },
  yasuo: { family: "katana", h: 880, roles: { fire: "fire(700) pn bp300>1500/600q.7 e60/640 p1.3 + wn hp3000 e100/500 p.15" } },
  leesin: { family: "martial", h: 180 },
  // ---------------------------------------------------------------- Fighting games (tint: a low drum on the charge)
  ryu: {
    roles: {
      shoot: "shoot(460) sin 140>90/200 ws2 d220 p.3 + pn bp800>400/400q1 e10/450 p1.2 + sin F>F*0.5/300 e10/300 p.07",
      impact: "impact(522) sin 100>35/500 ws2 d520 p.2 + wn bp1500q.9 d50 p.59 + bn lp1000 d400 p.26 + sin 200>800/150 e5/150 p.05",
    },
  },
  ken: {
    roles: {
      shoot: "shoot(460) sin 140>90/200 ws2 d220 p.25 + pn bp800>400/400q1 e10/450 p.91 + wn hp6000 d5 p.1 x8/40±20*.95 + pn bp1200q.8 e10/350 p.63",
      impact: "impact(522) sin 100>35/500 ws2 d520 p.2 + wn bp1500q.9 d50 p.59 + bn lp1000 d400 p.26 + sin 200>800/150 e5/150 p.05",
    },
  },
  chunli: { roles: { sustain: "sustain(held) pn a14/.8 bp1500q1 e30/100/.8/200h p.91 + sin 900>1400/900>900@900/900 a14/.5 e30/100/.8/200h p.05" } },
  scorpion: {
    roles: {
      shoot: "shoot(250) wn bp3500q4 d8 p1.5 x10/22±6*.95 + wn bp1500>3500/250q2 e20/230 p1.2",
      fire: "fire(605) pn lp3000>500/600 e5/600 p.66 + sin 60>30/400 d400 p.28",
    },
  },
  subzero: {
    roles: {
      shoot: "shoot(202) wn hp3000>8000/200 e10/190 p.24 + sin 2637 m3.5i1.5>0/200 d200 p.14",
      fire: "fire(500) sin 1568 d150 p.19 x6/35^1.12 + wn hp5000 e100/400 p.19",
    },
  },
  akuma: { family: "martial", h: 150, roles: { "shoot@gun": "shoot(460) sin 110>70/200 ws2 d220 p.3 + pn bp600>300/400q1 e10/450 p1.2 + saw 55 lp500 e10/400 p.1" } },
  liukang: { family: "martial", h: 220, roles: { "shoot@gun": "shoot(400) sin 160>100/180 ws1.5 d200 p.28 + pn bp900>500/350q1 e10/390 p1 + wn hp6000 d5 p.1 x6/50±20*.9" } },
  raiden: { family: "storm", h: 160 },
  kazuya: { family: "brawler", h: 64, roles: { impact: "impact(500) sqr 120 bp2000q2 ws5 d120 p.15 + wn hp3000 d5 p.3 x6/12±6*.9 + sin 100>35/500 ws2 d500 p.22 + bn lp900 d350 p.25" } },
  // ---------------------------------------------------------------- Game legends (tint: an interface blip on the charge)
  masterchief: {
    roles: {
      shoot: "shoot(256) wn bp1600q1 ws2 d60 p.41 x3/70 + sin 150>60/80 d80 p.2 x3/70 + wn hp5000 d10 p.1 x3/70 + wn bp2200q2 d15 p.33 @240",
      telegraph: "telegraph(400) sin 300>1200/400 a30/.5 e350/50 p.26 + wn hp3000 e350/50 p.13",
    },
  },
  doomslayer: {
    roles: {
      shoot: "shoot(491) pn lp3500>900/250 ws4 d260 p.21 + sin 80>30/300 d300 p.2 + wn bp1200q1 d40 p.59 + wn bp1800q2 d15 p.34 @380 + wn bp2600q2 d20 p.26 @470",
      telegraph: "telegraph(400) saw 55 a12/.4 lp300>2500/400 ws3 e350/50 p.19 + saw 82.5 lp300>2500/400 ws3 e350/50 p.13 + saw 110 lp300>2500/400 e350/50 p.08 + sin 800>2400/400 e350/50 p.09",
      sustain: "sustain(held) saw 110 a30/.3 m1.5i1.5 bp1200q.8 ws2 e20/100/.9/200h p.11 + saw 165 bp1200q.8 ws2 e20/100/.9/200h p.08 + pn bp900 e20/100/.9/200h p.23 + sin 40 e20/100/.9/200h p.08",
    },
  },
  kratos: {
    roles: {
      swing: "swing(250) wn bp3500q4 d8 p1.3 x8/28±8*.9 + pn bp600>1800/250q.8 e20/230 p1.9 + wn hp6000 d5 p.15 x4/50±20*.95",
      fire: "fire(610) sin 60>30/500 d500 p.33 + saw F*0.5 lp1500 ws3 e5/300 p.09 + saw F*0.6 lp1500 ws3 e5/300 p.07 + pn bp800q.7 e10/600 p.72",
    },
  },
  zeus: { family: "storm", h: 140 },
  laracroft: { family: "gunslinger", h: 140 },
  cloud: { family: "greatsword", h: 300 },
  sephiroth: { family: "katana", h: 700 },
  arthurmorgan: { family: "gunslinger", h: 110, roles: { sustain: "sustain(held) sin 55 a1.1/.7 e100/100/1/300h p.3 + tri 110 a1.1/.4 e100/100/.5/300h p.08" } },
  pacman: { family: "retro", h: 330 },
  // ---------------------------------------------------------------- Shonen anime (tint: a ki riser on the charge)
  goku: {
    roles: {
      charge: "charge(500) sin 110>220/500 a8/.4 e200/300 p.29 + wn hp5000 d5 p.1 x6/80±40*.95",
      telegraph: "telegraph(400) saw 220>880/400 lp600>4000/400 e350/50 p.16 + sin 440>1760/400 v12/30 e350/50 p.16 + wn hp3000 e350/50 p.1 + wn hp6000 d5 p.13 x10/35±15*.95",
      sustain: "sustain(held) saw 110 a25/.3 lp2000 e30/100/.9/250h p.08 + saw 110.7 lp2000 e30/100/.9/250h p.07 + pn bp1200q.7 e30/100/.9/250h p.31 + sin 880 v7/40 e30/100/.9/250h p.04 + bn lp200 e30/100/.9/250h p.13",
    },
  },
  vegeta: {
    roles: {
      telegraph: "telegraph(400) sin F*4>F*6/400 e350/50 p.13 + sin F*5>F*7.5/400 e350/50 p.1 + sin F*6>F*9/400 e350/50 p.09 + wn hp2000 e350/50 p.1",
      fire: "fire(302) wn hp1000 d80 p.24 + sin 60>30/300 d300 p.2",
      sustain: "sustain(held) saw 147 a30/.3 lp2500 ws2 e30/100/.9/250h p.09 + saw 220 lp2500 e30/100/.9/250h p.06 + pn bp1800q.7 e30/100/.9/250h p.35 + bn lp200 e30/100/.9/250h p.13",
    },
  },
  naruto: {
    roles: {
      shoot: "shoot(155) wn a45/.9 bp3000q2 e5/150 p.86 + sin 4000 d40 p.13",
      fire: "fire(245) pn bp900q.8 e5/180 p1.6 x2/60 L/R.6alt + sin 500>900/80 d80 p.14 x2/60",
    },
  },
  sasuke: {
    roles: {
      telegraph: "telegraph(400) sin 3000>4500/15 d15 p.22 x24/16±8 + sqr 220 a40/.6 bp2500 ws4 e300/100 p.23",
      impact: "impact(61) sin 2500>400/60 d60 p.24 + wn hp4000 d40 p.2 + wn hp3000 d5 p.13 x6/10±5*.95",
    },
  },
  luffy: {
    roles: {
      swing: "swing(155) sin 200>600/150 v18/80 e5/150 p.46 + tri 150>450/150 lp1200 e5/150 p.22",
      sustain: "sustain(held) sin 300>700/80 v18/60 d80 p.2 x20/90±20 + wn bp1800q1 d20 p.5 @40 x20/90±20",
    },
  },
  saitama: {
    roles: {
      telegraph: "telegraph(326) sin 1600 d25 p.41 @300",
      impact: "impact(1402) sin 60>20/1400 ws2 d1400 p.22 + wn bp1200q1 d60 p.75 + bn lp1000>200/1200 d1200 p.27 + pn bp800>200/1000 e50/950 p.22 + bn bp400q2 d40 p.29 x6/90±40*.85",
    },
  },
  zoro: { family: "katana", h: 620 },
  itachi: { family: "pyro", h: 500, roles: { fire: "fire(880) pn bp200>1600/700q1 e650/200 p.8 + sin 440 m1.41i3>0/600 e300/580 p.15" } },
  frieza: { family: "darklord", h: 62, roles: { shoot: "shoot(420) sin H*24>H*12/300 m3i2>0/300 e5/40/.8/80h p.12 + wn hp5000 e5/40/.6/80h p.1" } },
  // ---------------------------------------------------------------- Star Wars (tint: a force swell on the charge; the blade's hum by its colour)
  luke: { family: "saber", h: 98, roles: { fire: "fire(410) pn lp1200>300/400 e10/400 p.49 + sin 90>40/400 e5/400 p.22 + pn a18/.6 bp400 e10/300 p.34" } },
  vader: {
    family: "saber",
    h: 82,
    roles: {
      loop: "loop(held) saw H v.3/6 a11/.15 lp750 ws1.5 e60/100/1/150h p.15 + saw H*1.006 lp750 e60/100/1/150h p.09 + sqr H*2.01 lp500 e60/100/1/150h p.04 + bn lp300 e60/100/1/150h p.1",
      sustain: "sustain(held) saw 55 a3/.4 lp300 ws2 e50/200/.8/300h p.16 + saw 90>70/2000 bp700q10 e50/200/.8/300h p.31 + pn bp300>150/2000q4 e50/200/.8/300h p.72",
    },
  },
  yoda: {
    family: "saber",
    h: 110,
    roles: {
      swing: "swing(200) saw H>H*1.5/100>H@100/100 lp1300>2800/100 e20/180 p.26 + pn bp1500>3000/100q1 e20/160 p1.8",
      sustain: "sustain(held) sin 220>260/2000 a2/.3 e100/100/1/200h p.14 + sin 330>390/2000 e100/100/1/200h p.09 + wn a2/.5 hp6000 e100/100/1/200h p.03",
      impact: "impact(502) sin 100>30/500 d500 p.27 + bn lp800 d300 p.31 + wn bp600q2 d30 p.57 x5/50±20*.8",
    },
  },
  maul: {
    family: "saber",
    h: 87,
    roles: {
      loop: "loop(held) saw H v.3/6 a11/.15 lp850 e60/100/1/150h p.11 L.3 + saw H*1.012 a13/.15 lp850 e60/100/1/150h p.11 R.3 + sqr H*2.011 lp500 e60/100/1/150h p.04 + bn lp300 e60/100/1/150h p.09",
      sustain: "sustain(held) saw 104>139/600>87@600/600 a16/.7 lp1500 e20/100/.8/100h p.14 + pn a16/.7 bp1500 e20/100/.8/100h p.54",
    },
  },
  obiwan: { family: "saber", h: 106 },
  kyloren: { family: "saber", h: 84, roles: { loop: "loop(held) saw H a11/.2 lp800 ws2 e60/100/1/150h p.22 + saw H*1.007 lp800 e60/100/1/150h p.11 + wn hp3500 a17/.9 e60/100/.6/150h p.1" } },
  palpatine: { family: "storm", h: 150, roles: { shoot: "shoot(290) sqr H a37/.6 bp2200q1 ws6 e10/280 p.3 + wn hp2500 d5 p.3 x10/25±12*.95" } },
  mandalorian: { family: "blaster", h: 150 },
  // ---------------------------------------------------------------- Fantasy (tint: a harp glissando on heals and summons)
  harrypotter: {
    roles: {
      charge: "charge(531) sin F*4 m3.5i1.5>0/150 d200 p.29 x4/110^1.122",
      fire: "fire(651) wn hp2500 d15 p.4 + sin 1200>3000/300 e5/300 p.11 + sin 1200 m2.76i1>0/150 d150 p.09 @300 x4/60±20*.7^.9",
    },
  },
  voldemort: {
    roles: {
      telegraph: "telegraph(400) wn a9/.4 hp4000>2000/400 e350/50 p.09 + sin 55 e350/50 p.23 + saw 58 lp300 e350/50 p.1",
      fire: "fire(452) pn bp400>3000/250q1 e10/240 p.88 + wn hp2000 d30 p.37 @250 + sin 80>40/200 d200 p.15 @250",
    },
  },
  gandalf: { roles: { fire: "fire(1362) sin 60>25/1000 ws1.5 d1000 p.29 + wn bp1000q1 d40 p.83 + sin F*4 e5/800 p.05 + sin F*6 e5/800 p.04 + sin F*8 e5/800 p.03 | echo180/.4/lp2000/.3" } },
  legolas: { roles: { fire: "fire(456) ks F d.985 d180 p.33 x12/25^1.01 + wn bp3000q4 e5/100 p.42 x6/40" } },
  hermione: { family: "arcane" },
  dumbledore: { family: "arcane", roles: { fire: "fire(680) pn bp300>1400/500q.8 e40/640 p1.2 + bn lp300 e40/640 p.3 + sin F*2 e20/600 p.08" } },
  aragorn: { family: "greatsword", h: 420, roles: { fire: "fire(880) sin 220>330/800 v5/50 e300/580 p.12 + sin 277>415/800 v4/40 e300/580 p.1 + pn bp1500>400/800q2 e300/580 p.4" } },
  sauron: { family: "darklord", h: 46, roles: { sustain: "sustain(held) saw H a3/.4 lp500 ws2 e50/200/.8/300h p.16 + pn bp700q1.5 a3/.4 e50/200/.8/300h p.5 + sin 1200 v4/40 e50/200/.8/300h p.02" } },
  geralt: { family: "greatsword", h: 520, roles: { fire: "fire(480) pn bp400>2000/350q.7 e20/460 p1.6 + sin 120>50/300 d340 p.22" } },
  // ---------------------------------------------------------------- Movie monsters (tint: a beast roar on the intro, the KO and the win)
  godzilla: {
    roles: {
      charge: "charge(461) wn hp3000 d8 p.19 x8/60 + sin 800 d40 p.11 x8/60^1.08",
      sustain: "sustain(held) saw 82 a30/.3 lp1500 ws2 e30/100/.9/250h p.09 + saw 123 lp1500 e30/100/.9/250h p.05 + pn bp1500q.6 e30/100/.9/250h p.24 + sin 1200 v9/60 e30/100/.9/250h p.03 + sin 41 e30/100/.9/250h p.07",
      ko: "ko(1340) fmt a>O@700 p130>210>90 sh.6 v6/30 ws5 e40/1300 p.37 + pn bp1200q2 e50/1200 p.38 + pn bp2600q3 e50/1000 p.27 + saw 55 lp300 e40/1200 p.04 + bn lp200 e40/1300 p.15",
      win: "win(1340) fmt a>O@700 p130>210>90 sh.6 v6/30 ws5 e40/1300 p.37 + pn bp1200q2 e50/1200 p.38 + pn bp2600q3 e50/1000 p.27 + saw 55 lp300 e40/1200 p.04 + bn lp200 e40/1300 p.15",
    },
  },
  kingkong: {
    roles: {
      fire: "fire(821) sin 110>70/60 d120 p.24 x6/140*1.03 L/R.4alt + pn lp500 d80 p.36 x6/140 + pn bp300q2 d100 p.87 x6/140",
      ko: "ko(1040) fmt a>o@800 p160>240>120 sh.75 v5/25 ws3 e40/1000 p.44 + pn bp1000q1.5 e40/900 p.32 + bn lp200 e40/1000 p.11",
      win: "win(1040) fmt a>o@800 p160>240>120 sh.75 v5/25 ws3 e40/1000 p.44 + pn bp1000q1.5 e40/900 p.32 + bn lp200 e40/1000 p.11",
    },
  },
  alien: {
    roles: {
      telegraph: "telegraph(400) wn hp3000 e20/380 p.26 + wn bp2500q5 d6 p.84 x10/20±8",
      fire: "fire(1030) wn hp2500 e30/1000 p.29 + wn bp5000q2 d8 p.4 x12/80±40",
    },
  },
  predator: {
    roles: {
      telegraph: "telegraph(291) wn bp1200q8 d4 p4.5 x14/22*.95",
      shoot: "shoot(401) sin 800>2400/200 a40/.5 e10/190 p.09 + sin 200>60/200 d200 p.25 @200 + pn lp1500 d150 p.55 @200 + sin 900 m1.5i3>0/150 d150 p.08 @200",
      fire: "fire(500) sin 1500>300/500 v7/300 m1.5i4>0/500 e10/490 p.27 + wn hp5000 d5 p.25 x10/40±20*.95",
    },
  },
  trex: { family: "beast", h: 85 },
  jaws: { family: "beast", h: 140, roles: { hit: "hit(260) wn bp1800q1 d40 p.6 + pn lp1000 d150 p.8 + sin 180>90/150 d200 p.2 + pn bp600>1800/200q1 e10/220 p.5 @30" } },
  // ---------------------------------------------------------------- Action movies (tint: a mechanical clack after the shots)
  johnwick: {
    roles: {
      shoot: "shoot(321) pn bp900q1 d50 p1.7 + sin 200>90/60 d60 p.16 + wn hp4000 d12 p.1 + wn bp2500q3 d12 p.38 @45 + sin 4200 d80 p.03 @180 x2/60^1.1",
      fire: "fire(455) wn bp1800q2 d15 p1.8 + wn bp2600q2 d20 p1.4 @120 + saw 55 lp600 ws2 e5/300 p.27 @150",
    },
  },
  neo: {
    roles: {
      fire: "fire(610) sin 800>100/600 e10/600 p.2 + pn lp3000>300/600 e10/600 p.37 + sin 60 d120 p.37 x2/180*.7 + sqr 2000 d8 p.06 x8/40±20^1.15",
      sustain: "sustain(held) sin 45 a1.2/.6 e100/100/1/300h p.24 + tri 90 e100/100/.5/300h p.09",
    },
  },
  terminator: {
    roles: {
      shoot: "shoot(461) pn lp3500>900/250 ws3 d260 p.23 + sin 90>35/250 d260 p.18 + wn bp1200q1 d40 p.64 + wn bp1600q2 d15 p.41 @360 + wn bp2400q2 d20 p.29 @440 + sin 600>900/150 a50/.5 e10/140 p.02 @300",
      fire: "fire(665) wn bp1500q1 d25 p.59 x12/30 + sin 120>60/30 d30 p.21 x12/30 + saw 400>100/300 lp1500 e5/300 p.04 @360",
      ko: "ko(902) sin 900>60/900 e10/890 p.3 + sqr 55 lp400 d200 p.37 @700",
    },
  },
  robocop: { roles: { fire: "fire(585) sqr 1760 lp4000 d50 p.29 x3/90 + sin 2349 e5/300 p.4 @280" } },
  indianajones: { family: "wildwest", h: 200 },
  jamesbond: { family: "gunslinger", h: 160, roles: { sustain: "sustain(held) saw 880 a50/.3 lp4000 e20/100/.9/200h p.06 + sin 1760 e20/100/.9/200h p.04 + wn bp5000q2 e20/100/.9/200h p.1" } },
  rambo: { family: "wildwest", h: 150, roles: { shoot: "shoot(280) ks F*0.4 d.985 d280 p.5 + wn bp2600>1200/180q5 e10/170 p.7 @10 + sin 90>60/60 d70 p.15" } },
  jacksparrow: { family: "gunslinger", h: 100, roles: { explode: "explode(780) sin 70>28/750 ws2 d780 p.25 + bn lp700 d600 p.3 + wn bp800q1 d60 p.7 + pn bp400>150/500q1 e10/700 p.3" } },
  // ---------------------------------------------------------------- TV (tint: a cinematic boom on the cast)
  homelander: {
    roles: {
      shoot: "shoot(425) saw 330 a60/.4 m2i4 lp3000 e5/40/.8/80h p.25 + wn a40/.6 hp3500 e5/40/.8/80h p.15",
      sustain: "sustain(held) saw 330>290/750>330@750/750 a60/.4 m2i4 lp3000 e20/100/.9/200h p.1 + wn a40/.6 hp3500 e20/100/.9/200h p.07 + sin 165 e20/100/.9/200h p.07",
    },
  },
  omniman: {
    roles: {
      hit: "hit(272) sin 80>30/260 ws4 d270 p.24 + wn bp1400q1 d40 p.57 + bn lp800 d150 p.25",
      fire: "fire(502) wn bp800q.7 d40 p1.1 + sin 60>30/500 d500 p.21 + pn lp2000>300/400 e5/400 p.31",
    },
  },
  aang: {
    roles: {
      swing: "swing(290) pn bp500>1500/250q.7 e40/250 p1.3 + pn lp400 e20/150 p.56",
      fire: "fire(400) pn bp500>2000/400 e10/390 p.96 + bn lp800 e5/200 p.55 + wn hp2000 d30 p.42 @150",
    },
  },
  zuko: { roles: { sustain: "sustain(held) sqr 160 a40/.6 bp2000q1 ws5 e5/50/.8/100h p.21 + wn hp3000 d5 p.23 x20/40±20*.95" } },
  jonsnow: { roles: { fire: "fire(900) fmt u>a@400>u@900 p400>650>450 v5/20 e60/840 p.79 + pn bp1500q2 e60/800 p.14" } },
  nightking: {
    roles: {
      shoot: "shoot(252) wn bp4000>2000/250q5 e10/240 p.86 + sin 2637 m3.5i1.5>0/250 d250 p.14",
      fire: "fire(620) saw 55 lp400 ws2 e20/600 p.16 + saw 65.4 lp400 ws2 e20/600 p.12 + saw 77.8 lp400 ws2 e20/600 p.09 + wn bp5000q6 d6 p.54 x8/30±10 + sin 90>45/150 d150 p.24 x3/80",
    },
  },
  walterwhite: { family: "bomber", h: 72, roles: { shoot: "shoot(350) bar 1800 [.08/200 .05/150] + wn bp1800>3200/300q4 e20/330 p.4 + sin 220>160/60 d70 p.2" } },
  eleven: { family: "psychic", h: 330 },
  daenerys: { family: "pyro", h: 240, roles: { fire: "fire(990) fmt a>O@900 p120>190>85 sh.6 v6/30 ws5 e40/950 p.35 + pn bp380>1400/400q.8 e60/900 p.9" } },
  // ---------------------------------------------------------------- Pokémon (tint: a small chime on the charge – no cry, no jingle)
  pikachu: {
    roles: {
      shoot: "shoot(122) wn hp3000 d5 p.38 x12/10±6*.95 + sqr 180 bp2000q2 ws5 d100 p.16",
      fire: "fire(730) sqr 160 a40/.6 bp2000q1 ws5 e5/400 p.12 + wn hp2000 d30 p.42 + bn lp200 e30/700 p.61",
    },
  },
  charizard: {
    roles: {
      shoot: "shoot(930) pn bp380>1400/300q.8 e80/100/.8/150h p1.1 + bn lp200 e60/100/.8/150h p.34 + pn bp500q2 e60/100/.8/150h p.38 + pn bp1100q3 e60/100/.8/150h p.36",
      ko: "ko(1240) fmt a>O@700 p130>200>90 sh.6 v6/30 ws5 e40/1200 p.4 + pn bp1200q2 e50/1100 p.4 + saw 55 lp300 e40/1000 p.04",
      win: "win(1240) fmt a>O@700 p130>200>90 sh.6 v6/30 ws5 e40/1200 p.4 + pn bp1200q2 e50/1100 p.4 + saw 55 lp300 e40/1000 p.04",
    },
  },
  mewtwo: { family: "psychic", h: 240 },
  lucario: { family: "martial", h: 260, roles: { fire: "fire(480) sin H*2 v6/20 a12/.4 e30/450 p.2 + sin H*3 e30/450 p.1 + pn bp1200>2400/400q2 e20/460 p.5" } },
  greninja: { family: "aqua", h: 520 },
  gengar: { family: "ghost", h: 260 },
  snorlax: { family: "brawler", h: 55, roles: { fire: "fire(850) sin 80 a.6/.8 e300/550 p.25 + pn lp300 a.6/.8 e300/550 p.4" } },
  // ---------------------------------------------------------------- Modern anime (tint: a bright flash on the cast)
  gojo: { family: "psychic", h: 420, roles: { fire: "fire(880) pn bp6000>200/800q1 e40/840 p.9 + sin 3520 v5/20 e400/450 p.03 + sin 55 e600/250 p.2" } },
  sukuna: { family: "beast", h: 95, roles: { fire: "fire(750) saw 55 lp500 ws2 e100/650 p.14 + saw 58.3 lp500 e100/650 p.12 + wn hp5000>1500/700q1 e10/700 p.3" } },
  tanjiro: { family: "katana", h: 760, roles: { fire: "fire(680) pn bp400>2000/600q.8 e40/640 p1.2 + sin F*2>F*3/600 v6/20 e40/640 p.08 + wn hp6000 d6 p.12 x8/70±30" } },
  nezuko: { family: "martial", h: 330, roles: { fire: "fire(570) wn bp1200q1 d40 p.8 + pn bp600>2400/500q.8 e10/560 p1.1 + sin 70>40/300 d320 p.2" } },
  levi: { family: "katana", h: 980 },
  eren: { family: "katana", h: 900, roles: { fire: "fire(960) wn hp2000 d30 p.45 + wn bp3000q1 d20 p.4 x3/50±20*.8 + fmt a>O@800 p110>160>80 sh.6 v6/30 ws5 e60/900 p.35 + bn lp200 e40/900 p.25" } },
  deku: { family: "brawler", h: 75, roles: { impact: "impact(960) wn bp800q.7 d50 p1.1 + sin 70>25/950 ws2 d960 p.24 + pn lp2400>300/900 e5/900 p.5 + bn lp800 d600 p.3" } },
  bakugo: { family: "bomber", h: 80 },
  // ---------------------------------------------------------------- Sandbox & online games (tint: a square blip on swings and shots)
  steve: {
    roles: {
      fuse: "fuse(held) wn a23/.6 hp4000 e5/50/.9/30h p.24 + wn hp3000 d5 p.32 x10/90±40*.95",
      fire: "fire(802) sin 70>25/800 ws2 d800 p.24 + bn lp700 d700 p.32 + wn bp900q1 d50 p.77 + bn bp400q2 d40 p.31 x8/60±30*.85",
    },
  },
  creeper: { family: "bomber", h: 65 },
  enderman: { family: "ghost", h: 180, roles: { fire: "fire(290) sin H*4>H*0.5/120>H*2@120/150 v20/40 d290 p.2 + wn bp2500>600/250q2 e10/260 p.5" } },
  jonesy: { family: "blocky", h: 220, roles: { fire: "fire(500) wn bp1400q2 d40 p.9 x3/120*.95 + sin 150>90/60 d80 p.2 x3/120 + bn lp500 d120 p.4 @380" } },
  peely: { family: "bomber", h: 90, roles: { fire: "fire(700) saw 400>250/700 v5/40 lp2000>500/700 e20/680 p.14 + tri 300>450/350 v8/30 e20/330 p.1 @350" } },
  noob: { family: "blocky", h: 260 },
  crewmate: { family: "retro", h: 300, roles: { fire: "fire(690) sqr 196 lp1500 a6/.6 e10/680 p.12 + wn bp5000q2 d30 p.6 + bar 1800 [.08/600 .05/400]" } },
  // ---------------------------------------------------------------- Horror movies (tint: a dread sting on the charge and the KO)
  freddy: { family: "slasher", h: 1500, roles: { swing: "swing(175) wn bp3500>1500/150q2 e5/170 p.7 + bar 2600 [.04/150 .03/110] @20 + wn hp6000 d8 p.15 x3/30" } },
  jason: { family: "slasher", h: 900, roles: { swing: "swing(220) pn bp500>1800/200q1 e20/200 p1.5 + wn hp3000 d15 p.2 @180" } },
  michaelmyers: { family: "slasher", h: 1100 },
  ghostface: { family: "slasher", h: 1300 },
  pennywise: {
    family: "ghost",
    h: 300,
    roles: {
      shoot: "shoot(240) tri H>H*1.5/200 v12/40 e20/220 p.2 + pn bp1800q2 d60 p.4",
      hit: "hit(80) wn bp1600q1.5 d30 p.9 + pn lp1200 d80 p.6",
    },
  },
  chucky: { family: "slasher", h: 1700 },
  leatherface: { family: "chainsaw", h: 85 },
  // ---------------------------------------------------------------- Animated movies (tint: a spring on the cast)
  buzz: { family: "tech", h: 900, roles: { shoot: "shoot(420) saw H*1.5 a40/.3 m2i2 lp4000 e5/40/.8/80h p.18 + sin H*3 e5/40/.8/80h p.06" } },
  woody: { family: "wildwest", h: 260 },
  shrek: { family: "brawler", h: 68, roles: { fire: "fire(890) fmt a>O@800 p100>150>80 sh.65 v5/25 ws4 e40/850 p.4 + bn lp200 e40/850 p.2" } },
  pussinboots: { family: "katana", h: 1400, roles: { fire: "fire(480) sin 2637 d300 p.12 x4/60^1.122 + wn hp7000 d40 p.08" } },
  toothless: { family: "pyro", h: 380, roles: { "shoot@gun": "shoot(520) sin 600>1800/300 e10/290 p.12 + sin 120>45/200 ws2 d220 p.28 @300 + pn bp800>2400/200q1 e10/200 p.9 @300" } },
  elsa: { family: "frost", h: 2200 },
  mrincredible: { family: "brawler", h: 72, roles: { fire: "fire(490) pn bp300>1200/450q.8 e30/460 p1.5 + sin 80>50/300 d320 p.2" } },
  // ---------------------------------------------------------------- Cartoons (tint: a slide whistle on the charge)
  homer: { family: "cartoon", h: 220, roles: { fire: "fire(510) wn bp1400q2 d25 p.8 x3/110*.9 + sin 180>120/80 d100 p.2 x3/110 + tri 440>660/120 v8/20 e10/140 p.15 @360" } },
  spongebob: { family: "aqua", h: 600 },
  rick: {
    family: "tech",
    h: 600,
    roles: {
      shoot: "shoot(110) sin 400>1800/90 m1.5i2>0/90 d110 p.31 + wn bp1500>4000/90q2 d90 p.91",
      fire: "fire(480) pn bp1200>300/300q1.5 e10/300 p1 + tri 300>900/150 v12/30 d180 p.15 @300",
    },
  },
  bugsbunny: { family: "cartoon", h: 400 },
  tom: { family: "cartoon", h: 260, roles: { hit: "hit(380) bar 520 [.12/380 .07/280 .04/200] + sin 300>110/80 d120 p.25 + wn bp2000q2 d30 p.5" } },
  jerry: { family: "cartoon", h: 700 },
  popeye: { family: "brawler", h: 80, roles: { fire: "fire(690) saw R*0.5>R/400 lp800>3000/400 ws1.5 e20/380 p.12 + saw R*0.75>R*1.5/400 lp800>3000/400 e20/380 p.1 + sin 60>120/300 e10/680 p.25" } },
  // ---------------------------------------------------------------- Wildcard: Gerald, the site's own sounds (its boings, its gap arpeggio, its grin)
  gerald: {
    roles: {
      swing: "swing(152) tri F>F*1.5/80 v14/30 d150 p.41",
      hit: "hit(121) tri F*2>F/60 d120 p.18 + pn lp1500 d40 p.31 + sin 150>80/60 d70 p.14",
      telegraph: "telegraph(382) tri 523.25 d150 p.39 + tri 659.25 d150 p.39 @60 + tri 783.99 d150 p.38 @120 + tri 1046.5 d200 p.38 @180",
      fire: "fire(342) tri F>F*2/120 v10/20 d250 p.2 + tri F*1.5>F*3/120 d250 p.14 @90 + sin 80>45/150 d150 p.24",
      ko: "ko(500) tri 900>200/500 v8/40 e5/495 p.29 + saw 880>600/160 bp1500>900/160q4 e10/150 p.57",
      win: "win(420) saw 560>880/147>520@147/273 bp700>1800/147>850@147/273q4.5 e15/405 p.9",
    },
  },
};

/* ------------------------------------------------------------------ division tints */

/** A division's tint: a short layer played on top of the cues whose role (or role@primitive) it names. */
export interface FlTint {
  name: string;
  recipe: string;
  on: readonly string[];
}

const HERO_STAB: FlTint = { name: "heroStab", recipe: "heroStab(255) saw F*0.5 lp2000 ws1.5 e5/250 p.15 + saw F*0.75 lp2000 e5/250 p.09 + sin 70>40/200 d200 p.27", on: ["fire"] };

export const FL_DIVISION_TINTS: Readonly<Record<FlDivision, FlTint | null>> = {
  marvel: HERO_STAB,
  dc: HERO_STAB,
  nintendo: { name: "chipChirp", recipe: "chipChirp(101) p25 F*2>F*4/80 d100 p.42", on: ["swing", "charge"] },
  league: { name: "arcaneBell", recipe: "arcaneBell(401) sin F*4 m3.5i2>0/300 d400 p.4", on: ["charge"] },
  fighting: { name: "taikoHit", recipe: "taikoHit(220) sin 120>70/120 d220 p.3 + pn lp900 d60 p.6", on: ["charge"] },
  legends: { name: "uiBlip", recipe: "uiBlip(90) sqr F*4 lp3000 d60 p.08 + sin F*8 d40 p.06 @50", on: ["charge"] },
  shonen: { name: "kiRiser", recipe: "kiRiser(500) sin 110>220/500 a8/.4 e200/300 p.39 + wn hp5000 d5 p.13 x6/80±40*.95", on: ["charge"] },
  starWars: { name: "forceSwell", recipe: "forceSwell(500) pn bp300>900/450q.8 e300/200 p.5 + sin 55 e300/200 p.15", on: ["charge"] },
  fantasy: { name: "harpGliss", recipe: "harpGliss(601) ks F*2 d.995 d400 p.33 x6/40^1.122", on: ["fire@heal", "fire@summon"] },
  monsters: { name: "beastRoar", recipe: "beastRoar(940) fmt a>O@700 p150>220>110 sh.7 v6/30 ws4 e40/900 p.41 + bn lp200 e40/900 p.15", on: ["intro", "ko", "win"] },
  action: { name: "mechClack", recipe: "mechClack(313) wn bp2200q2 d15 p1.6 @240 + wn bp3000q2 d12 p1.3 @300", on: ["shoot"] },
  tv: { name: "cineBoom", recipe: "cineBoom(902) sin 60>28/900 d900 p.37 + bn lp400 e5/800 p.36 + pn hp2000>8000/300 e300/10 p.3", on: ["fire"] },
  pokemon: { name: "critterChime", recipe: "critterChime(210) sin F*4 d200 p.12 + sin F*6 d150 p.08 @60", on: ["charge"] },
  modernAnime: { name: "animeFlash", recipe: "animeFlash(205) wn hp5000>2000/150 e5/200 p.2 + sin F*8 d120 p.06", on: ["fire"] },
  sandbox: { name: "pixelBlip", recipe: "pixelBlip(80) sqr F*2>F*3/40 lp2500 d80 p.08", on: ["swing", "shoot"] },
  horror: { name: "dreadSting", recipe: "dreadSting(700) saw 55 lp300 e100/600 p.12 + saw 58.3 lp300 e100/600 p.1 + sin 1760 v8/40 e300/400 p.03", on: ["charge", "ko"] },
  animated: { name: "springBoing", recipe: "springBoing(295) tri F>F*2/120 v14/30 e5/290 p.18", on: ["fire"] },
  cartoons: { name: "slideWhistle", recipe: "slideWhistle(420) sin F*2>F*4/400 v6/20 e20/400 p.16", on: ["charge"] },
  wildcard: null,
};

/* ------------------------------------------------------------------ match stings and the announcer */

/** The match's stings (the match bus). `null`: silent by design (a fighter's own layer, a tint or a clip plays instead). */
export const FL_MATCH_SOUNDS: Readonly<Record<string, string | null>> = {
  vs: "vs(702) sin 70>35/700 d700 p.27 + wn bp1200q1 d40 p.78 + pn bp500>2500/250 e120/130 p.34 L.6 + pn bp500>2500/250 e120/130 p.34 @120 R.6 + bar 1300 [.06/600 .03/450]",
  // the intro of each fighter at the VS card: its clip, its signature's intro or its division's tint – else nothing
  intro: null,
  tick: "tick(91) p25 R d90 p.4 + wn hp3000 d8 p.21",
  clock: "clock(26) sin 1600 d25 p.37 + wn bp2000q3 d10 p1.1",
  ko: "ko(903) sin 90>30/900 e3/900 p.27 + wn bp1500q.9 d50 p.75 + bn lp1200 d600 p.31 + sin 4000 d60 p.03 x6/40±15*.8^.9",
  finalKo: "finalKo(1350) sin 90>30/900 e3/900 p.25 + wn bp1500q.9 d50 p.7 + bn lp1200 d600 p.29 + sin 55 e300/900 p.1 + bar R*0.5 [.05/1350 .03/900]",
  // the winner: two brass-like chord stabs (V, then I an octave up) – an original two-chord gesture, no game's victory theme
  win: "win(1400) saw R*0.75 lp2500 e10/160 p.12 + saw R*0.945 lp2500 e10/160 p.11 + saw R*1.122 lp2500 e10/160 p.09 + saw R v5/6 lp2500 e10/300/.5/300h400 p.13 @200 + saw R*1.26 v5/6 lp2500 e10/300/.5/300h400 p.12 @200 + saw R*1.5 v5/6 lp2500 e10/300/.5/300h400 p.11 @200 + saw R*0.5 lp1200 e10/300/.5/300h400 p.12 @200 + pn a3/.2 bp1000q.5 e300/200/.7/600h300 p.65 + sin 3000 d40 p.07 @250 x10/60±30^1.04",
  doubleKo: "doubleKo(890) sin 90>30/700 e3/700 p.29 L.5 + sin 90>30/700 e3/700 p.29 @180 R.5 + wn bp1500q.9 d50 p.76 L.5 + wn bp1500q.9 d50 p.76 @180 R.5 + saw 400>200/900 lp2000>400/900 e10/880 p.05 + saw 566>283/900 lp2000>400/900 e10/880 p.04",
  time: "time(655) sqr 220 a30/.3 lp3000 e5/50/.9/100h500 p.18 + sqr 261.6 a30/.3 lp3000 e5/50/.9/100h500 p.15",
  draw: "draw(705) tri R e5/300 p.4 + tri R*0.75 e5/400 p.4 @300 + pn lp800 e50/400 p.35",
  lowHp: "lowHp(302) sin 60 d120 p.33 x2/180*.7 + bn lp200 d100 p.58 x2/180*.7",
  suddenDeath: "suddenDeath(830) sqr R*0.5 a6/.7 lp1400 e10/120/.8/200h500 p.14 + saw R*0.5>R/700 lp900>2400/700 e20/120/.6/180h400 p.12 + sin 50 e20/700 p.3",
  // the KO finale's time warp: noise band-passed 3 kHz → 300 Hz over 700 ms and a sub drop 80 → 40 Hz
  timeWarp: "timeWarp(720) wn bp3000>300/700q1.5 e40/680 p1.1 + sin 80>40/700 e20/700 p.3",
  immune: "immune(150) sin 2637 d150 p.2 + sin 3951 d100 p.1 + wn hp6000 d10 p.1",
  // (the match types' stings of Stage 5)
  rematch: "rematch(695) pn bp500>2500/450q1 e430/20 p.8 + saw R*0.5 lp1600 ws1.5 e5/240 p.12 @450 + saw R*0.75 lp1600 e5/240 p.09 @450",
  matchPoint: "matchPoint(440) sin 55 d140 p.35 x2/300*.8 + pn bp200>800/400q1 e350/50 p.4",
  round: "round(1100) bar R*0.5 [.12/1100 .07/800 .04/500 .02/300] + wn bp900q1 d30 p.5 + sin 60 d400 p.2",
  champion: "champion(1350) saw R*0.667 lp2600 e10/200 p.1 + saw R*0.84 lp2600 e10/200 p.09 + saw R lp2600 e10/200 p.08 + saw R*0.75 lp2600 e10/200 p.1 @220 + saw R*0.945 lp2600 e10/200 p.09 @220 + saw R*1.122 lp2600 e10/200 p.08 @220 + saw R v5/6 lp2600 e10/300/.5/300h300 p.12 @440 + saw R*1.26 v5/6 lp2600 e10/300/.5/300h300 p.11 @440 + saw R*1.5 v5/6 lp2600 e10/300/.5/300h300 p.1 @440 + sin 3200 d40 p.06 @500 x12/50±25^1.03",
  bossDefeated: "bossDefeated(1200) sin 70>30/1200 ws1.5 d1200 p.25 + bn lp700>200/1000 d1100 p.3 + wn bp900q1 d50 p.7 + bn bp400q2 d40 p.3 x8/90±40*.85",
  upset: "upset(690) saw R*0.5>R*0.53/400 lp1200 e10/380 p.12 + saw R*0.707>R*0.75/400 lp1200 e10/380 p.1 + sin 4000 d40 p.05 @450 x6/40^1.06",
  comeback: "comeback(750) pn bp300>3000/500q1 e450/50 p.9 + sin 55 d300 p.3 @450",
  game: "game(480) sin 60 d150 p.35 + bar R [.1/400 .06/280] @80 + wn hp3000 d20 p.2 @80",
  seriesPoint: "seriesPoint(460) tri R e5/200 p.3 + tri R*1.5 e5/200 p.24 @160 + sin 55 d140 p.3 x2/320*.8",
  advance: "advance(345) tri R e5/160 p.3 + tri R*1.5 e5/220 p.26 @120 + wn hp4000 d30 p.1 @120",
};

/**
 * The announcer (its own bus, the music ducked under it): calls as a deep synthetic voice of vowel shapes – never words of a
 * character or a game's announcer – and instrumental stings. A row for every banner kind of the match (Stages 3 and 5).
 */
export const FL_ANNOUNCER: Readonly<Record<string, string>> = {
  fight: "fight(610) wn hp1800 e5/65 p.05 + fmt a>a@60>I@260 p92>118>80 sh.86 v5/10 ws2.5 e20/280 p.63 @70 + wn bp4000q2 d15 p.28 @340 + sin 46 e20/300 p.07 @70 | echo110/.35/lp2500/.3",
  firstBlood: "firstBlood(662) wn hp2000>8000/250 e250/10 p.11 + saw R*0.5 lp1800 ws2 e5/300 p.1 @260 + saw R*0.595 lp1800 ws2 e5/300 p.08 @260 + saw R*0.75 lp1800 ws2 e5/300 p.09 @260 + sin 55 d400 p.3 @260",
  ko: "ko(860) wn bp2200q2 d25 p.39 + fmt e>i@200 p100>85 sh.86 v5/10 ws2.5 e10/200 p.66 @25 + fmt o>u@320 p95>70 sh.86 v5/10 ws2.5 e15/330 p.45 @275 + sin 48 e20/500 p.06 @25 | echo120/.35/lp2500/.3",
  finalKo: "finalKo(1115) wn bp2000q2 d30 p.44 + fmt e>i@260 p78>66 sh.86 v5/10 ws2.5 e10/260 p.65 @30 + fmt o>u@450 p74>52 sh.86 v5/10 ws2.5 e15/460 p.5 @340 + sin 40 e20/700 p.08 @30 | echo150/.42/lp2200/.35",
  doubleKo: "doubleKo(1180) wn bp2500q3 d12 p.32 + fmt V>U@110 p96>90 sh.86 v5/10 ws2.5 e10/120 p.95 @12 + fmt U>o@70 p90>86 sh.86 v5/10 ws2.5 e10/80 p.7 @150 + wn bp2200q2 d25 p.44 @320 + fmt e>i@200 p100>85 sh.86 v5/10 ws2.5 e10/200 p.75 @345 + fmt o>u@320 p95>70 sh.86 v5/10 ws2.5 e15/330 p.5 @595 | echo120/.35/lp2500/.3",
  time: "time(680) wn bp4000q2 d15 p.32 + fmt a>I@260 p105>90 sh.86 v5/10 ws2.5 e10/270 p.67 @20 + sin 95>75/150 lp400 e10/150 p.06 @300 | echo110/.35/lp2500/.3",
  draw: "draw(650) wn bp2500q3 d12 p.32 + fmt r>O@80>O@400 p100>105>72 sh.86 v5/10 ws2.5 e15/400 p.52 @15 | echo110/.35/lp2500/.3",
  wins: "wins(650) fmt u>I@120>I@220 p100>120>92 sh.86 v5/10 ws2.5 e20/220 p.59 + sin 100 lp400 e5/60 p.07 @220 + wn bp4500q2 e20/150 p.11 @260 | echo110/.35/lp2500/.3",
  perfect: "perfect(1020) tri R*2 d120 p.17 x12/25^1.12 + sin R*2 e20/700 p.15 @300 + sin R*2.52 e20/700 p.13 @300 + sin R*3 e20/700 p.11 @300 + sin R*3.78 e20/700 p.1 @300",
  clutch: "clutch(1170) sin 60 d120 p.45 x2/180*.7 + tri R e10/250 p.11 @300 + tri R*1.335 e10/250 p.1 @300 + tri R*1.5 e10/250 p.09 @300 + tri R e10/600 p.11 @560 + tri R*1.26 e10/600 p.1 @560 + tri R*1.5 e10/600 p.09 @560",
  suddenDeath: "suddenDeath(900) sin 60 d120 p.45 x3/200*.8 + saw R*0.5>R/600 lp800>2600/600 e40/560 p.1 @300",
  // the VS card's own and the side callout: written for completeness (the match's vs and tick, the weapons' clash play instead)
  vs: "vs(950) fmt O>a@400 p70>90 sh.7 v4/20 ws2 e200/550 p.4 @200 + pn bp300>1200/400q1 e300/200 p.4",
  count: "count(90) wn bp3000q3 d10 p.4 + sin R*2 d90 p.12",
  clash: "clash(380) bar 1760 [.1/380 .06/280] + bar 1865 [.08/300 .05/200] + wn hp5000 d20 p.3",
  // (the match types of Stage 5: instrumental stings, the rounds by their number of strikes)
  upset: "upset(905) wn hp2000>8000/250 e250/10 p.1 + saw R*0.5 lp1600 ws2 e5/300 p.1 @260 + saw R*0.53 lp1600 ws2 e5/300 p.08 @260 + tri R*2 e5/300 p.15 @560 + tri R*2.52 e5/300 p.12 @600",
  comeback: "comeback(800) pn bp300>3000/500q1 e450/50 p.9 + saw R lp3000 ws1.5 e5/250 p.12 @500 + saw R*1.26 lp3000 e5/250 p.1 @500 + saw R*1.5 lp3000 e5/250 p.09 @500 + sin 55 d300 p.3 @500",
  game: "game(460) wn bp3500q2 d10 p.3 + fmt e>I@200 p110>98 sh.86 v5/10 ws2.5 e10/220 p.6 @10 | echo110/.35/lp2500/.3",
  seriesPoint: "seriesPoint(645) tri R e5/180 p.3 + tri R*1.5 e5/180 p.26 @160 + tri R*2 e5/320 p.24 @320 + sin 55 d140 p.3 x2/320*.8",
  roundOf16: "roundOf16(690) bar R*0.5 [.09/300 .05/200] x4/130*.95 + sin 60 d120 p.25 x4/130",
  quarterFinal: "quarterFinal(720) bar R*0.5 [.1/400 .06/260] x3/160 + sin 60 d140 p.28 x3/160 + wn bp900q1 d30 p.4",
  semiFinal: "semiFinal(720) bar R*0.5 [.11/500 .07/340 .03/220] x2/220 + sin 55 d200 p.3 x2/220 + pn bp400>1600/300q1 e250/50 p.5",
  final: "final(1350) pn bp300>2000/450q1 e420/30 p.6 + bar R*0.5 [.14/900 .09/700 .05/450 .02/300] @450 + sin 50 e10/800 p.32 @450 + wn bp1200q1 d40 p.6 @450",
  champion: "champion(1180) wn hp2000>8000/250 e250/10 p.1 + tri R e10/400 p.14 @260 + tri R*1.26 e10/400 p.12 @330 + tri R*1.5 e10/400 p.11 @400 + tri R*2 e10/700 p.12 @470 + sin 3200 d40 p.05 @500 x10/50±20^1.03",
  bossDefeated: "bossDefeated(1170) tri R e5/200 p.2 @300 + tri R*1.26 e5/200 p.18 @420 + tri R*1.5 e5/200 p.17 @540 + tri R*2 e10/500 p.16 @660 + wn hp2000>8000/280 e280/10 p.1",
  bossSurvives: "bossSurvives(1160) saw R*0.5 lp1200 ws1.5 e10/500 p.12 + saw R*0.595 lp1200 e10/500 p.1 + saw R*0.75 lp1200 e10/500 p.09 + saw R*0.445 lp900 e10/700 p.12 @450 + saw R*0.5 lp900 e10/700 p.1 @450 + sin 45 e20/900 p.3",
  rematch: "rematch(610) wn bp4000q2 d15 p.3 + fmt i>i@120 p105>110 sh.86 v5/10 ws2.5 e10/130 p.6 @15 + fmt a>e@200 p110>95 sh.86 v5/10 ws2.5 e10/220 p.6 @160 | echo110/.35/lp2500/.3",
  matchPoint: "matchPoint(440) tri R e5/180 p.3 + tri R*1.335 e5/180 p.24 @150 + sin 55 d140 p.3 x2/300*.8",
  phase2: "phase2(940) saw 55>110/800 lp300>1500/800 ws2 e40/900 p.18 + fmt a>O@700 p70>100>60 sh.6 v5/30 ws4 e40/900 p.3 + sin 40 e20/900 p.25",
  finish: "finish(525) bar R [.12/500 .07/360] + wn hp4000 d30 p.2 + tri R*1.5 e5/400 p.12 @120",
};

/**
 * Every banner kind of the match (Stage 3's – data-fl-banners – and Stage 5's) with its sound: the announcer's row (every
 * kind has one), the match sting with it, and whether the mode announces it (the VS card's own vs and count play their match
 * stings, a clash its weapons' clash).
 */
export const FL_BANNER_SOUNDS: Readonly<Record<string, { announcer: string; match?: string; announce: boolean }>> = {
  vs: { announcer: "vs", match: "vs", announce: false },
  count: { announcer: "count", match: "tick", announce: false },
  fight: { announcer: "fight", announce: true },
  firstBlood: { announcer: "firstBlood", announce: true },
  ko: { announcer: "ko", match: "ko", announce: true },
  finalKo: { announcer: "finalKo", match: "finalKo", announce: true },
  doubleKo: { announcer: "doubleKo", match: "doubleKo", announce: true },
  draw: { announcer: "draw", match: "draw", announce: true },
  time: { announcer: "time", match: "time", announce: true },
  win: { announcer: "wins", match: "win", announce: true },
  perfect: { announcer: "perfect", announce: true },
  clutch: { announcer: "clutch", announce: true },
  suddenDeath: { announcer: "suddenDeath", match: "suddenDeath", announce: true },
  clash: { announcer: "clash", announce: false },
  // Stage 5 (series, brackets, boss rush): the stings wait in these rows for the banners that call them
  upset: { announcer: "upset", match: "upset", announce: true },
  comeback: { announcer: "comeback", match: "comeback", announce: true },
  game: { announcer: "game", match: "game", announce: true },
  seriesPoint: { announcer: "seriesPoint", match: "seriesPoint", announce: true },
  seriesWin: { announcer: "wins", match: "win", announce: true },
  rematch: { announcer: "rematch", match: "rematch", announce: true },
  matchPoint: { announcer: "matchPoint", match: "matchPoint", announce: true },
  roundOf16: { announcer: "roundOf16", match: "round", announce: true },
  quarterFinal: { announcer: "quarterFinal", match: "round", announce: true },
  semiFinal: { announcer: "semiFinal", match: "round", announce: true },
  final: { announcer: "final", match: "round", announce: true },
  champion: { announcer: "champion", match: "champion", announce: true },
  bossDefeated: { announcer: "bossDefeated", match: "bossDefeated", announce: true },
  bossSurvives: { announcer: "bossSurvives", announce: true },
  phase2: { announcer: "phase2", announce: true },
  wave: { announcer: "count", match: "round", announce: false },
  challenger: { announcer: "vs", match: "advance", announce: false },
  finish: { announcer: "finish", announce: true },
};

/* ------------------------------------------------------------------ helpers */

/** The weapon kind an ability projectile of `shape` sounds like when it hits (an arrow a bow's, a bullet a gun's, …). */
export const FL_SHAPE_KIND: Readonly<Partial<Record<FlShape, FlWeaponKind>>> = {
  arrow: "bow",
  bullet: "gun",
  pellet: "shotgun",
  rocket: "gun",
  repulsor: "gun",
  plasma: "gun",
  fireball: "fire",
  flamewave: "fire",
  ki: "beam",
  hadouken: "beam",
  charge: "beam",
  bolt: "wand",
  orb: "staff",
  megaorb: "staff",
  aura: "staff",
  page: "book",
  dagger: "cards",
  batarang: "cards",
  card: "cards",
  shuriken: "cards",
  saber: "sword",
  blades: "cards",
  web: "web",
  ice: "ice",
  icespear: "ice",
  hammer: "hammer",
  shield: "shield",
  spear: "chain",
  boulder: "hammer",
  cannonball: "shotgun",
  car: "hammer",
  spearbolt: "spark",
  balloon: "staff",
  bubble: "staff",
  portal: "beam",
  flask: "bomb",
  grenade: "bomb",
  dynamite: "bomb",
};

/** A recipe's normalisation tier: a charge (peak 0.30), held (0.25) or a one-shot (0.40). */
export type FlTier = "oneShot" | "charge" | "sustain";
export const FL_TIER_PEAK: Readonly<Record<FlTier, number>> = { oneShot: 0.4, charge: 0.3, sustain: 0.25 };

/** The tier of a table's role: "charge", a held one (`role(held)`), else a one-shot. */
export function flTierOf(role: string, text: string): FlTier {
  if (role === "charge") return "charge";
  return /^[A-Za-z0-9]+\(held\)/.test(text) ? "sustain" : "oneShot";
}

/** One row of every table: where it lives, its role, its text, the pitch H it plays at and its tier. */
export interface FlRecipeEntry {
  table: "weapon" | "primitive" | "family" | "signature" | "tint" | "match" | "announcer";
  key: string;
  role: string;
  text: string;
  h: number;
  tier: FlTier;
}

/** Every recipe of the tables (a family's rows once at its default pitch and once at every signature's own). */
export function flAllRecipes(): FlRecipeEntry[] {
  const out: FlRecipeEntry[] = [];
  const add = (table: FlRecipeEntry["table"], key: string, role: string, text: string | null | undefined, h = 440) => {
    if (text) out.push({ table, key, role, text, h, tier: flTierOf(role.split("@")[0], text) });
  };
  for (const [kind, roles] of Object.entries(FL_WEAPON_SOUNDS)) for (const [role, text] of Object.entries(roles)) add("weapon", kind, role, text);
  for (const [prim, roles] of Object.entries(FL_PRIMITIVE_SOUNDS)) for (const [role, text] of Object.entries(roles)) add("primitive", prim, role, text);
  for (const fam of FL_FAMILIES) for (const [role, text] of Object.entries(FL_FAMILY_SETS[fam])) add("family", fam, role, text, FL_FAMILY_DEFAULT_H[fam]);
  for (const [id, sig] of Object.entries(FL_SIGNATURES)) {
    const h = sig.h ?? (sig.family ? FL_FAMILY_DEFAULT_H[sig.family] : 440);
    for (const [role, text] of Object.entries(sig.roles ?? {})) add("signature", id, role, text, h);
    if (sig.family && sig.h !== undefined && sig.h !== FL_FAMILY_DEFAULT_H[sig.family]) for (const [role, text] of Object.entries(FL_FAMILY_SETS[sig.family])) if (!sig.roles?.[role]) add("family", `${sig.family}@${sig.h}`, role, text, sig.h);
  }
  for (const [division, tint] of Object.entries(FL_DIVISION_TINTS)) if (tint) add("tint", division, tint.name, tint.recipe);
  for (const [row, text] of Object.entries(FL_MATCH_SOUNDS)) add("match", row, row, text);
  for (const [row, text] of Object.entries(FL_ANNOUNCER)) add("announcer", row, row, text);
  return out;
}

/**
 * The key of a recipe played at pitch H in the generated trims (flRecipeTrims.ts – `node scripts/fl-sound-trims.mjs` renders
 * every row of `flAllRecipes()` in Chromium and writes the gain that brings its peak to its tier's): FNV-1a of the text and H.
 */
export function flTrimKey(text: string, h: number): string {
  const s = `${text}|${Math.round(h * 100) / 100}`;
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  return (x >>> 0).toString(36);
}

/** The typical pitches the trims are rendered at: F = E4, R = C5. */
export const FL_TRIM_F = 329.63;
export const FL_TRIM_R = 523.25;
/** A held row is rendered held this long (s). */
export const FL_TRIM_HOLD_SEC = 1;
