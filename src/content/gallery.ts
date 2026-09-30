import type { Locale } from "@/i18n/routing";
import type { ModeId } from "@/lib/physics/types";

/*
 * --- daily-gallery --- The preset gallery (/gallery): curated setups, each a share query the simulator opens as is.
 *
 * `query` is exactly what the simulator's share link carries – the canonical output of `settingsToSearchParams()` (the
 * settings that differ from the mode's defaults; a theme is written out with its colours) – plus `seed=`, which pins the
 * run, so "Try it" plays the very run the preview shows (on a canvas of the preview's size; another size is another
 * world). tests/gallery.test.ts checks every query is canonical, so a renamed or re-ranged setting cannot rot a preset.
 *
 * Adding a preset: build the look in the simulator, copy the address bar's query (add `seed=` from the canvas' data-seed or
 * a found simulation), append an entry with names in every language, then render its card image with
 * `GALLERY=<id> npm run previews` against the served build (public/gallery/<id>.webp; `previewAt` is the moment shown).
 */

export type LocalizedText = Record<Locale, string>;

export interface GalleryPreset {
  /** Kebab-case id: the card's anchor and the preview file public/gallery/<id>.webp. */
  id: string;
  mode: ModeId;
  /** The simulator link's query: canonical settings plus `seed=`. */
  query: string;
  /** Seconds into the run the preview image shows. */
  previewAt: number;
  name: LocalizedText;
  description: LocalizedText;
}

