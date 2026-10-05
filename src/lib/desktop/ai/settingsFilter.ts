import type { SimulatorSettings } from "@/lib/settings";
import { assistantSettings } from "./settingsPatch";

/*
 * --- desktop-ai-fix --- The settings the assistant is shown for one request. 1.0.2 listed every setting the assistant may
 * change (the catalog plus the page mode's own block) in every prompt: ~3,800 tokens for the Settings job, which a CPU reads
 * for 40 s before the first word. Now the prompt (and the reply grammar, built from the same list) carries the settings
 * most requests touch plus those the request points at – by their names, the words of their descriptions or a concept
 * ("faster", "szybciej", "más rápido" → ballSpeed). --- review fix (desktop-ai-fix) --- and the page mode's own block,
 * always: its settings are described only as "<mode> setting", so no word of a request reaches them, and offering the
 * block only to a request that named the mode left "make the panes break on the second hit" on Glass Smash (or "longer
 * rounds" in Fight League) without a single setting of the mode – the grammar is built from the same list, so the local
 * model could not change them and the cloud model's change was refused. 1.0.2 offered them on every request.
 */

/** Always offered: what most requests change. */
export const CORE_SETTING_KEYS: readonly string[] = [
  "mode",
  "ballSpeed",
  "ballRadius",
  "gravity",
  "ballCount",
  "ballColor",
  "rainbowBall",
  "bounciness",
  "wallCount",
  "gapSize",
  "rotationSpeed",
  "circleColor",
  "rainbowWalls",
  "showTrails",
  "themeId",
  "recordingDuration",
  "topText",
  "bottomText",
];

/**
 * At most this many settings in one prompt. --- review fix (desktop-ai-fix) --- (was 40): room for the core settings, the
 * biggest mode block (Bouncing Orbs: 34) and the settings a request points at besides – a prompt of about 2,200 tokens at
 * most (1,700 for a Fight League request), where 1.0.2 listed every setting for ~3,800; past it the block's settings the
 * request does not point at give way first.
 */
export const MAX_RELEVANT_SETTINGS = 64;

/** Concepts in a request (English, Polish and Spanish word stems) → words that settings' keys and descriptions use. */
const CONCEPTS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/fast|slow|speed|quick|rapid|szybk|woln|prędk|predk|rápid|lent|velocid/, ["speed"]],
  [/big|small|size|large|tiny|huge|duż|duz|mał|male|mały|rozmiar|grande|pequeñ|pequen|tamañ|taman/, ["radius", "size"]],
  [/grav|fall|float|heavy|weightless|spada|ciężk|ciezk|nieważk|caer|caíd|flot/, ["gravity"]],
  [/bounc|odbi|odbij|rebot|elástic|elastic/, ["bounciness", "bounce", "restitution"]],
  [/rainbow|tęcz|tecz|arco ?iris|arcoíris/, ["rainbow"]],
  [/colou?r|kolor|\bred\b|blue|green|yellow|purple|pink|orange|white|black|gold|czerw|niebiesk|zielon|żółt|zolt|fiolet|różow|rozow|pomarańcz|biał|bial|czarn|złot|zlot|rojo|azul|verde|amarill|morad|rosa|naranj|blanc|negr|dorad/, ["colour", "color"]],
  [/ring|wall|circle|pierście|pierscie|ścian|scian|okrąg|okrag|koł|anill|pared|círcul|circul/, ["ring", "rings", "wall"]],
  [/gap|hole|exit|opening|dziur|szczelin|wyjś|wyjs|hueco|salida|abertura/, ["gap"]],
  [/rotat|spin|turn|obrot|obrac|kręc|krec|gir|rota/, ["rotation", "rotate", "spin"]],
  [/trail|ślad|slad|smug|estela|rastro/, ["trail"]],
  [/glow|neon|świec|swiec|blask|brill|resplan/, ["glow"]],
  [/text|title|caption|word|napis|tekst|tytuł|tytul|texto|título|titulo/, ["text"]],
  [/sound|music|instrument|note|piano|marimba|scale|tempo|bpm|beat|melod|dźwię|dzwie|muzy|nuty|skal|rytm|sonid|músic|musica|escala|ritmo/, ["sound", "instrument", "melody", "scale", "note", "tempo", "beat"]],
  [/camera|zoom|shake|follow|kamer|wstrząs|wstrzas|cámara|camara|sacud/, ["camera", "shake", "zoom"]],
  [/theme|look|style|motyw|wygląd|wyglad|styl|tema|estilo|aspecto/, ["theme", "look"]],
  [/face|eye|smile|twarz|oczy|uśmiech|usmiech|cara|ojos|sonris/, ["face"]],
  [/name|label|nazw|imię|imie|etykiet|nombre|etiqueta/, ["name", "label"]],
  [/second|long|short|length|duration|minute|sekund|dług|dlug|krótk|krotk|czas|minut|segund|largo|corto|duraci/, ["length", "seconds"]],
  [/resolution|1080|\b4k\b|720|\bhd\b|rozdziel|resoluci/, ["video size"]],
  [/\bfps\b|frame|klatk|fotogram/, ["frame rate"]],
  [/wind|wiatr|viento/, ["wind"]],
  [/drag|\bair\b|opór|opor|powietrz|aire|resistenc/, ["drag"]],
  [/many|more|fewer|number of|count|ile |ilość|ilosc|więcej|wiecej|mniej|liczb|cantidad|\bmás\b|menos|número|numero/, ["number"]],
  [/break|burst|explo|particle|shatter|confetti|pęk|pek|rozbi|cząst|czast|romp|estall|partícul|particul/, ["break", "burst", "particles"]],
  [/\bmode\b|game|tryb|\bgra\b|modo|juego/, ["game mode"]],
  [/pulse|breath|puls|oddych|respir/, ["pulse"]],
  [/thick|width|grub|szerok|grosor|ancho/, ["thickness"]],
  [/drama|cinemat|director|near miss|film/, ["drama", "director"]],
];

