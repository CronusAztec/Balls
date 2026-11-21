import type { Locale } from "@/i18n/routing";
import type { ModeId } from "@/lib/physics/types";
import type { HeroCamera } from "@/lib/thumbnails/heroFrame"; // --- gallery-every-mode --- (E2 review) a card picture's camera

/*
 * --- daily-gallery --- The preset gallery (/gallery): curated setups, each a share query the simulator opens as is.
 *
 * `query` is exactly what the simulator's share link carries: the canonical output of `settingsToSearchParams()` (the
 * settings that differ from the mode's defaults; a theme is written out with its colours), plus `seed=`, which pins the
 * run, so "Try it" plays the very run the preview shows (on a canvas of the preview's size; another size is another
 * world). tests/gallery.test.ts checks every query is canonical, so a renamed or re-ranged setting cannot rot a preset.
 *
 * Adding a preset: build the look in the simulator, copy the address bar's query (add `seed=` from the canvas' data-seed or
 * a found simulation), append an entry with names in every language, then render its card image with
 * `GALLERY=<id> npm run previews` against the served build (public/gallery/<id>.webp; `previewAt` is the moment shown).
 * --- gallery-every-mode --- (E2 review) The picture is the 360 × 360 square a card shows (it used to be the whole 640 × 360
 * world, 44% of it cropped away by every card): the centred square of the world, or the square `camera` frames, as a mode
 * card's hero moment does (src/lib/thumbnails/heroMoments.ts), where the action is small or a caption would put English
 * words on the Polish and Spanish pages.
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
  /** --- gallery-every-mode --- The square the picture shows (default: the centred square of the world, what a clip records). */
  camera?: HeroCamera;
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
  // --- ring-looks --- Classic paced for a clip, as a card (the page's own defaults stay: the bot's plans and their share links,
  // and a recorded crew eval's briefs, read them): gap 1.0 at ball speed 500 brings 34 of 40 seeds out by 27 s (the defaults:
  // 0), with the ring sounds; seed 7 breaks its seven rings at 1.6, 3.4, 3.5, 8.2, 11.1, 12.3 and 17.3 s and is out at 18.1 s
  {
    id: "ring-ladder",
    mode: "classic",
    query: "mode=classic&s=500&gap=1&shake=0.3&glow=1&wbreak=all&resn=1&seed=7",
    previewAt: 8.4,
    name: { en: "Ring Ladder", pl: "Drabina pierścieni", es: "Escalera de anillos" },
    description: {
      en: "Seven rainbow rings with wide gaps and a fast ball. Every ring it breaks climbs a note, and the way out lands the chord.",
      pl: "Siedem tęczowych pierścieni z szerokimi przerwami i szybka piłka. Każdy rozbity pierścień to nuta wyżej, a wyjście kończy się akordem.",
      es: "Siete anillos arcoíris con huecos anchos y una bola rápida. Cada anillo que rompe sube una nota y la salida cierra con un acorde.",
    },
  },
  {
    id: "galaxy-pendulum",
    mode: "pendulum",
    query: "mode=pendulum&pwn=30&pwk=51&pwt=60&pwtr=0.6&glow=1&rwalls=0&cc=%237cffcb&bc=%23ffffff&bc2=%23c084fc&lc=%237cffcb&pwl=galaxy&theme=aurora&bgt=gradient&bg1=%23020024&bg2=%23093637&ps=bubbles&trc=%237cffcb%2C%23c084fc&seed=132967117",
    previewAt: 12,
    name: { en: "Aurora Galaxy Wave", pl: "Galaktyka zorzy", es: "Galaxia boreal" },
    description: {
      en: "Thirty pendulums laid out as a spinning galaxy drift into spiral arms and snap back in line, in northern-lights colours.",
      pl: "Trzydzieści wahadeł ułożonych w wirującą galaktykę rozchodzi się w spiralne ramiona i znów ustawia w linii, w barwach zorzy polarnej.",
      es: "Treinta péndulos dispuestos como una galaxia giratoria se abren en brazos espirales y vuelven a alinearse, con los colores de la aurora boreal.",
    },
  },
  {
    id: "web-dominion",
    mode: "stringBattle",
    query: "mode=stringBattle&sbst=neon&seed=228323246",
    // (E2 review: the ring lit for the last duel, and a camera that leaves the corner's English FLASHING LIGHTS notice out)
    previewAt: 18,
    camera: { zoom: 1.25 },
    name: { en: "Neon Web", pl: "Neonowa sieć", es: "Red de neón" },
    description: {
      en: "Four balls drag fans of glowing threads across a neon moiré, cutting each other's strings until one rules the web.",
      pl: "Cztery piłki ciągną wachlarze świecących nici przez neonową mory i przecinają sobie nawzajem sznurki, aż jedna zapanuje nad siecią.",
      es: "Cuatro bolas arrastran abanicos de hilos luminosos sobre un muaré de neón y se cortan los hilos entre sí hasta que una domina la red.",
    },
  },
  {
    // (--- review fix B3 --- the page's pace, six rings of even two-hit bricks: the old twelve rings sit closer than the ball is
    // wide, and with the push-out fix its seed played a 6 s run; seed 103 plays 18.0 s, a ring out at 0.9, 3.9, 7.5, 15.1, 15.9
    // and 16.4 s, then the collapse)
    id: "sunset-shatter",
    mode: "shatter",
    query: "mode=shatter&glow=1&rwalls=0&cc=%23ffd166&bc=%23ffffff&bc2=%23ef476f&lc=%23ffd166&wbreak=shatter&theme=sunset&bgt=gradient&bg1=%232d1b69&bg2=%23b33951&ps=petals&trc=%23ff9a3c%2C%23ff3c78&seed=103",
    previewAt: 16.5,
    name: { en: "Sunset Shatter", pl: "Rozbicie o zachodzie", es: "Estallido al atardecer" },
    description: {
      en: "Six walls of cracked bricks under a violet-to-rose sky. Every bounce chips one until the ball smashes its way out in a shower of petals.",
      pl: "Sześć ścian z pękniętych cegieł pod fioletoworóżowym niebem. Każde odbicie odłupuje kawałek, aż piłka przebije się na zewnątrz w deszczu płatków.",
      es: "Seis muros de ladrillos agrietados bajo un cielo violeta y rosa. Cada rebote arranca un trozo hasta que la bola se abre paso entre una lluvia de pétalos.",
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
      en: "Twelve squares with health bars in a shrinking circular arena. The faster one deals the damage, and the last square standing wins.",
      pl: "Dwanaście kwadratów z paskami życia na kurczącej się okrągłej arenie. Obrażenia zadaje szybszy, a wygrywa ostatni, który przetrwa.",
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
    // (--- glass-real --- Lane E, E4: the leading camera, the next panes in view; the run is the same)
    query: "mode=glass&glow=1&rwalls=0&gll=1&cc=%23ffd166&bc=%23ffffff&bc2=%23ef476f&lc=%23ffd166&bn=Gerald&face=cute&theme=sunset&bgt=gradient&bg1=%232d1b69&bg2=%23b33951&ps=petals&trc=%23ff9a3c%2C%23ff3c78&seed=1122274490",
    previewAt: 11.5,
    name: { en: "Gerald at Sunset", pl: "Gerald o zachodzie słońca", es: "Gerald al atardecer" },
    description: {
      en: "Gerald, all smiles, smashes his way down a shaft of glass under a sunset sky. Every landing a note, every last hit a crash of shards.",
      pl: "Uśmiechnięty Gerald przebija się w dół szybu pełnego szyb pod niebem o zachodzie. Każde lądowanie to nuta, każde ostatnie uderzenie to deszcz odłamków.",
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
    query: "mode=race&glow=1&rcn=10&rcl=8&seed=1689637060" /* --- finales-in-clip --- (B6: the 8-screen track written out, the page has 6) */,
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
  // --- grow-fill-clip --- Grow's start look as a card (the page's own defaults stay: the bot's fill-grow plans and the crew's
  // corpus read them): the multiply law at 4 % a bounce from 15 % of the ring (--- review fix (B5) ---), the run ending at the
  // fill; seed 7 is full at 19.0 s and over at 19.5 s
  {
    id: "fill-the-ring",
    mode: "grow",
    query: "mode=grow&gLaw=multiply&gFill=finish&gStep=4&gStart=15&gHue=1&gMark=1&gPitch=1&seed=7",
    previewAt: 17.5,
    name: { en: "Fill the Ring", pl: "Wypełnij pierścień", es: "Llena el anillo" },
    description: {
      en: "A small ball grows 4% with every bounce, its note dropping and its colour warming as it swells, until it fills the ring and lands the chord.",
      pl: "Mała piłka rośnie o 4% z każdym odbiciem, jej nuta opada, a kolor się ociepla, aż wypełni cały pierścień i zabrzmi akord.",
      es: "Una pelota pequeña crece un 4 % con cada rebote, su nota baja y su color se calienta hasta que llena el anillo y suena el acorde.",
    },
  },
  // --- multiply-race --- Multiply's start look as a card (the page's own defaults stay, as Grow's): the race to the limit through
  // the page's gap of 0.3 (--- review fix (B5) --- with its pacer); seed 7's swarm reaches 200 at 15.8 s, the run over at 17.3 s
  {
    id: "swarm-race",
    mode: "multiply",
    query: "mode=multiply&mrace=1&seed=7",
    previewAt: 9,
    name: { en: "Swarm Race", pl: "Wyścig roju", es: "Carrera del enjambre" },
    description: {
      en: "One ball slips out of the ring at once and every escape spawns three more. The count doubles and doubles until the swarm hits 200 and the ring bursts.",
      pl: "Jedna piłka od razu wymyka się z pierścienia, a każda ucieczka daje trzy nowe. Licznik podwaja się raz za razem, aż rój dojdzie do 200 i pierścień pęknie.",
      es: "Una pelota sale del anillo al instante y cada escape suma tres más. La cuenta se duplica una y otra vez hasta que el enjambre llega a 200 y el anillo estalla.",
    },
  },
  {
    id: "neon-vortex",
    mode: "vortex",
    query: "mode=vortex&glow=1&rwalls=0&cc=%23ff00e6&bc=%2300f0ff&bc2=%23faff00&lc=%2300f0ff&face=cute&theme=neon&bgt=gradient&bg1=%230b0014&bg2=%231f0040&ps=sparks&trc=%2300f0ff%2C%23ff00e6&vxn=20&vxrl=stagger&seed=199343859" /* --- finales-in-clip --- (B6: the stagger release written out, the page plays the rings) */,
    previewAt: 13,
    name: { en: "Neon Vortex", pl: "Neonowy wir", es: "Vórtice de neón" },
    description: {
      en: "Twenty smiling balls spiral down a magenta whirlpool of sound rings. Each one a rising glissando, each swallow a pew.",
      pl: "Dwadzieścia uśmiechniętych piłek schodzi spiralą w purpurowy wir dźwiękowych pierścieni. Każda to wznoszące się glissando, każde połknięcie to „piu”.",
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
      en: "Four synthwave squares count down from 30 with every wall hit and grow a little each time. Which one reaches zero first?",
      pl: "Cztery kwadraty w stylu synthwave odliczają od 30 przy każdym uderzeniu w ścianę i za każdym razem trochę rosną. Który pierwszy dojdzie do zera?",
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
      en: "Painters cover the arena in black and steer around one secret shape. Watch the white space close in until only a heart is left.",
      pl: "Malarze pokrywają arenę czernią i omijają jeden sekretny kształt. Patrz, jak biała przestrzeń się kurczy, aż zostaje samo serce.",
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
  // --- gallery-every-mode --- (Lane E, E2) a finished look for every mode that had none: each a measured run (the seed's end
  // inside its clip where the mode ends), a theme or a pace of its own, and its card picture (GALLERY=<id> npm run previews)
  // --- gallery-every-mode --- seed 8: the run ends at 17.1 s of its 30 s clip in the 800 × 450 world (17.1 s in a phone's 450 × 450)
  {
    id: "frozen-spikes",
    mode: "accumulation",
    query: "mode=accumulation&s=450&wt=4&gap=0.35&at=3&glow=1&rwalls=0&spikes=1&cc=%234cc9f0&bc=%23ffffff&bc2=%2372efdd&lc=%2390e0ef&theme=ocean&bgt=gradient&bg1=%23001d3d&bg2=%23005f73&ps=bubbles&trc=%234cc9f0%2C%2380ffdb&seed=8",
    previewAt: 15,
    name: { en: "Frozen Spikes", pl: "Lodowe kolce", es: "Púas heladas" },
    description: {
      en: "Every ball that fails to escape in time freezes in place, in ocean blues. The frozen pile closes in on the next one.",
      pl: "Każda piłka, która nie ucieknie na czas, zamarza w miejscu, w odcieniach oceanu. Zamarznięty stos osacza następną.",
      es: "Cada bola que no escapa a tiempo se congela en su sitio, en tonos de océano. La pila helada acorrala a la siguiente.",
    },
  },
  // --- gallery-every-mode --- seed 7: the run ends at 20.3 s of its 30 s clip in the 800 × 450 world (20.3 s in a phone's 450 × 450)
  {
    id: "sunset-countdown",
    mode: "target",
    query: "mode=target&r=11&wt=5&tt=1.6&rwalls=0&cc=%23ffd166&bc=%23ffffff&bc2=%23ef476f&lc=%23ffd166&theme=sunset&bgt=gradient&bg1=%232d1b69&bg2=%23b33951&ps=petals&trc=%23ff9a3c%2C%23ff3c78&seed=7",
    previewAt: 16,
    name: { en: "Sunset Countdown", pl: "Odliczanie o zachodzie", es: "Cuenta atrás al atardecer" },
    description: {
      en: "Numbered targets glow on sunset rings. The ball has to hit them in order, and each correct hit breaks one.",
      pl: "Ponumerowane cele świecą na pierścieniach w barwach zachodu. Piłka musi trafiać je po kolei, a każde trafienie jeden rozbija.",
      es: "Los objetivos numerados brillan en anillos color atardecer. La bola debe darles en orden y cada acierto rompe uno.",
    },
  },
  // --- gallery-every-mode --- seed 7: the run ends at 25.1 s of its 30 s clip in the 800 × 450 world (25.1 s in a phone's 450 × 450)
  {
    id: "aurora-portals",
    mode: "portal",
    query: "mode=portal&r=11&wt=5&tt=1.6&glow=1&wglow=1&rwalls=0&cc=%237cffcb&bc=%23ffffff&bc2=%23c084fc&lc=%237cffcb&theme=aurora&bgt=gradient&bg1=%23020024&bg2=%23093637&ps=bubbles&trc=%237cffcb%2C%23c084fc&seed=7",
    previewAt: 14,
    name: { en: "Aurora Portals", pl: "Portale zorzy", es: "Portales de aurora" },
    description: {
      en: "The ball jumps from portal to twin portal under northern lights. After a few trips each pair burns out and the way opens.",
      pl: "Piłka skacze z portalu do bliźniaczego portalu pod zorzą polarną. Po kilku przejściach każda para się wypala i droga się otwiera.",
      es: "La bola salta de un portal a su gemelo bajo la aurora boreal. Tras unos viajes cada par se apaga y se abre el camino.",
    },
  },
  // --- gallery-every-mode --- seed 8: the run ends at 22.6 s of its 30 s clip in the 800 × 450 world (22.6 s in a phone's 450 × 450)
  {
    id: "candy-match",
    mode: "colorMatch",
    query: "mode=colorMatch&r=11&wt=5&tt=1.6&wglow=1&rwalls=0&cc=%23ff85a1&bc=%23fff0f3&bc2=%23ffd6a5&lc=%23caffbf&theme=candy&bgt=gradient&bg1=%232a0a2e&bg2=%235a189a&trc=%23ff85a1%2C%239bf6ff&seed=8",
    previewAt: 14,
    name: { en: "Candy Match", pl: "Cukierkowe dopasowanie", es: "Combinación de caramelo" },
    description: {
      en: "The ball changes colour on every bounce in a candy-pink arena. A segment breaks only when the colours match.",
      pl: "Piłka zmienia kolor przy każdym odbiciu na cukierkowej arenie. Segment pęka tylko wtedy, gdy kolory się zgadzają.",
      es: "La bola cambia de color en cada rebote en una arena color caramelo. Un segmento solo se rompe si los colores coinciden.",
    },
  },
  // --- gallery-every-mode --- seed 2: the run ends at 22.9 s of its 30 s clip in the 800 × 450 world (22.9 s in a phone's 450 × 450)
  {
    id: "neon-flag-raid",
    mode: "ctf",
    query: "mode=ctf&glow=1&rwalls=0&cc=%23ff00e6&bc=%2300f0ff&bc2=%23faff00&lc=%2300f0ff&theme=neon&bgt=gradient&bg1=%230b0014&bg2=%231f0040&ps=sparks&trc=%2300f0ff%2C%23ff00e6&seed=2",
    previewAt: 10,
    name: { en: "Neon Flag Raid", pl: "Neonowy rajd po flagę", es: "Asalto de neón" },
    description: {
      en: "Two neon teams of squares race for each other's flag. Grab it, carry it home and the score ticks over.",
      pl: "Dwie neonowe drużyny kwadratów walczą o flagę rywala. Zdobądź ją, donieś do bazy i wynik rośnie.",
      es: "Dos equipos de cuadrados de neón corren a por la bandera rival. Atrápala, llévala a casa y sube el marcador.",
    },
  },
  // --- gallery-every-mode --- seed 4: the run ends at 24.1 s of its 30 s clip in the 800 × 450 world (24.1 s in a phone's 450 × 450)
  {
    id: "retro-runner",
    mode: "runner",
    query: "mode=runner&glow=1&rwalls=0&cc=%23ff71ce&bc=%23fffb96&bc2=%2301cdfe&lc=%2305ffa1&face=cute&theme=retro&bgt=gradient&bg1=%231a1033&bg2=%233d0f4f&ps=pixels&trc=%23ff71ce%2C%2301cdfe&rrn=24&rrd=1&seed=4" /* --- finales-in-clip --- (B6: 24 obstacles written out, the page has 18) */,
    previewAt: 8,
    name: { en: "Retro Runner", pl: "Retro biegacz", es: "Corredor retro" },
    description: {
      en: "A cute square runs and jumps to the beat in retro colours. Every landing hits a beat, right to the finish.",
      pl: "Uroczy kwadrat biegnie i skacze w rytm w kolorach retro. Każde lądowanie trafia w rytm, aż do mety.",
      es: "Un cuadrado adorable corre y salta al ritmo en colores retro. Cada aterrizaje cae a compás hasta la meta.",
    },
  },
  // --- gallery-every-mode --- seed 6: the run ends at 26.1 s of its 30 s clip in the 800 × 450 world (26.1 s in a phone's 450 × 450)
  {
    id: "sunset-keep-up",
    mode: "paddle",
    query: "mode=paddle&glow=1&rwalls=0&cc=%23ffd166&bc=%23ffffff&bc2=%23ef476f&lc=%23ffd166&theme=sunset&bgt=gradient&bg1=%232d1b69&bg2=%23b33951&ps=petals&trc=%23ff9a3c%2C%23ff3c78&pdsp=1&pdg=0&seed=6" /* --- finales-in-clip --- (B6: no goal written out, the page plays to 20) */,
    previewAt: 10,
    name: { en: "Sunset Keep-Up", pl: "Odbijanie o zachodzie", es: "Toques al atardecer" },
    description: {
      en: "A sliding platform keeps the ball in the air against a sunset sky. Every catch plays a note until it misses.",
      pl: "Przesuwana platforma utrzymuje piłkę w powietrzu na tle zachodzącego słońca. Każde złapanie gra nutę, aż do pudła.",
      es: "Una plataforma móvil mantiene la bola en el aire bajo un cielo de atardecer. Cada toque suena hasta el primer fallo.",
    },
  },
  // --- gallery-every-mode --- seed 2: the run ends at 21.8 s of its 30 s clip in the 800 × 450 world (21.8 s in a phone's 450 × 450)
  {
    id: "pastel-commute",
    mode: "journey",
    query: "mode=journey&glow=1&rwalls=0&cc=%23ffc8dd&bc=%23bde0fe&bc2=%23cdb4db&lc=%23ffafcc&face=cute&theme=pastel&bgt=gradient&bg1=%232b2d42&bg2=%234a4e69&ps=petals&trc=%23a2d2ff%2C%23ffc8dd&js=rings-l%2Cglass%2Cpegs%2Chome&seed=2",
    previewAt: 6,
    name: { en: "Pastel Commute", pl: "Pastelowa droga do domu", es: "Vuelta a casa pastel" },
    description: {
      en: "Gerald bounces home through rings, glass and pegs in soft pastel colours. Every stage opens on the next.",
      pl: "Gerald odbija się w drodze do domu przez pierścienie, szkło i kołki w miękkich pastelach. Każdy etap prowadzi do następnego.",
      es: "Gerald rebota de vuelta a casa entre anillos, cristal y clavos en suaves tonos pastel. Cada etapa da paso a la siguiente.",
    },
  },
  // --- gallery-every-mode --- seed 8: the run ends at 12.2 s of its 15 s clip in the 800 × 450 world (12.2 s in a phone's 450 × 450)
  {
    id: "candy-darts",
    mode: "bullseye",
    query: "mode=bullseye&glow=1&rwalls=0&cc=%23ff85a1&bc=%23fff0f3&bc2=%23ffd6a5&lc=%23caffbf&dur=15&face=cute&theme=candy&bgt=gradient&bg1=%232a0a2e&bg2=%235a189a&trc=%23ff85a1%2C%239bf6ff&bys=12&byi=0.4&byp=2&seed=8" /* --- finales-in-clip --- (B6: 12 shots written out, the page has 10) */,
    previewAt: 5,
    name: { en: "Candy Darts", pl: "Cukierkowe rzutki", es: "Dardos de caramelo" },
    description: {
      en: "Balls fire through the pegs onto a candy dartboard. Every ring scores, and a centre hit bursts into confetti.",
      pl: "Piłki lecą przez kołki na cukierkową tarczę. Każdy pierścień daje punkty, a trafienie w środek wybucha konfetti.",
      es: "Las bolas cruzan los clavos hacia una diana de caramelo. Cada anillo puntúa y un tiro al centro estalla en confeti.",
    },
  },
  // --- gallery-every-mode --- seed 2: Beat Drop plans its run to the clip, so it lands its last beat at 29.6 s of its 30 s clip
  {
    id: "neon-drop",
    mode: "beatDrop",
    query: "mode=beatDrop&glow=1&rwalls=0&cc=%23ff00e6&bc=%2300f0ff&bc2=%23faff00&lc=%2300f0ff&face=cute&theme=neon&bgt=gradient&bg1=%230b0014&bg2=%231f0040&ps=sparks&trc=%2300f0ff%2C%23ff00e6&bdd=1&bda=1&seed=2",
    // (E2 review: the mode draws its own night sky, so the picture is a camera on the ball landing on a pad, not the whole stage)
    previewAt: 11.5,
    camera: { x: 0.36, y: 0.6, zoom: 1.6 },
    name: { en: "Neon Beat Drop", pl: "Neonowe spadanie w rytm", es: "Caída al ritmo de neón" },
    description: {
      en: "Neon pads fly in just before each beat, so every landing of the ball hits it. Made for a music edit.",
      pl: "Neonowe platformy wlatują tuż przed każdym bitem, więc każde lądowanie piłki trafia w rytm. Stworzone pod montaż muzyczny.",
      es: "Plataformas de neón llegan justo antes de cada golpe, así que cada aterrizaje cae a compás. Hecho para vídeos musicales.",
    },
  },
  // --- gallery-every-mode --- seed 2: the run ends at 30 s of its 34 s clip in the 800 × 450 world (30 s in a phone's 450 × 450)
  {
    id: "turf-war",
    mode: "territory",
    query: "mode=territory&glow=1&tyb=3&tybg=0&seed=2",
    previewAt: 16,
    name: { en: "Turf War", pl: "Wojna o teren", es: "Guerra de territorio" },
    description: {
      en: "Teams of balls paint the tile map their colour while blasts and whirls bite into the other side. One bounce can flip the board.",
      pl: "Drużyny piłek malują mapę kafelków na swój kolor, a wybuchy i wiry wgryzają się w stronę rywala. Jedno odbicie może odwrócić planszę.",
      es: "Equipos de bolas pintan el mapa de su color mientras explosiones y remolinos muerden el lado rival. Un rebote puede darle la vuelta.",
    },
  },
  // --- gallery-every-mode --- seed 7: the run ends at 21.7 s of its 30 s clip in the 800 × 450 world (21.7 s in a phone's 450 × 450)
  {
    id: "red-maze-race",
    mode: "maze",
    query: "mode=maze&glow=1&mzn=4&mzd=60&mzbg=0&mzhud=0&mzfo=0&seed=7" /* --- finales-in-clip --- (B6: every ball out and the 60 s limit written out; the page ends at the first one out, 25 s at most) */,
    previewAt: 12,
    name: { en: "Four in the Maze", pl: "Czwórka w labiryncie", es: "Cuatro en el laberinto" },
    description: {
      en: "Four balls drop into a glowing maze and race for the exit, painting every corridor red behind them.",
      pl: "Cztery piłki wpadają do świecącego labiryntu i ścigają się do wyjścia, malując za sobą każdy korytarz na czerwono.",
      es: "Cuatro bolas caen en un laberinto luminoso y corren hacia la salida, pintando de rojo cada pasillo a su paso.",
    },
  },
  // --- gallery-every-mode --- seed 2: the run ends at 22.4 s of its 30 s clip in the 800 × 450 world (24.9 s in a phone's 450 × 450)
  {
    id: "pastel-conveyor",
    mode: "conveyor",
    query: "mode=conveyor&glow=1&rwalls=0&cc=%23ffc8dd&bc=%23bde0fe&bc2=%23cdb4db&lc=%23ffafcc&face=cute&theme=pastel&bgt=gradient&bg1=%232b2d42&bg2=%234a4e69&ps=petals&trc=%23a2d2ff%2C%23ffc8dd&cvi=1&cvn=12&seed=2",
    previewAt: 10,
    name: { en: "Pastel Conveyor", pl: "Pastelowa taśma", es: "Cinta pastel" },
    description: {
      en: "A belt drops a new ball into the pastel rings every second. The pile grows and the counter keeps score.",
      pl: "Taśma co sekundę zrzuca nową piłkę do pastelowych pierścieni. Stos rośnie, a licznik liczy punkty.",
      es: "Una cinta deja caer una bola nueva en los anillos pastel cada segundo. La pila crece y el contador lleva la cuenta.",
    },
  },
  // --- gallery-every-mode --- the mode keeps going to the end of its 30 s clip (no end of its own inside it)
  {
    id: "aurora-orbs",
    mode: "orbGrid",
    query: "mode=orbGrid&glow=1&rwalls=0&cc=%237cffcb&bc=%23ffffff&bc2=%23c084fc&lc=%237cffcb&theme=aurora&bgt=gradient&bg1=%23020024&bg2=%23093637&ps=bubbles&trc=%237cffcb%2C%23c084fc&ogC=44&ogR=43&ogS=0.8&ogB=0.882&ogCycle=30&ogD=corner&ogRhythm=corner&ogHud=0&seed=3" /* --- finales-in-clip --- (B6: the 30 s cycle written out, the page has 26) */,
    previewAt: 14.5,
    name: { en: "Orb Wave", pl: "Fala kul", es: "Ola de orbes" },
    description: {
      en: "Nearly two thousand orbs bounce on their own spot. Waves roll out from one corner until every orb lands together.",
      pl: "Prawie dwa tysiące kul odbija się każda w swoim miejscu. Fale toczą się od rogu, aż wszystkie wylądują razem.",
      es: "Casi dos mil orbes rebotan cada uno en su sitio. Las olas salen de una esquina hasta que todos aterrizan a la vez.",
    },
  },
  // --- gallery-every-mode --- seed 2: the run ends at 17 s of its 25 s clip in the 800 × 450 world (17 s in a phone's 450 × 450)
  {
    id: "thunder-duel",
    mode: "fightLeague",
    // (E2 review: the lilac stage and its neon floor, the drawing only, never the fight: the noir stage's picture was 94% black)
    query: "mode=fightLeague&glow=1&dur=25&flSt=lilac&flAs=neon&seed=2",
    previewAt: 9.5,
    camera: { y: 0.45, zoom: 1.3 },
    name: { en: "Thunder Duel", pl: "Pojedynek gromów", es: "Duelo del trueno" },
    description: {
      en: "Thor and Loki duel as balls on a lilac stage, each with his own weapon. The clip ends on the knockout.",
      pl: "Thor i Loki walczą jako piłki na liliowej scenie, każdy własną bronią. Klip kończy się nokautem.",
      es: "Thor y Loki se enfrentan como bolas en un escenario lila, cada uno con su arma. El clip termina con el KO.",
    },
  },
  // --- gallery-every-mode --- seed 1: the run ends at 8.2 s of its 12 s clip in the 800 × 450 world (8 s in a phone's 450 × 450)
  {
    id: "flag-wall",
    mode: "landClaim",
    query: "mode=landClaim&glow=1&two=1&dur=12&teams=France*0055a4*%F0%9F%87%AB%F0%9F%87%B7%2CBrazil*009c3b*%F0%9F%87%A7%F0%9F%87%B7%2CSpain*aa151b*%F0%9F%87%AA%F0%9F%87%B8%2CColombia*fcd116*%F0%9F%87%A8%F0%9F%87%B4&tn=0&tsb=0&lcm=claim&lch=0&seed=1",
    previewAt: 5,
    name: { en: "Four Flags", pl: "Cztery flagi", es: "Cuatro banderas" },
    description: {
      en: "France, Brazil, Spain and Colombia knock blocks off the wall for their colour. Most blocks wins in a few seconds.",
      pl: "Francja, Brazylia, Hiszpania i Kolumbia strącają klocki ze ściany dla swojego koloru. Po kilku sekundach wygrywa ta z największą liczbą.",
      es: "Francia, Brasil, España y Colombia tiran bloques del muro para su color. En unos segundos gana quien tenga más.",
    },
  },
  // --- gallery-every-mode --- the mode keeps going to the end of its 30 s clip (no end of its own inside it)
  {
    id: "colour-bullseye",
    mode: "colourSort",
    query: "mode=colourSort&trails=1&lh=0&seed=1",
    previewAt: 9,
    name: { en: "Colour Bullseye", pl: "Kolorowa tarcza", es: "Diana de colores" },
    description: {
      en: "Ninety mixed balls slip through one-way gates on turning rings. They sort into a bullseye of colours, then mix again.",
      pl: "Dziewięćdziesiąt piłek przelatuje przez jednokierunkowe bramki na wirujących pierścieniach. Układają się w kolorową tarczę i znów się mieszają.",
      es: "Noventa bolas mezcladas cruzan puertas de un solo sentido en anillos que giran. Se ordenan en una diana de colores y vuelven a mezclarse.",
    },
  },
  // --- gallery-every-mode --- the mode keeps going to the end of its 30 s clip (no end of its own inside it)
  {
    id: "golden-stars",
    mode: "starChords",
    query: "mode=starChords&glow=1&cc=%23d4af37&bc=%23fff4d6&bc2=%23b8860b&lc=%23f5d77a&theme=luxe&bgt=gradient&bg1=%230f0c05&bg2=%232b2111&trc=%23ffd700%2C%23b8860b&lh=0&seed=1",
    previewAt: 12.3,
    name: { en: "Golden Stars", pl: "Złote gwiazdy", es: "Estrellas doradas" },
    description: {
      en: "Balls draw five star polygons in gold inside one circle. Every star closes on the same frame with a chord.",
      pl: "Piłki rysują złotem pięć gwiaździstych wielokątów w jednym kole. Wszystkie gwiazdy domykają się w tej samej klatce z akordem.",
      es: "Las bolas dibujan en dorado cinco polígonos estrellados dentro de un círculo. Todas se cierran en el mismo fotograma con un acorde.",
    },
  },
  // --- gallery-every-mode --- the mode keeps going to the end of its 30 s clip (no end of its own inside it)
  {
    id: "rising-beads",
    mode: "hoops",
    query: "mode=hoops&glow=1&bg1=%230b1020&bg2=%230b1020&seed=1",
    previewAt: 12.9,
    name: { en: "Rising Beads", pl: "Wspinające się koraliki", es: "Cuentas que suben" },
    description: {
      en: "Eight hoops spin faster and faster. One by one the beads climb, biggest hoop first, until all eight line up.",
      pl: "Osiem obręczy kręci się coraz szybciej. Koraliki wspinają się po kolei, od największej obręczy, aż cała ósemka stanie w linii.",
      es: "Ocho aros giran cada vez más rápido. Las cuentas suben una a una, desde el aro más grande, hasta alinearse las ocho.",
    },
  },
  // --- gallery-every-mode --- the mode keeps going to the end of its 30 s clip (no end of its own inside it)
  {
    id: "comet-volley",
    mode: "ellipseFoci",
    query: "mode=ellipseFoci&glow=1&lh=0&efTr=0.45&seed=2",
    previewAt: 2.2,
    name: { en: "Comet Volley", pl: "Salwa komet", es: "Ráfaga de cometas" },
    description: {
      en: "Seventy-two balls fire from one focus of an elliptical pool, trailing like comets. They all land on the other focus at once.",
      pl: "Siedemdziesiąt dwie piłki wylatują z jednego ogniska eliptycznego stołu, ciągnąc ogony jak komety. Wszystkie trafiają naraz w drugie ognisko.",
      es: "Setenta y dos bolas salen de un foco de una mesa elíptica con estelas de cometa. Todas llegan a la vez al otro foco.",
    },
  },
  // --- gallery-every-mode --- the mode keeps going to the end of its 30 s clip (no end of its own inside it)
  {
    id: "marble-tune",
    mode: "beatMachine",
    // (E2 review: the neon theme's violet sky behind the machine and a camera on the bars: the plain picture was 93% black)
    query: "mode=beatMachine&glow=1&rwalls=0&cc=%23ff00e6&bc=%2300f0ff&bc2=%23faff00&lc=%2300f0ff&theme=neon&bg1=%230b0014&bg2=%231f0040&ps=sparks&trc=%2300f0ff%2C%23ff00e6&lh=0&seed=1",
    previewAt: 3.5,
    camera: { y: 0.58, zoom: 1.4 },
    name: { en: "Marble Xylophone", pl: "Kulkowy ksylofon", es: "Xilófono de canicas" },
    description: {
      en: "Marbles drop from their tubes onto tuned bars and ride the lift back up. Every note lands right on the beat.",
      pl: "Kulki spadają z rurek na nastrojone sztabki i wracają windą na górę. Każda nuta trafia idealnie w rytm.",
      es: "Las canicas caen de sus tubos sobre barras afinadas y vuelven a subir en el ascensor. Cada nota cae justo a compás.",
    },
  },
  // --- gallery-every-mode --- the mode keeps going to the end of its 30 s clip (no end of its own inside it)
  {
    id: "seven-gaps",
    mode: "waveTank",
    query: "mode=waveTank&glow=1&lh=0&wtR=56&wtT=42&seed=1",
    previewAt: 22,
    name: { en: "Seven Gaps", pl: "Siedem szczelin", es: "Siete rendijas" },
    description: {
      en: "Waves squeeze through one, two, then seven gaps and fan into sharp beams. A row of bells plays the water.",
      pl: "Fale przeciskają się przez jedną, dwie, a potem siedem szczelin i rozchodzą się w ostre promienie. Rząd dzwonków gra wodę.",
      es: "Las olas pasan por una, dos y luego siete rendijas y se abren en haces nítidos. Una fila de campanas toca el agua.",
    },
  },
  // --- gallery-every-mode --- the mode keeps going to the end of its 30 s clip (no end of its own inside it)
  {
    id: "emblem-smash",
    mode: "brickRebuild",
    query: "mode=brickRebuild&trails=1&glow=1&lh=0&brV=600&seed=1",
    previewAt: 9,
    name: { en: "Emblem Smash", pl: "Rozbity emblemat", es: "Emblema roto" },
    description: {
      en: "Fast balls multiply and tear through a picture made of bricks. Then it rebuilds, one colour layer at a time.",
      pl: "Szybkie piłki mnożą się i przebijają przez obrazek z cegieł. Potem odbudowuje się warstwa po warstwie, kolor po kolorze.",
      es: "Bolas rápidas se multiplican y atraviesan una imagen de ladrillos. Luego se reconstruye, capa a capa y color a color.",
    },
  },
  // --- gallery-every-mode --- the mode keeps going to the end of its 30 s clip (no end of its own inside it)
  {
    id: "harmonograph",
    mode: "drawingMachine",
    query: "mode=drawingMachine&glow=1&lh=0&seed=1",
    previewAt: 15,
    name: { en: "Harmonograph", pl: "Harmonograf", es: "Harmonógrafo" },
    description: {
      en: "Three pendulums swing one pen across the paper. As they slow down, the line spirals in towards the centre.",
      pl: "Trzy wahadła prowadzą jedno pióro po papierze. Gdy zwalniają, linia zwija się spiralą do środka.",
      es: "Tres péndulos mueven una pluma sobre el papel. Al frenar, la línea se enrosca en espiral hacia el centro.",
    },
  },
  // --- gallery-every-mode --- the mode keeps going to the end of its 30 s clip (no end of its own inside it)
  {
    id: "perfect-box",
    mode: "perfectFit",
    query: "mode=perfectFit&glow=1&lh=0&seed=1",
    previewAt: 5.1,
    name: { en: "Perfect Box", pl: "Idealne pudełko", es: "Caja perfecta" },
    description: {
      en: "Glossy pieces drop straight down into a box and fill it exactly. Not one square is left over.",
      pl: "Błyszczące klocki spadają prosto do pudełka i wypełniają je co do kratki. Nie zostaje ani jedno wolne pole.",
      es: "Piezas brillantes caen en línea recta dentro de una caja y la llenan exacta. No sobra ni un solo cuadro.",
    },
  },
  // --- gallery-every-mode --- seed 7: the run ends at 21.3 s of its 30 s clip in the 800 × 450 world (21.3 s in a phone's 450 × 450)
  {
    id: "neon-merge",
    mode: "mergeRing",
    query: "mode=mergeRing&glow=1&rwalls=0&cc=%23ff00e6&bc=%2300f0ff&bc2=%23faff00&lc=%2300f0ff&theme=neon&bgt=gradient&bg1=%230b0014&bg2=%231f0040&ps=sparks&trc=%2300f0ff%2C%23ff00e6&seed=7",
    previewAt: 15,
    camera: { y: 0.46, zoom: 1.4 }, // (E2 review: the ring's shapes, without the English question under it and the corner counts)
    name: { en: "Neon Merge", pl: "Neonowe łączenie", es: "Fusión de neón" },
    description: {
      en: "Balls drop into a neon ring and fuse tier by tier. Will the final form appear before the ring overflows?",
      pl: "Piłki wpadają do neonowego pierścienia i łączą się poziom po poziomie. Czy ostateczna forma zdąży, zanim pierścień się przepełni?",
      es: "Las bolas caen en un anillo de neón y se fusionan nivel a nivel. ¿Llegará la forma final antes de que se desborde?",
    },
  },
  // --- gallery-every-mode --- seed 3: the run ends at 19.9 s of its 30 s clip in the 800 × 450 world (19.9 s in a phone's 450 × 450)
  {
    id: "sunset-spiral",
    mode: "spiralGlass",
    query: "mode=spiralGlass&glow=1&rwalls=0&cc=%23ffd166&bc=%23ffffff&bc2=%23ef476f&lc=%23ffd166&theme=sunset&bgt=gradient&bg1=%232d1b69&bg2=%23b33951&ps=petals&trc=%23ff9a3c%2C%23ff3c78&sgv=1.2&seed=3",
    previewAt: 14,
    name: { en: "Sunset Spiral", pl: "Spirala o zachodzie", es: "Espiral al atardecer" },
    description: {
      en: "Balls circle a glass spiral in sunset colours and chip it away from the outside in. Every lap adds a ball.",
      pl: "Piłki krążą po szklanej spirali w barwach zachodu i kruszą ją od zewnątrz do środka. Każde okrążenie dokłada piłkę.",
      es: "Las bolas giran sobre una espiral de cristal en tonos de atardecer y la pican de fuera hacia dentro. Cada vuelta suma una bola.",
    },
  },
  // --- gallery-every-mode --- seed 3: the run ends at 21.8 s of its 30 s clip in the 800 × 450 world (21.8 s in a phone's 450 × 450)
  {
    id: "aurora-song",
    mode: "songRing",
    query: "mode=songRing&glow=1&rwalls=0&cc=%237cffcb&bc=%23ffffff&bc2=%23c084fc&lc=%237cffcb&theme=aurora&bgt=gradient&bg1=%23020024&bg2=%23093637&ps=bubbles&trc=%237cffcb%2C%23c084fc&seed=3",
    previewAt: 9,
    name: { en: "Aurora Song", pl: "Pieśń zorzy", es: "Canción de aurora" },
    description: {
      en: "A ball lights up a tune one bounce at a time under northern lights. Can you name it before the ring plays it whole?",
      pl: "Piłka zapala melodię odbicie po odbiciu pod zorzą polarną. Zgadniesz ją, zanim pierścień zagra całość?",
      es: "Una bola enciende una melodía rebote a rebote bajo la aurora boreal. ¿La adivinas antes de que el anillo la toque entera?",
    },
  },
  // --- gallery-every-mode --- seed 2: the run ends at 17.8 s of its 30 s clip in the 800 × 450 world (17.8 s in a phone's 450 × 450)
  {
    id: "sand-mandala",
    mode: "sandPlate",
    query: "mode=sandPlate&glow=1&seed=2",
    previewAt: 17.5,
    camera: { y: 0.4, zoom: 1.3 }, // (E2 review: the mandala alone, without its English THE FINAL SHAPE banner under the plate)
    name: { en: "Sand Mandala", pl: "Piaskowa mandala", es: "Mandala de arena" },
    description: {
      en: "Every new note shakes the sand into a finer figure. The last chord floods the plate with colour and leaves a mandala.",
      pl: "Każda nowa nuta układa piasek w drobniejszy wzór. Ostatni akord zalewa płytę kolorem i zostawia mandalę.",
      es: "Cada nota nueva sacude la arena en una figura más fina. El último acorde inunda la placa de color y deja un mandala.",
    },
  },
  // --- gallery-every-mode --- seed 3: the run ends at 19.6 s of its 30 s clip in the 800 × 450 world (18.7 s in a phone's 450 × 450)
  {
    id: "thin-ice",
    mode: "blueprint",
    query: "mode=blueprint&glow=1&blp=thinIce&seed=3",
    previewAt: 10,
    name: { en: "Thin Ice", pl: "Cienki lód", es: "Hielo fino" },
    description: {
      en: "Every bounce cracks the ice and balls fall through the holes. The last colour still dry wins.",
      pl: "Każde odbicie kruszy lód, a piłki wpadają w przeręble. Wygrywa ostatni kolor, który zostanie suchy.",
      es: "Cada rebote agrieta el hielo y las bolas caen por los agujeros. Gana el último color que siga seco.",
    },
  },
  // --- gallery-every-mode --- seed 5: the run ends at 19.4 s of its 30 s clip in the 800 × 450 world (19.4 s in a phone's 450 × 450)
  {
    id: "hot-potato",
    mode: "blueprint",
    query: "mode=blueprint&glow=1&blp=hotPotato&seed=5",
    previewAt: 10,
    camera: { x: 0.51, y: 0.53, zoom: 1.35 }, // (E2 review: the arena, without the English HOT POTATO title in its corner)
    name: { en: "Hot Potato", pl: "Gorący ziemniak", es: "Patata caliente" },
    description: {
      en: "A touch passes the swelling bomb to the next ball. Whoever holds it when the fuse runs out is gone.",
      pl: "Jeden dotyk przekazuje puchnącą bombę następnej piłce. Kto trzyma ją, gdy lont się dopali, odpada.",
      es: "Un toque pasa la bomba que se hincha a la siguiente bola. Quien la tenga cuando se acabe la mecha, queda fuera.",
    },
  },
];

/**
 * --- home-looks --- The landing page's row under the hero, "Start from a finished look" (HomeGallery.tsx): six presets of six
 * shelves whose pictures read at a card's size, the newest modes among them.
 * (E2 review: and whose pictures carry no words, which would be English on the Polish and Spanish pages: Chaos Harp takes
 * Aurora Song's place, whose ring asks NAME THE TUNE for the whole run)
 */
export const HOME_GALLERY_IDS: readonly string[] = ["neon-escape", "web-dominion", "chaos-harp", "sand-mandala", "neon-merge", "hot-potato"];

/** The presets of the landing page's row, in its order. */
export function homeGallery(): GalleryPreset[] {
  return HOME_GALLERY_IDS.map((id) => GALLERY.find((preset) => preset.id === id)).filter((preset): preset is GalleryPreset => !!preset);
}

/** The simulator link of a preset, relative to the locale (for next-intl's Link): `/simulator?<query>`. */
export function galleryHref(preset: Pick<GalleryPreset, "query">): string {
  return `/simulator?${preset.query}`;
}
