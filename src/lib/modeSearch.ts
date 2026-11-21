import type { ModeId } from "@/lib/physics/types";
import { fold, shelfOf, type ShelfId } from "@/lib/siteDesign";

/*
 * --- mode-search --- What the search of the modes wall and of the studio's mode picker matches. A visitor types what they
 * want to see ("fight", "race", "merge", "loop", "music") or a name they saw on a clip, in their own language or in
 * English. Neither is always on the card: Fight League's one-liner says "duel", a Polish page calls it "Liga walk". So
 * every mode and every shelf carries a few search words in English, Polish and Spanish. They are never shown.
 *
 * A mode is found by its name, its words (with the English ones and its id on every page: "fightLeague" answers to
 * "fight league" in Polish too), its shelf and its one-liner, in that order of worth. Pure, no React: the wall
 * (components/site/ModesOverview.tsx) and the command palette (components/simulator/Controls.tsx) call it.
 *
 * Keep a list to what the mode shows. No word that names a setting of the panel ("gravity", "speed", "size"): the
 * palette lists modes next to settings, and a mode that answers to a setting's name would crowd them.
 */

export const SEARCH_LOCALES = ["en", "pl", "es"] as const;
export type SearchLocale = (typeof SEARCH_LOCALES)[number];
type Words = Record<SearchLocale, string>;

/** The words every mode of a shelf answers to. */
export const SHELF_SEARCH_WORDS: Record<ShelfId, Words> = {
  escape: { en: "escape rings break out", pl: "ucieczka pierścienie wyjście", es: "escape anillos salir" },
  battle: { en: "battle fight versus war winner", pl: "bitwa walka wojna zwycięzca", es: "batalla pelea guerra ganador" },
  music: { en: "music rhythm beat song notes melody", pl: "muzyka rytm bit piosenka nuty melodia", es: "música ritmo canción notas melodía" },
  loops: { en: "loop loops pattern satisfying sync", pl: "pętla pętle wzór synchronizacja", es: "bucle bucles patrón sincronía" },
  smash: { en: "smash merge break destroy score", pl: "rozbijanie łączenie niszczenie punkty", es: "romper fusionar destruir puntos" },
  journey: { en: "journey story stages", pl: "podróż historia etapy", es: "viaje historia etapas" },
  lab: { en: "lab new rules games", pl: "laboratorium nowe zasady gry", es: "laboratorio nuevos reglas juegos" },
};

/** A few words per mode: what it shows, and the parts of its English name its id does not spell. */
export const MODE_SEARCH_WORDS: Record<ModeId, Words> = {
  classic: { en: "ring gap original first", pl: "pierścień szczelina klasyk", es: "anillo hueco clásico" },
  accumulation: { en: "freeze frozen pile fill timer", pl: "zamarzanie stos czas wypełnianie", es: "congelar pila tiempo llenar" },
  multiply: { en: "clone swarm double spawn", pl: "klony rój podwajanie", es: "clones enjambre doblar" },
  lines: { en: "string art draw web", pl: "nitki rysunek sieć", es: "hilos dibujo red" },
  paint: { en: "rainbow picture cover percent", pl: "tęcza obraz procent", es: "arcoíris imagen porcentaje" },
  target: { en: "numbers order aim countdown", pl: "liczby kolejność odliczanie", es: "números orden cuenta atrás" },
  grow: { en: "bigger fill huge", pl: "większa rośnie ogromna", es: "grande crece enorme" },
  shatter: { en: "crack chip smash segments", pl: "pęknięcia kruszenie segmenty", es: "grietas trozos segmentos" },
  colorMatch: { en: "colour colours matching", pl: "kolor kolory pasujące", es: "colores coincidencia" },
  portal: { en: "teleport warp twin", pl: "teleport przeskok", es: "teletransporte salto" },
  drop: { en: "ball pegs pegboard rain", pl: "kołki deszcz", es: "clavijas lluvia" },
  box: { en: "bouncing shapes dvd logo corner squares countdown", pl: "dvd logo róg kwadraty odliczanie", es: "dvd logo esquina cuadrados cuenta atrás" },
  pendulum: { en: "wave pendulums", pl: "wahadło fale", es: "péndulo ondas" },
  polyrhythm: { en: "metronomes tempo ticks flash", pl: "metronom tempo błysk", es: "metrónomo tempo destello" },
  collide: { en: "collision playground orbs bump", pl: "zderzenia kule", es: "choques esferas" },
  glass: { en: "floors panes crack shatter gerald", pl: "szyby piętra pęknięcia gerald", es: "pisos vidrio grietas gerald" },
  multipliers: { en: "gates clone hundreds counter", pl: "bramki klony setki licznik", es: "puertas clones cientos contador" },
  doublePendulum: { en: "harp strings chaos", pl: "harfa struny chaos", es: "arpa cuerdas caos" },
  illusion: { en: "circle optical trick", pl: "złudzenie optyczne trik", es: "óptica truco" },
  stringBattle: { en: "threads web lives duel", pl: "nici sieć życia pojedynek", es: "hilos red vidas duelo" },
  powerLayers: { en: "rainbow stack double", pl: "tęcza stos podwajanie", es: "arcoíris pila doblar" },
  race: { en: "racing grand prix track podium squares", pl: "wyścigi tor podium kwadraty", es: "carreras pista podio cuadrados" },
  battle: { en: "royale squares health last standing", pl: "kwadraty życie ostatni", es: "cuadrados vida último" },
  ctf: { en: "capture flag teams squares", pl: "flaga drużyny kwadraty", es: "bandera equipos cuadrados" },
  runner: { en: "run jump square", pl: "bieg skok kwadrat", es: "correr salto cuadrado" },
  paddle: { en: "keep up platform catch", pl: "platforma łapanie paletka", es: "plataforma atrapar pala" },
  vortex: { en: "sound whirlpool funnel spiral", pl: "wir lejek spirala", es: "remolino embudo espiral" },
  journey: { en: "gerald commute home", pl: "gerald droga dom", es: "gerald camino casa" },
  bullseye: { en: "darts dartboard pegs confetti", pl: "rzutki tarcza kołki konfetti", es: "dardos diana clavijas confeti" },
  beatDrop: { en: "platforms landing edit", pl: "platformy lądowanie", es: "plataformas aterrizaje" },
  territory: { en: "teams tiles map conquer", pl: "drużyny pola mapa podbój", es: "equipos casillas mapa conquistar" },
  maze: { en: "labyrinth race exit", pl: "labirynt wyścig wyjście", es: "laberinto carrera salida" },
  conveyor: { en: "belt pile counter", pl: "taśma stos licznik", es: "cinta pila contador" },
  orbGrid: { en: "bouncing orbs waves field thousands", pl: "kule fale pole tysiące", es: "esferas ondas campo miles" },
  fightLeague: { en: "duel fighters weapons characters tournament", pl: "pojedynek wojownicy broń postacie turniej", es: "duelo luchadores armas personajes torneo" },
  landClaim: { en: "blocks columns teams conquer", pl: "bloki kolumny drużyny podbój", es: "bloques columnas equipos conquistar" },
  colourSort: { en: "color sorting gates", pl: "kolory bramki sortowanie", es: "colores puertas ordenar" },
  starChords: { en: "stars polygons geometry", pl: "gwiazdy wielokąty geometria", es: "estrellas polígonos geometría" },
  hoops: { en: "spinning beads climb", pl: "koraliki wirowanie obręcze", es: "cuentas giro aros" },
  ellipseFoci: { en: "focus shot volley billiards", pl: "elipsa salwa bilard", es: "elipse salva billar" },
  beatMachine: { en: "marbles xylophone staircase", pl: "kulki cymbałki schody", es: "canicas xilófono escalera" },
  waveTank: { en: "water ripple bells stripes", pl: "woda fale dzwonki", es: "agua ondas campanas" },
  brickRebuild: { en: "smash bricks picture pixels", pl: "cegły obraz piksele", es: "ladrillos imagen píxeles" },
  drawingMachine: { en: "pen harmonograph flower pendulums", pl: "pióro harmonograf kwiat wahadła", es: "pluma armonógrafo flor péndulos" },
  perfectFit: { en: "pieces puzzle blocks fill", pl: "klocki układanka wypełnianie", es: "piezas rompecabezas bloques" },
  mergeRing: { en: "fuse fusion tiers overflow", pl: "łączenie scalanie fuzja poziomy", es: "fusionar fusión niveles" },
  spiralGlass: { en: "chip laps frosted", pl: "szkło okrążenia kruszenie", es: "vidrio vueltas astillar" },
  songRing: { en: "guess name piano playhead quiz", pl: "zgadnij pianino wskazówka quiz", es: "adivina piano aguja quiz" },
  blueprint: { en: "mode lab custom experiments", pl: "własne eksperymenty", es: "propios experimentos" },
};