/** Request words too common to point at a setting. */
const STOPWORDS = new Set(["make", "with", "have", "more", "less", "than", "into", "from", "that", "this", "then", "also", "very", "much", "some", "like", "want", "please", "should", "could", "would", "need", "every", "each", "them", "they", "their", "there", "here", "what", "when", "where", "which", "while", "just", "only", "even", "does", "done", "give", "take", "twice", "times", "setting", "settings", "change", "ball", "balls"]);

/** The words of a camelCase key ("ballSpeed" → "ball speed"). */
function keyWords(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/** The request's own words of 4+ letters without the common ones (a plural "s" dropped: "orbs" → "orb"). */
function requestWords(request: string): string[] {
  const words = request.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)).map((w) => (w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)))];
}

/**
 * The settings for this request, in the assistant's order: the core ones, the ones its words or concepts point at and the
 * page mode's own block (--- review fix (desktop-ai-fix) --- whether or not the request names the mode). Past
 * `MAX_RELEVANT_SETTINGS` the block's settings the request does not point at give way first, then the last of the others.
 * An empty request gets the core ones and the mode's block.
 */
export function relevantAssistantSettings(current: SimulatorSettings, request: string): [key: string, description: string][] {
  const all = assistantSettings(current);
  const text = request.toLowerCase();
  const targets = CONCEPTS.filter(([pattern]) => pattern.test(text)).flatMap(([, words]) => words);
  const words = requestWords(request);
  const ownBlock = `${String(current.mode).toLowerCase()} setting`;
  const core: string[] = [];
  const pointed: string[] = [];
  const block: string[] = [];
  for (const [key, description] of all) {
    if (CORE_SETTING_KEYS.includes(key)) {
      core.push(key);
      continue;
    }
    const haystack = `${key.toLowerCase()} ${keyWords(key)} ${description.toLowerCase()}`;
    if (targets.some((t) => haystack.includes(t)) || words.some((w) => haystack.includes(w))) pointed.push(key);
    else if (description.toLowerCase() === ownBlock) block.push(key);
  }
  const kept = new Set([...core, ...pointed, ...block].slice(0, MAX_RELEVANT_SETTINGS));
  return all.filter(([key]) => kept.has(key));
}