export const GALLERY: readonly GalleryPreset[] = [
  {
    id: "neon-escape",
    mode: "classic",
    query: "mode=classic&wc=8&tt=1.4&glow=1&rwalls=0&cc=%23ff00e6&bc=%2300f0ff&bc2=%23faff00&lc=%2300f0ff&wbreak=all&theme=neon&bgt=gradient&bg1=%230b0014&bg2=%231f0040&ps=sparks&trc=%2300f0ff%2C%23ff00e6&seed=499474398",
    previewAt: 5,
    name: { en: "Neon Escape", pl: "Neonowa ucieczka", es: "Escape de neón" },
    description: {
      en: "Eight magenta rings spin around a cyan ball, and every wall it slips through goes off with sparks, confetti and a shockwave.",
      pl: "Osiem purpurowych pierścieni wiruje wokół błękitnej piłki, a każda ściana, przez którą się prześlizgnie, wybucha iskrami, konfetti i falą uderzeniową.",
      es: "Ocho anillos magenta giran alrededor de una bola cian, y cada pared que atraviesa estalla en chispas, confeti y una onda expansiva.",
    },
  },
  {
    id: "galaxy-pendulum",
    mode: "pendulum",
    query: "mode=pendulum&pwn=30&pwtr=0.6&glow=1&rwalls=0&cc=%237cffcb&bc=%23ffffff&bc2=%23c084fc&lc=%237cffcb&pwl=galaxy&theme=aurora&bgt=gradient&bg1=%23020024&bg2=%23093637&ps=bubbles&trc=%237cffcb%2C%23c084fc&seed=132967117",
    previewAt: 12,
    name: { en: "Aurora Galaxy Wave", pl: "Galaktyka zorzy", es: "Galaxia boreal" },
    description: {
      en: "Thirty pendulums laid out as a spinning galaxy drift into spiral arms and snap back in line, in northern-lights colours.",
      pl: "Trzydzieści wahadeł ułożonych w wirującą galaktykę rozchodzi się w spiralne ramiona i znów ustawia w linii – w barwach zorzy polarnej.",
      es: "Treinta péndulos dispuestos como una galaxia giratoria se abren en brazos espirales y vuelven a alinearse, con los colores de la aurora boreal.",
    },
  },
  {
    id: "web-dominion",
    mode: "stringBattle",
    query: "mode=stringBattle&sbst=neon&seed=228323246",
    previewAt: 6,
    name: { en: "Neon Web Dominion", pl: "Neonowa dominacja sieci", es: "Dominio de la red neón" },
    description: {
      en: "Four balls drag fans of glowing threads across a neon moiré, cutting each other's strings until one rules the web.",
      pl: "Cztery piłki ciągną wachlarze świecących nici przez neonową mory i przecinają sobie nawzajem sznurki, aż jedna zapanuje nad siecią.",
      es: "Cuatro bolas arrastran abanicos de hilos luminosos sobre un muaré de neón y se cortan los hilos entre sí hasta que una domina la red.",
    },
  },
  {
    id: "sunset-shatter",
    mode: "shatter",
    query: "mode=shatter&wc=12&glow=1&rwalls=0&cc=%23ffd166&bc=%23ffffff&bc2=%23ef476f&lc=%23ffd166&wbreak=shatter&theme=sunset&bgt=gradient&bg1=%232d1b69&bg2=%23b33951&ps=petals&trc=%23ff9a3c%2C%23ff3c78&seed=1067410279",
    previewAt: 3,
    name: { en: "Sunset Shatter", pl: "Rozbicie o zachodzie", es: "Estallido al atardecer" },
    description: {
      en: "Twelve walls of cracked segments under a violet-to-rose sky: every bounce chips one away until the ball smashes its way out in a shower of petals.",
      pl: "Dwanaście ścian z pękniętych segmentów pod fioletoworóżowym niebem: każde odbicie odłupuje kawałek, aż piłka przebije się na zewnątrz w deszczu płatków.",
      es: "Doce muros de segmentos agrietados bajo un cielo violeta y rosa: cada rebote arranca un trozo hasta que la bola se abre paso entre una lluvia de pétalos.",
    },
  },
  {
    id: "multiplier-mayhem",
    mode: "multipliers",
    query: "mode=multipliers&mprw=12&mpsb=3&glow=1&rwalls=0&cc=%23ff00e6&bc=%2300f0ff&bc2=%23faff00&lc=%2300f0ff&theme=neon&bgt=gradient&bg1=%230b0014&bg2=%231f0040&ps=sparks&trc=%2300f0ff%2C%23ff00e6&seed=2077430159",
    previewAt: 6,
    name: { en: "Multiplier Mayhem", pl: "Szał mnożników", es: "Locura de multiplicadores" },
    description: {
      en: "Three neon balls, twelve rows of x2, x3 and x5 gates: watch a handful of balls turn into hundreds on the way home.",
      pl: "Trzy neonowe piłki i dwanaście rzędów bramek x2, x3 i x5: zobacz, jak garstka piłek zamienia się w setki w drodze do domu.",
      es: "Tres bolas de neón y doce filas de puertas x2, x3 y x5: mira cómo un puñado de bolas se convierte en cientos camino a casa.",
    },
  },
  {
    id: "string-art",
    mode: "lines",
    query: "mode=lines&s=800&r=6&glow=1&rlines=1&seed=1765313541",
    previewAt: 20,
    name: { en: "Rainbow String Art", pl: "Tęczowy string art", es: "Arte de hilos arcoíris" },
    description: {
      en: "A small, fast ball stays tied to every point it bounces off with a rainbow thread, weaving a glowing string-art mandala in seconds.",
      pl: "Mała, szybka piłka zostaje połączona tęczową nitką z każdym punktem odbicia i w kilka sekund tka świecącą mandalę.",
      es: "Una bola pequeña y rápida queda unida con un hilo arcoíris a cada punto donde rebota y teje en segundos un mandala luminoso.",
    },
  },
  {
    id: "marimba-pachinko",
    mode: "drop",
    query: "mode=drop&dbc=24&dsv=0.8&dsi=0.15&glow=1&rwalls=0&cc=%23ff85a1&bc=%23fff0f3&bc2=%23ffd6a5&lc=%23caffbf&inst=marimba&scale=pentatonic&theme=candy&bgt=gradient&bg1=%232a0a2e&bg2=%235a189a&trc=%23ff85a1%2C%239bf6ff&seed=1541182466",
    previewAt: 5,
    name: { en: "Marimba Pachinko", pl: "Marimbowe pachinko", es: "Pachinko de marimba" },
    description: {
      en: "Twenty-four balls of every size rain through a candy-coloured pegboard, and each hit is a marimba note on the pentatonic scale.",
      pl: "Dwadzieścia cztery piłki różnej wielkości spadają przez cukierkową tablicę kołków, a każde uderzenie to nuta marimby w skali pentatonicznej.",
      es: "Veinticuatro bolas de todos los tamaños caen por un tablero de clavos color caramelo, y cada golpe es una nota de marimba en escala pentatónica.",
    },
  },
  {
    id: "circle-royale",
    mode: "battle",
    query: "mode=battle&glow=1&btn=12&bta=circle&seed=1249934935",
    previewAt: 5,
    name: { en: "Circle Royale", pl: "Królewska arena", es: "Batalla en el círculo" },
    description: {
      en: "Twelve squares with health bars in a shrinking circular arena – the faster one deals the damage, and the last square standing wins.",
      pl: "Dwanaście kwadratów z paskami życia na kurczącej się okrągłej arenie – obrażenia zadaje szybszy, a wygrywa ostatni, który przetrwa.",
      es: "Doce cuadrados con barras de vida en una arena circular que se encoge: el más rápido hace el daño y gana el último que quede en pie.",
    },
  },
  {
    id: "rainbow-paint",
    mode: "paint",
    query: "mode=paint&g=100&r=14&glow=1&seed=914903224",
    previewAt: 14,
    name: { en: "Paint the Circle", pl: "Zamaluj koło", es: "Pinta el círculo" },
    description: {
      en: "A big soft brush under low gravity sweeps the arena in thick rainbow strokes while the counter races to 100 %.",
      pl: "Duży, miękki pędzel przy niskiej grawitacji zamiata arenę grubymi, tęczowymi pociągnięciami, a licznik pędzi do 100 %.",
      es: "Un pincel grande y suave con poca gravedad barre la arena con gruesos trazos arcoíris mientras el contador corre hacia el 100 %.",
    },
  },
  {
    id: "chaos-harp",
    mode: "doublePendulum",
    query: "mode=doublePendulum&glow=1&dpa1=150&dpa2=120&dprs=0&dptr=8&seed=1436507323",
    previewAt: 10,
    name: { en: "Chaos Harp", pl: "Harfa chaosu", es: "Arpa del caos" },
    description: {
      en: "A double pendulum flung from 150° plucks a harp of strings while its last bob paints an eight-second rainbow trail.",
      pl: "Podwójne wahadło puszczone ze 150° szarpie struny harfy, a jego ostatni ciężarek maluje ośmiosekundowy tęczowy ślad.",
      es: "Un péndulo doble lanzado desde 150° pulsa las cuerdas de un arpa mientras su última masa pinta una estela arcoíris de ocho segundos.",
    },
  },
  {
    id: "gerald-glass",
    mode: "glass",
    query: "mode=glass&glow=1&rwalls=0&cc=%23ffd166&bc=%23ffffff&bc2=%23ef476f&lc=%23ffd166&bn=Gerald&face=cute&theme=sunset&bgt=gradient&bg1=%232d1b69&bg2=%23b33951&ps=petals&trc=%23ff9a3c%2C%23ff3c78&seed=1122274490",
    previewAt: 11.5,
    name: { en: "Gerald at Sunset", pl: "Gerald o zachodzie słońca", es: "Gerald al atardecer" },
    description: {
      en: "Gerald, all smiles, smashes his way down a shaft of glass under a sunset sky – every landing a note, every last hit a crash of shards.",
      pl: "Uśmiechnięty Gerald przebija się w dół szybu pełnego szyb pod niebem o zachodzie – każde lądowanie to nuta, każde ostatnie uderzenie to deszcz odłamków.",
      es: "Gerald, todo sonrisas, se abre paso rompiendo un pozo de cristales bajo un cielo de atardecer: cada aterrizaje es una nota y cada último golpe, una lluvia de esquirlas.",
    },
  },
  {
    id: "polygon-polyrhythm",
    mode: "polyrhythm",
    query: "mode=polyrhythm&prcs=12&glow=1&rwalls=0&prp=1&prnum=1&cc=%23ff00e6&bc=%2300f0ff&bc2=%23faff00&lc=%2300f0ff&prt=custom&prcu=3%2C4%2C5%2C6%2C7%2C8%2C9%2C10&theme=neon&bgt=gradient&bg1=%230b0014&bg2=%231f0040&ps=sparks&trc=%2300f0ff%2C%23ff00e6&seed=1472317627",
    previewAt: 3,
    name: { en: "Polygon Polyrhythm", pl: "Wielokątny polirytm", es: "Polirritmo poligonal" },
    description: {
      en: "Eight voices from 3 to 10 orbit their own rotating polygons, ticking 3 against 4 against 5… until the whole stack snaps back in phase every 12 seconds.",
      pl: "Osiem głosów od 3 do 10 krąży po własnych obracających się wielokątach i tyka 3 na 4 na 5… aż co 12 sekund cały stos znów zgrywa się w fazie.",
      es: "Ocho voces del 3 al 10 orbitan sus propios polígonos giratorios y marcan 3 contra 4 contra 5… hasta que cada 12 segundos todo vuelve a entrar en fase.",
    },
  },
  {
    id: "grand-prix",
    mode: "race",
    query: "mode=race&glow=1&rcn=10&seed=1689637060",
    previewAt: 6,
    name: { en: "Ten-Racer Grand Prix", pl: "Grand Prix dziesięciu", es: "Gran Premio de diez" },
    description: {
      en: "Ten squares tumble down a track of bumpers, turbo pads and swap zones, with live standings, passing callouts and a podium.",
      pl: "Dziesięć kwadratów pędzi w dół toru pełnego odbijaczy, turbo i stref zamiany, z tabelą na żywo, komunikatami o wyprzedzaniu i podium.",
      es: "Diez cuadrados caen por una pista de rebotadores, turbos y zonas de intercambio, con clasificación en directo, avisos de adelantamiento y podio.",
    },
  },
  {
    id: "matrix-grow",
    mode: "grow",
    query: "mode=grow&glow=1&rwalls=0&glines=1&cc=%2300ff41&bc=%23b7ffbf&bc2=%23008f11&lc=%2300ff41&theme=matrix&bg1=%23000a00&bg2=%23002200&ps=pixels&trc=%2300ff41%2C%23003b00&seed=2004386250",
    previewAt: 14,
    name: { en: "Matrix Growth", pl: "Wzrost w Matriksie", es: "Crecimiento Matrix" },
    description: {
      en: "A pale green ball in digital-rain colours grows with every bounce, strung to every hit, until there is no room left to move.",
      pl: "Bladozielona piłka w kolorach cyfrowego deszczu rośnie z każdym odbiciem, połączona nitką z każdym uderzeniem, aż zabraknie jej miejsca.",
      es: "Una bola verde pálido con los colores de la lluvia digital crece con cada rebote, unida a cada impacto, hasta que no le queda sitio.",
    },
  },
  {
    id: "neon-vortex",
    mode: "vortex",
    query: "mode=vortex&glow=1&rwalls=0&cc=%23ff00e6&bc=%2300f0ff&bc2=%23faff00&lc=%2300f0ff&face=cute&theme=neon&bgt=gradient&bg1=%230b0014&bg2=%231f0040&ps=sparks&trc=%2300f0ff%2C%23ff00e6&vxn=20&seed=199343859",
    previewAt: 13,
    name: { en: "Neon Vortex", pl: "Neonowy wir", es: "Vórtice de neón" },
    description: {
      en: "Twenty smiling balls spiral down a magenta whirlpool of sound rings – each one a rising glissando, each swallow a pew.",
      pl: "Dwadzieścia uśmiechniętych piłek schodzi spiralą w purpurowy wir dźwiękowych pierścieni – każda to wznoszące się glissando, każde połknięcie to „piu”.",
      es: "Veinte bolas sonrientes bajan en espiral por un remolino magenta de anillos sonoros: cada una es un glissando ascendente y cada tragada, un «piu».",
    },
  },
  {
    id: "countdown-squares",
    mode: "box",
    query: "mode=box&bxn=4&bxgr=3&glow=1&rwalls=0&cc=%23ff71ce&bc=%23fffb96&bc2=%2301cdfe&lc=%2305ffa1&theme=retro&bgt=gradient&bg1=%231a1033&bg2=%233d0f4f&ps=pixels&trc=%23ff71ce%2C%2301cdfe&seed=1436349377",
    previewAt: 8,
    name: { en: "Retro Countdown Squares", pl: "Retro odliczanie", es: "Cuadrados en cuenta atrás" },
    description: {
      en: "Four synthwave squares count down from 30 with every wall hit and grow a little each time – which one reaches zero first?",
      pl: "Cztery kwadraty w stylu synthwave odliczają od 30 przy każdym uderzeniu w ścianę i za każdym razem trochę rosną – który pierwszy dojdzie do zera?",
      es: "Cuatro cuadrados synthwave cuentan hacia atrás desde 30 con cada golpe en la pared y crecen un poco cada vez: ¿cuál llegará antes a cero?",
    },
  },
  {
    id: "power-800",
    mode: "powerLayers",
    query: "mode=powerLayers&glow=1&pll=800&seed=767578806",
    previewAt: 8,
    name: { en: "800 Layers", pl: "800 warstw", es: "800 capas" },
    description: {
      en: "A tiny ball against 800 rainbow layers: the power doubles with every hit until the last layer shatters and it falls to freedom.",
      pl: "Maleńka piłka kontra 800 tęczowych warstw: moc podwaja się przy każdym uderzeniu, aż pęknie ostatnia warstwa, a piłka spadnie na wolność.",
      es: "Una bola diminuta contra 800 capas arcoíris: la potencia se duplica con cada golpe hasta que se rompe la última capa y cae hacia la libertad.",
    },
  },
  {
    id: "hidden-heart",
    mode: "illusion",
    query: "mode=illusion&glow=1&ilt=whitespace&ilpt=heart&seed=1931378823",
    previewAt: 16,
    name: { en: "The Hidden Heart", pl: "Ukryte serce", es: "El corazón oculto" },
    description: {
      en: "Painters cover the arena in black and steer around one secret shape – watch the white space close in until only a heart is left.",
      pl: "Malarze pokrywają arenę czernią i omijają jeden sekretny kształt – patrz, jak biała przestrzeń się kurczy, aż zostaje samo serce.",
      es: "Los pintores cubren la arena de negro esquivando una forma secreta: mira cómo el blanco se reduce hasta que solo queda un corazón.",
    },
  },
  {
    id: "squishy-orbs",
    mode: "collide",
    query: "mode=collide&glow=1&rwalls=0&cpsq=1&cc=%23ffc8dd&bc=%23bde0fe&bc2=%23cdb4db&lc=%23ffafcc&theme=pastel&bgt=gradient&bg1=%232b2d42&bg2=%234a4e69&ps=petals&trc=%23a2d2ff%2C%23ffc8dd&seed=1503023980",
    previewAt: 3,
    name: { en: "Squishy Pastel Orbs", pl: "Miękkie pastelowe kule", es: "Orbes pastel blanditos" },
    description: {
      en: "Three hundred jelly-soft orbs squash and stretch against each other in a pastel circle, every collision a soft note pitched by size.",
      pl: "Trzysta galaretowato miękkich kul zgniata się i rozciąga o siebie w pastelowym kole, a każde zderzenie to cicha nuta zależna od wielkości.",
      es: "Trescientos orbes blandos como gelatina se aplastan y estiran entre sí en un círculo pastel, y cada choque es una nota suave según su tamaño.",
    },
  },
];

/** The simulator link of a preset, relative to the locale (for next-intl's Link): `/simulator?<query>`. */
export function galleryHref(preset: Pick<GalleryPreset, "query">): string {
  return `/simulator?${preset.query}`;
}