/** "fightLeague" → "fight league": the id as words, so the English name is found on every page. */
const idWords = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
const tokens = (text: string) => fold(text).split(/[^a-z0-9]+/).filter(Boolean);
const localeOf = (locale: string): SearchLocale => ((SEARCH_LOCALES as readonly string[]).includes(locale) ? (locale as SearchLocale) : "en");

/** A mode's own search words on a page in `locale`: that language's, the English ones and the id (never the shelf's). */
export function modeSearchWords(mode: ModeId, locale: string): string {
  const own = MODE_SEARCH_WORDS[mode];
  const at = localeOf(locale);
  return [own[at], at === "en" ? "" : own.en, idWords(mode)].filter(Boolean).join(" ");
}

/** What a card shows of a mode, in the page's language. */
export interface ModeSearchItem {
  id: ModeId;
  name: string;
  description: string;
  /** The shelf's chip label. */
  shelf: string;
}

/**
 * The modes a search finds, best first. Every word of the query must start a word of the mode's name, of its search words,
 * of its shelf (the label and the shelf's words) or of its one-liner, or sit inside the name ("rhythm" finds "Polyrhythms").
 * A mode counts as much as its weakest word: the name beats the words, the words beat the shelf, the shelf beats the
 * one-liner, and a name that starts with the whole query comes first. Equal modes keep the order they came in. Diacritics
 * fold, so "petla" finds "pętla". An empty query finds every mode, in the order given.
 */
export function searchModes(items: readonly ModeSearchItem[], query: string, locale: string): ModeId[] {
  const q = fold(query.trim());
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return items.map((item) => item.id);
  const at = localeOf(locale);
  const scored: { id: ModeId; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const name = fold(item.name);
    const inName = tokens(item.name);
    const inWords = tokens(modeSearchWords(item.id, at));
    const shelf = SHELF_SEARCH_WORDS[shelfOf(item.id)];
    const inShelf = tokens(`${item.shelf} ${shelf[at]} ${at === "en" ? "" : shelf.en}`);
    const inLine = tokens(item.description);
    let worst = 4;
    for (const w of words) {
      const starts = (list: string[]) => list.some((t) => t.startsWith(w));
      const worth = starts(inName) || (w.length >= 3 && name.includes(w)) ? 4 : starts(inWords) ? 3 : starts(inShelf) ? 2 : starts(inLine) ? 1 : 0;
      if (worth === 0) return;
      worst = Math.min(worst, worth);
    }
    scored.push({ id: item.id, score: worst * 2 + (name.startsWith(q) ? 1 : 0), index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((x) => x.id);
}
