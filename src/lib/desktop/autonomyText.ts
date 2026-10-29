/*
 * --- autonomy --- The word check for posts nobody reads before they go out: "Fully autonomous" (the learner plan's C11,
 * lib/desktop/autonomy.ts) posts a learner proposal on its own only when its words pass here. Anything that fails waits for
 * the person on its card, with the reason ("Waiting for you: the words need a look: a link").
 *
 * What it refuses, in the title and the text of every channel, in English, Polish and Spanish alike (a Spanish bait line in
 * an English caption is still bait):
 *  - a link or a web address, an e-mail address included, and a bare host before a path ("linktr.ee/x", "goo.gl/x");
 *  - an @ name (no other account is named or tagged);
 *  - engagement bait: asking to follow, like, comment, share, send, tag, subscribe, save or turn on notifications, "link in
 *    bio", "let me know", with a few words between the ask and its condition too ("Comment RED if you called it");
 *  - the claims docs/ADS.md section 2 bans: "viral" in any language, guaranteed views, followers, reach or growth, earnings,
 *    "best", "number one", "#1", "ultimate", "unlimited", "official" or "endorsed", PayPal; and odds and sizes no clip holds,
 *    "1 in a million", "a billion" (the number reader stops at a million, so they are claims, not numbers);
 *  - a franchise, fighter or other creator's name: the franchises ADS.md names, plus the names the caller passes (the Fight
 *    League roster's, other creators' handles);
 *  - the same claims, bait and names inside a hashtag, where no word boundary stands between them and the rest of the tag
 *    ("#goviral", "#videoviral", "#bestoftheday", "#followforfollow", "#linkinbio", "#minecraftmemes"): each hashtag's body is
 *    read on its own, without its accents, for the stems in HASHTAG_CLAIMS, HASHTAG_BAIT and HASHTAG_NAMES;
 *  - a number the clip's own facts do not hold (read with the crew's number reader, src/lib/crew/clip.ts numbersIn, which
 *    the caller passes in: digits of any script and number words in the three languages), and a winner the clip does not
 *    have (a sentence that says who won, or who came first, last or alone, got out, survived or beat another, names the
 *    clip's winner and no other contestant or colour: "Red escapes first" claims as much as "Red wins"; a question is no
 *    claim);
 *  - another language than the autopilot's, when the words say so (hashtags, links and names are not read for it);
 *  - YouTube's own rules: a title of 2 to 100 characters without < or >, and a description without < or >.
 *
 * It is a heuristic and errs towards waiting: an unusual word may hold a clip for the person more often than needed.
 *
 * Pure, with no imports: the app's main process bundles it, and the number reader comes in as a function, so the crew's
 * module (which loads the page's recipes) stays out of the main bundle (tests/autonomyText.test.ts reads its imports and
 * bundles it).
 */

// --- autonomy ---

export const TEXT_LANGUAGES = ["en", "pl", "es"] as const;
export type TextLanguage = (typeof TEXT_LANGUAGES)[number];

/** Why words wait for the person. */
export const TEXT_PROBLEM_KEYS = ["link", "mention", "bait", "claim", "name", "number", "winner", "language", "youtubeTitle", "youtubeText"] as const;
export type TextProblemKey = (typeof TEXT_PROBLEM_KEYS)[number];

export interface TextProblem {
  key: TextProblemKey;
  /** The channel whose words it is. */
  channelId: string;
  field: "text" | "title";
  /** What matched (at most 60 characters), for the audit line and the card. */
  match: string;
}

/** What the clip itself says: the numbers its hook may state (the crew's factNumbersOf) and its run's winner and contestants. */
export interface TextFacts {
  numbers: readonly number[];
  /** The winner's name or colour as the clip shows it; null when the run has no winner. */
  winner: string | null;
  /** Every contestant's name or colour the clip shows. */
  contestants: readonly string[];
}

export interface TextGateChannel {
  id: string;
  /** Postiz's provider identifier. */
  platform: string;
  text: string;
  /** YouTube's title, when the channel has one. */
  title?: string | null;
}

export interface TextGateInput {
  channels: readonly TextGateChannel[];
  /** The autopilot's language. */
  language: TextLanguage;
  facts: TextFacts;
  /** Names no post may carry: the Fight League roster's, other creators' (matched as whole words, case as written). */
  names?: readonly string[];
  /** The crew's number reader (src/lib/crew/clip.ts numbersIn). */
  readNumbers: (text: string) => readonly number[];
}

/** YouTube's title bounds (lib/desktop/socialCard.ts YOUTUBE_TITLE_MIN and the platform's 100). */
export const YOUTUBE_TITLE_CHARS = { min: 2, max: 100 } as const;

const LETTER_OR_DIGIT = "\\p{L}\\p{N}_";
/** A pattern as a whole word (Unicode letters, unlike \b), ignoring case. */
const word = (source: string) => new RegExp(`(?<![${LETTER_OR_DIGIT}])(?:${source})(?![${LETTER_OR_DIGIT}])`, "iu");
const words = (sources: readonly string[]) => sources.map(word);

/**
 * Links and web addresses: a scheme, "www.", a host with a common top-level domain or any two-letter one (every country's,
 * so the link shorteners' "linktr.ee", "goo.gl", "is.gd" and "lnkd.in" too), or any host before a path ("name.anything/x").
 */
export const LINK_PATTERNS: readonly RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\//i,
  /(?<![\p{L}\p{N}_])www\./iu,
  new RegExp(`(?<![${LETTER_OR_DIGIT}.])[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)*\\.(?:[a-z]{2}|com|net|org|app|link|xyz|info|biz|site|online|store|shop|live|page|dev|top|club|vip|fun|lol|bio|click|art|blog|social|video|media|news|world|zone|tech|space|website|ink|one|tube)(?![${LETTER_OR_DIGIT}])`, "iu"),
  new RegExp(`(?<![${LETTER_OR_DIGIT}.])[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)*\\.\\p{L}{2,}/`, "iu"),
];

/** An @ name (an e-mail address is a link instead). */
export const MENTION_PATTERN = /(?<![\p{L}\p{N}_.@])@[\p{L}\p{N}_.]{1,30}/u;

/** Up to `n` words between an ask and what it asks, inside one sentence ("Comment RED if", "Drop a 🔴 if", "Zostaw komentarz"). */
const gap = (n: number) => `(?:[^\\s.!?]+\\s+){0,${n}}`;

/** Engagement bait, in the three languages (checked in every text whatever its language). */
export const BAIT_PATTERNS: Readonly<Record<TextLanguage, readonly RegExp[]>> = {
  en: words([
    "follow (?:me|us|for(?: more)?|to see|along|this account|the account)",
    "like (?:and|&) (?:share|follow|subscribe|comment)",
    "like (?:this|if|for)",
    `comments? ${gap(4)}(?:below|down below|your|if|with|which|who|what)`,
    "in the comments",
    "drop a (?:comment|like)",
    `drop (?:an? |your )${gap(1)}(?:if|below|in the comments)`,
    "leave (?:a|your) (?:comment|like|heart)",
    "send (?:this|it) to (?:a |an |your |that |every )?(?:\\p{L}+ )?(?:friends?|someone|somebody|bestie|buddy|mate|person|people)",
    "send to (?:a|your) friends?",
    "let (?:me|us) know",
    "tell (?:me|us) (?:below|in the comments|which|who|what|if)",
    "tag (?:a |your |\\d+ |two |three )?(?:friends?|buddy|someone|bestie)",
    "share (?:this|it) with",
    "share with (?:a|your) friends?",
    "link in (?:my |the )?bio",
    "subscribe",
    "turn on (?:post )?notifications",
    "save (?:this|it) for later",
    "smash (?:that|the) like",
    "double tap",
  ]),
  pl: words([
    "obserwuj\\p{L}*",
    "zaobserwuj\\p{L}*",
    "polub\\p{L}*",
    "udostępnij\\p{L}*",
    "oznacz (?:znajom\\p{L}*|kogoś|przyjaci\\p{L}*)",
    "skomentuj\\p{L}*",
    "napisz w komentarz\\p{L}*",
    `napisz\\p{L}* ${gap(2)}(?:komentarz\\p{L}*|pod spodem|niżej|poniżej)`,
    "w komentarzach",
    "w komentarzu",
    `zostaw\\p{L}* ${gap(2)}(?:komentarz\\p{L}*|serduszk\\p{L}*|serce|lajk\\p{L}*|like|łapk\\p{L}*)`,
    "daj\\p{L}* znać",
    "daj\\p{L}* (?:lajk\\p{L}*|serduszk\\p{L}*|suba|łapk\\p{L}*)",
    `(?:wyślij|prześlij)\\p{L}* ${gap(2)}(?:znajom\\p{L}*|komuś|przyjaci\\p{L}*|kumpl\\p{L}*)`,
    "link w bio",
    "(?:za)?subskrybuj\\p{L}*",
    "zapisz (?:ten|to|na później)",
    "włącz powiadomienia",
  ]),
  es: words([
    "s[íi]gue(?:me|nos)",
    "sigue (?:para|la cuenta)",
    "dale (?:a )?(?:like|me gusta)",
    "compart(?:e|elo|ela|an|id)",
    "etiqueta a",
    "menciona a",
    "coment(?:a|ad|alo|en)",
    "déjalo en los comentarios",
    "en los comentarios",
    "en (?:el |un |tu )?comentarios?",
    `d[ée]ja(?:me|nos)? ${gap(2)}(?:comentario|like|me gusta|coraz[oó]n)\\p{L}*`,
    "(?:d[ée]ja(?:me|nos)|h[áa]z(?:me|nos)) saber",
    "d(?:ime|inos) (?:en|abajo|si|qu[ée]|qui[ée]n|cu[áa]l|c[óo]mo)",
    "cu[ée]nta(?:me|nos)",
    `(?:env[íi]a|m[áa]nda)(?:lo|la|selo|sela|le)? ${gap(2)}a (?:un|una|tu|tus) amig\\p{L}*`,
    "(?:link|enlace) en (?:la |mi )?bio",
    "suscr[íi]be(?:te|nos)",
    "guarda (?:esto|este|el video|el vídeo)",
    "activa (?:las )?notificaciones",
  ]),
};

/** The claims docs/ADS.md section 2 bans, in the three languages. */
export const CLAIM_PATTERNS: Readonly<Record<TextLanguage, readonly RegExp[]>> = {
  en: [
    ...words([
      "(?:go|goes|gone|going|went) viral",
      "viral\\p{L}*",
      "guarantee\\p{L}*",
      "(?:more|get|gain|grow|boost|free|\\d+k?) (?:views|followers|likes|subscribers|reach)",
      "grow (?:your|the) (?:account|channel|following|audience|page)",
      "blow up",
      "(?:earn|make|making|made) (?:money|cash|bank)",
      "get paid",
      "income",
      "creator rewards?",
      "moneti[sz]\\p{L}*",
      "payouts?",
      "side hustle",
      "best",
      "number one",
      "no\\.? ?1",
      "ultimate",
      "unlimited",
      "official\\p{L}*",
      "endorsed",
      "approved by",
      "sponsored by",
      "paypal",
      "(?:one|1) in (?:an? |one )?(?:hundred|thousand|million|billion|trillion|zillion|gazillion)",
      "(?:b|tr|quadr|z|gaz|baj)illions?",
    ]),
    /#1(?!\d)/,
  ],
  pl: words([
    "wiral\\p{L}*",
    "gwarant\\p{L}*",
    "(?:więcej|zdobądź|zyskaj|darmowe) (?:wyświetle\\p{L}*|obserwując\\p{L}*|polubie\\p{L}*|subskrybent\\p{L}*|zasięg\\p{L}*)",
    "zarab\\p{L}*",
    "zarobi\\p{L}*",
    "zarob(?:ek|ki|ku)",
    "monetyz\\p{L}*",
    "dochod\\p{L}*",
    "dochód",
    "wypłat\\p{L}*",
    "najlepsz\\p{L}*",
    "numer jeden",
    "nr ?1",
    "nieograniczon\\p{L}*",
    "bez limitu",
    "oficjaln\\p{L}*",
    "zatwierdzon\\p{L}* przez",
    "rekomendowan\\p{L}*",
    "popieran\\p{L}*",
    "(?:jeden|jedna|jedno|raz|1) na (?:sto|tysiąc|milion|miliard|bilion)",
    "miliard\\p{L}*",
    "bilion\\p{L}*",
    "trylion\\p{L}*",
  ]),
  es: words([
    "viraliz\\p{L}*",
    "garantiz\\p{L}*",
    "garant[íi]a\\p{L}*",
    "(?:más|gana|ganar|consigue|conseguir|gratis) (?:vistas|visitas|reproducciones|seguidores|likes|me gusta|suscriptores|alcance)",
    "(?:ganar|gana|generar) dinero",
    "ingresos?",
    "monetiz\\p{L}*",
    "cobrar",
    "mejor(?:es)?",
    "n[úu]mero uno",
    "ilimitad\\p{L}*",
    "sin l[íi]mites?",
    "oficial\\p{L}*",
    "respaldad\\p{L}*",
    "avalad\\p{L}*",
    "patrocinad\\p{L}*",
    "(?:un[oa]?|1) (?:en|entre) (?:un |cien |mil )?(?:cien|mil|mill[oó]n|millones|bill[oó]n)",
    "mil millones",
    "bill[oó]n\\p{L}*",
    "trill[oó]n\\p{L}*",
  ]),
};

/** The franchises docs/ADS.md section 2 names (any case), and the Fight League itself. "DC" is matched in capitals only. */
export const FRANCHISE_PATTERNS: readonly RegExp[] = [...words(["marvel", "nintendo", "pok[ée]mon", "star wars", "fight league", "thor", "loki", "disney", "pixar", "minecraft", "fortnite", "roblox"]), /(?<![\p{L}\p{N}_])DC(?![\p{L}\p{N}_])/u];

/* ------------------------------------------------------------------ inside hashtags */

/*
 * A hashtag runs its words together, so the whole-word patterns above miss a stem inside one ("#goviral", "#bestoftheday",
 * "#followforfollow"). Each hashtag's body is read on its own: lower case, its accents dropped ("#Síguenos" reads "siguenos",
 * "#Pokémon" "pokemon"), for these stems anywhere in it (a "^" anchors one to the start of the tag, a "$" to its end). A tag
 * held by mistake only waits for the person, which is the safe side.
 */
const tagStems = (sources: readonly string[]) => sources.map((s) => new RegExp(s, "u"));

/** The banned claims inside a hashtag, in the three languages. */
export const HASHTAG_CLAIMS: readonly RegExp[] = tagStems([
  "viral", "wiral", "best", "najlepsz", "mejor", "numberone", "numerjeden", "numerouno", "official", "oficjal", "oficial", "endorsed",
  "sponsored", "patrocinad", "guarantee", "gwarant", "garanti", "money", "zarab", "zarob", "dinero", "income", "dochod", "ingreso",
  "moneti", "monetyz", "payout", "paypal", "sidehustle", "ultimate", "unlimited", "nieograniczon", "ilimitad",
  "(?:free|more|get|gain|grow|boost)(?:views|followers|likes|subs|subscribers|reach)", "blowup",
]);

/** Engagement bait inside a hashtag, in the three languages. */
export const HASHTAG_BAIT: readonly RegExp[] = tagStems([
  "follow", "obserwuj", "sigueme", "siguenos", "seguidores", "like4like", "likeforlike", "likeback", "l4l", "f4f", "s4s", "^likes?$",
  "polub", "dalelike", "megusta", "^comments?$", "commentbelow", "koment", "comenta",
  "(?:link|enlace)(?:in|en|w)(?:my|the|la|mi)?bio", "tag(?:a|ur|your)?(?:friends?|buddy|bestie|bff|mates?|someone)", "oznacz", "etiqueta",
  "subscri", "subskryb", "suscri", "share(?:this|it|with)", "udostepnij", "comparte", "doubletap", "smash(?:that|the)?like",
  "notification", "powiadomien", "notificacion",
]);

/** The franchises inside a hashtag (the short names only at its start: "#thor", "#lokifans"). */
export const HASHTAG_NAMES: readonly RegExp[] = tagStems(["marvel", "nintendo", "pokemon", "starwars", "fightleague", "disney", "pixar", "minecraft", "fortnite", "roblox", "^thor", "^loki"]);

/** The hashtags of a text, as written. */
export function hashtagsOf(text: string): string[] {
  return [...text.matchAll(/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu)].map((m) => m[0]);
}

/** A hashtag's body as the stems read it: no "#", lower case, no accents. */
const tagBody = (tag: string) => tag.slice(1).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The first hashtag of a text whose body holds one of the stems, or null. */
function tagMatch(text: string, stems: readonly RegExp[]): string | null {
  for (const tag of hashtagsOf(text)) {
    const body = tagBody(tag);
    if (stems.some((s) => s.test(body))) return tag;
  }
  return null;
}

/* ------------------------------------------------------------------ who won */

/** Words that say someone won (a question is no claim). */
export const WIN_PATTERNS: readonly RegExp[] = words([
  "wins?",
  "won",
  "winners?",
  "winning",
  "victor(?:y|ious)?",
  "champions?",
  "wygr\\p{L}*",
  "zwyci\\p{L}*",
  "mistrz\\p{L}*",
  "gan(?:a|an|ó|aron|ará|ador\\p{L}*)",
  "victoria",
  "vencedor\\p{L}*",
  "campe[oó]n\\p{L}*",
]);

/**
 * Words that say who came first, last or alone, who got out, survived or beat another, in the three languages: with a name or
 * a colour in the same sentence they claim a result as much as a win word ("Red escapes first", "Only Red survives", "Red
 * beats Blue", "Czerwona ucieka pierwsza", "La roja escapa primero"). A sentence about a red ring that breaks first is read as
 * a claim too, and waits for the person: the safe side.
 */
export const PLACE_PATTERNS: readonly RegExp[] = words([
  "first",
  "1st",
  "last",
  "only",
  "alone",
  "escap\\p{L}*",
  "surviv\\p{L}*",
  "beats?",
  "beaten",
  "beating",
  "defeat\\p{L}*",
  "outlast\\p{L}*",
  "outr[au]n\\p{L}*",
  "finish(?:es|ed|ing)?",
  "(?:makes?|made|making) it (?:out|through)",
  "(?:gets?|got|getting) out",
  "(?:breaks?|broke|breaking) (?:out|free|through)",
  "pierwsz\\p{L}*",
  "ostatni\\p{L}*",
  "jedyn\\p{L}*",
  "tylko",
  "uciek\\p{L}*",
  "ucieczk\\p{L}*",
  "przetrw\\p{L}*",
  "pokon\\p{L}*",
  "wydost\\p{L}*",
  "primer\\p{L}*",
  "[úu]ltim[oa]s?",
  "s[óo]l[oa]",
  "solamente",
  "[úu]nic[oa]",
  "sobreviv\\p{L}*",
  "venc[eií]\\p{L}*",
  "derrot\\p{L}*",
]);

/** Every word that makes a sentence a claim of who won, or of a place: a win word or a place word. */
const RESULT_PATTERNS: readonly RegExp[] = [...WIN_PATTERNS, ...PLACE_PATTERNS];

/** The colours a contestant may go by, each in the three languages (one class per colour, so "Red" and "czerwona" agree). */
export const COLOUR_CLASSES: Readonly<Record<string, RegExp>> = {
  red: word("red|czerwon\\p{L}*|roj[oa]s?"),
  blue: word("blue|niebiesk\\p{L}*|azul(?:es)?"),
  green: word("green|zielon\\p{L}*|verdes?"),
  yellow: word("yellow|żółt\\p{L}*|amarill[oa]s?"),
  orange: word("orange|pomarańczow\\p{L}*|naranjas?"),
  purple: word("purple|violet|fioletow\\p{L}*|morad[oa]s?|violeta"),
  pink: word("pink|różow\\p{L}*|rosas?"),
  white: word("white|biał\\p{L}*|blanc[oa]s?"),
  black: word("black|czarn\\p{L}*|negr[oa]s?"),
  gold: word("gold|golden|złot\\p{L}*|dorad[oa]s?|oro"),
  silver: word("silver|srebrn\\p{L}*|platead[oa]s?|plata"),
  grey: word("gr[ae]y|szar\\p{L}*|gris(?:es)?"),
  cyan: word("cyan|cyjan\\p{L}*|cian"),
};

/** Words that tell the three languages apart (none shared between two of them). */
const LANGUAGE_WORDS: Readonly<Record<TextLanguage, ReadonlySet<string>>> = {
  en: new Set(["the", "and", "is", "are", "this", "that", "which", "who", "will", "of", "with", "for", "every", "until", "watch", "can", "how", "what", "its", "it's", "ball", "balls", "wins", "gets", "into", "from", "then", "than", "last", "first", "each", "only", "one", "two", "three", "out", "escape", "escapes", "before"]),
  pl: new Set(["czy", "się", "nie", "jak", "ile", "kto", "jest", "są", "ze", "tylko", "już", "przez", "aż", "gdzie", "kiedy", "gdy", "co", "czym", "dlaczego", "albo", "oraz", "aby", "zanim", "jeszcze", "teraz", "bardzo", "który", "która", "które", "każdy", "każda", "każde", "wszystkie", "wszystko", "kulka", "kulki", "kulek", "klip", "dla", "wygrywa", "ucieka", "pierwsza", "ostatnia"]),
  es: new Set(["el", "la", "los", "las", "del", "que", "en", "por", "con", "se", "es", "son", "hasta", "sin", "cuántas", "cuántos", "quién", "qué", "cuál", "gana", "bola", "bolas", "una", "uno", "cada", "todas", "todos", "pero", "más", "como", "para", "este", "esta", "escapa", "primera", "última"]),
};
const LANGUAGE_LETTERS: Readonly<Record<TextLanguage, RegExp | null>> = { en: null, pl: /[ąćęłńśźż]/iu, es: /[ñ¿¡áéíú]/iu };

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);
const firstMatch = (text: string, patterns: readonly RegExp[]): string | null => {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[0];
  }
  return null;
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MENTIONS = new RegExp(MENTION_PATTERN.source, "gu");

/** The text without its hashtags, links and @ names: what the language and the claims of who won are read from. */
function plainWords(text: string): string {
  return text
    .replace(/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu, " ")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ")
    .replace(MENTIONS, " ");
}

/** The first link or web address in a text, or null. */
export function linkIn(text: string): string | null {
  return firstMatch(text, LINK_PATTERNS);
}

/** The first @ name in a text, or null. */
export function mentionIn(text: string): string | null {
  return MENTION_PATTERN.exec(text)?.[0] ?? null;
}

/** The first engagement bait in a text (any of the three languages), or null; inside a hashtag too ("#followforfollow"). */
export function baitIn(text: string): string | null {
  return firstMatch(text, TEXT_LANGUAGES.flatMap((l) => BAIT_PATTERNS[l])) ?? tagMatch(text, HASHTAG_BAIT);
}

/** The first banned claim in a text (any of the three languages), or null; inside a hashtag too ("#goviral", "#bestoftheday"). */
export function claimIn(text: string): string | null {
  return firstMatch(text, TEXT_LANGUAGES.flatMap((l) => CLAIM_PATTERNS[l])) ?? tagMatch(text, HASHTAG_CLAIMS);
}

/** The shortest name `names` reads inside a hashtag: a shorter one only as the whole tag. */
const NAME_IN_TAG_MIN = 4;

/**
 * The first franchise, fighter or creator's name in a text, or null. `names` match as whole words, case as written; inside a
 * hashtag any case, without spaces or accents ("#minecraftmemes", "#captainfalconfans"), a name under 4 letters only as the
 * whole tag.
 */
export function nameIn(text: string, names: readonly string[] = []): string | null {
  const kept = names.map((n) => n.trim()).filter((n) => n.length >= 2 && n.length <= 80);
  const own = kept.map((n) => new RegExp(`(?<![${LETTER_OR_DIGIT}@])${escapeRe(n)}(?![${LETTER_OR_DIGIT}])`, "u"));
  const found = firstMatch(text, [...FRANCHISE_PATTERNS, ...own]);
  if (found) return found;
  const inTags = kept
    .map((n) => tagBody(`#${n}`).replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((n) => n.length >= 2)
    .map((n) => new RegExp(n.length >= NAME_IN_TAG_MIN ? escapeRe(n) : `^${escapeRe(n)}$`, "u"));
  return tagMatch(text, [...HASHTAG_NAMES, ...inTags]) ?? hashtagsOf(text).find((t) => /^#DC/u.test(t)) ?? null;
}

/** The numbers a text states that the clip's facts do not hold (each once, in the text's order). */
export function numbersNotInFacts(text: string, facts: Pick<TextFacts, "numbers">, readNumbers: (text: string) => readonly number[]): number[] {
  const known = facts.numbers.filter((n) => Number.isFinite(n));
  const out: number[] = [];
  for (const n of readNumbers(text)) if (!known.some((k) => Math.abs(k - n) < 1e-6) && !out.includes(n)) out.push(n);
  return out;
}

/** Pronouns a sentence may start with ("It escapes first", "Ona ucieka pierwsza"): no one's name. */
const PRONOUNS: ReadonlySet<string> = new Set(["it", "he", "she", "they", "we", "you", "i", "on", "ona", "ono", "oni", "one", "ella", "ellas", "él", "ellos", "eso", "esto"]);

/**
 * The entities a sentence names: the clip's contestants by name, colours by class, and any other capitalised word that is not
 * a common word of the three languages, a pronoun, a win or place word or part of a contestant's name (so "Gerald wins" and
 * "Gerald escapes first" name someone). The sentence's first word counts only right before a win or place word: "Finally Red
 * wins" names Red, not "Finally".
 */
function entitiesIn(sentence: string, contestants: readonly string[]): string[] {
  const out = new Set<string>();
  const nameWords = new Set<string>();
  for (const name of contestants) {
    const n = name.trim();
    if (!n) continue;
    for (const w of n.toLowerCase().split(/\s+/)) nameWords.add(w);
    const colour = colourOf(n);
    if (colour) continue; // a colour contestant is found by its class below
    if (new RegExp(`(?<![${LETTER_OR_DIGIT}])${escapeRe(n)}(?![${LETTER_OR_DIGIT}])`, "iu").test(sentence)) out.add(`name:${n.toLowerCase()}`);
  }
  for (const [colour, re] of Object.entries(COLOUR_CLASSES)) if (re.test(sentence)) out.add(`colour:${colour}`);
  const firstAt = sentence.search(/\p{L}/u);
  for (const m of sentence.matchAll(/(?<![\p{L}\p{N}_])\p{Lu}[\p{L}'-]+/gu)) {
    const w = m[0].toLowerCase();
    if (nameWords.has(w) || PRONOUNS.has(w) || TEXT_LANGUAGES.some((l) => LANGUAGE_WORDS[l].has(w)) || RESULT_PATTERNS.some((p) => p.test(m[0])) || Object.values(COLOUR_CLASSES).some((p) => p.test(m[0]))) continue;
    if (m.index === firstAt) {
      // right before a win or place word, a phrase one ("Gerald makes it out first") included
      const rest = /^\s+(.*)$/su.exec(sentence.slice(firstAt + m[0].length));
      if (!rest || !RESULT_PATTERNS.some((p) => p.exec(rest[1])?.index === 0)) continue;
    }
    out.add(`name:${w}`);
  }
  return [...out];
}

/** The colour class of a name ("Red", "czerwona", "Rojo"), or null. */
function colourOf(name: string): string | null {
  for (const [colour, re] of Object.entries(COLOUR_CLASSES)) if (re.test(name) && name.trim().split(/\s+/).length <= 2) return colour;
  return null;
}

/** The entity a winner is: its colour class, or its name. */
function entityOfWinner(winner: string): string {
  const colour = colourOf(winner);
  return colour ? `colour:${colour}` : `name:${winner.trim().toLowerCase()}`;
}

/**
 * The first sentence that says who won, or who came first, last or alone, got out, survived or beat another, and names
 * someone the clip did not have win (or names anyone when the run has no winner), or null. A question ("Who wins?",
 * "¿Quién gana?", "Which ball escapes first?") claims nothing.
 */
export function wrongWinnerIn(text: string, facts: Pick<TextFacts, "winner" | "contestants">): string | null {
  const plain = plainWords(text);
  const winner = facts.winner?.trim() ? entityOfWinner(facts.winner) : null;
  for (const m of plain.matchAll(/([^.!?\n]*)([.!?\n]+|$)/g)) {
    const sentence = m[1];
    if (!sentence.trim()) continue;
    if (m[2].includes("?") || sentence.includes("¿")) continue;
    if (!RESULT_PATTERNS.some((p) => p.test(sentence))) continue;
    const named = entitiesIn(sentence, [...facts.contestants, ...(facts.winner ? [facts.winner] : [])]);
    if (named.some((e) => e !== winner)) return short(sentence.trim());
  }
  return null;
}

/** How strongly a text reads as each language: its distinguishing words, and 2 for each language's own letters. */
export function languageScores(text: string): Record<TextLanguage, number> {
  const plain = plainWords(text).normalize("NFC");
  const tokens = [...plain.toLocaleLowerCase("en").matchAll(/[\p{L}']+/gu)].map((m) => m[0]);
  const out = { en: 0, pl: 0, es: 0 } as Record<TextLanguage, number>;
  for (const l of TEXT_LANGUAGES) {
    out[l] = tokens.filter((t) => LANGUAGE_WORDS[l].has(t)).length;
    const letters = LANGUAGE_LETTERS[l];
    if (letters && letters.test(plain)) out[l] += 2;
  }
  return out;
}

/** The language a text reads as instead of `expected` (null: it reads as `expected`, or as nothing in particular). */
export function otherLanguageOf(text: string, expected: TextLanguage): TextLanguage | null {
  const s = languageScores(text);
  let best: TextLanguage | null = null;
  for (const l of TEXT_LANGUAGES) if (l !== expected && s[l] >= 2 && s[l] > s[expected] && (best === null || s[l] > s[best])) best = l;
  return best;
}

/** Every reason the words of a post wait for the person (empty: they may go out unread). */
export function textProblems(input: TextGateInput): TextProblem[] {
  const out: TextProblem[] = [];
  for (const c of input.channels) {
    const fields: { field: "text" | "title"; value: string }[] = [{ field: "text", value: c.text ?? "" }];
    if (c.platform === "youtube" || (typeof c.title === "string" && c.title.trim())) fields.push({ field: "title", value: c.title ?? "" });
    for (const { field, value } of fields) {
      const add = (key: TextProblemKey, match: string) => out.push({ key, channelId: c.id, field, match: short(match) });
      const link = linkIn(value);
      if (link) add("link", link);
      const mention = mentionIn(value);
      if (mention) add("mention", mention);
      const bait = baitIn(value);
      if (bait) add("bait", bait);
      const claim = claimIn(value);
      if (claim) add("claim", claim);
      const name = nameIn(value, input.names);
      if (name) add("name", name);
      const numbers = numbersNotInFacts(value, input.facts, input.readNumbers);
      if (numbers.length) add("number", numbers.join(", "));
      const winner = wrongWinnerIn(value, input.facts);
      if (winner) add("winner", winner);
      const other = otherLanguageOf(value, input.language);
      if (other) add("language", other);
      if (c.platform === "youtube") {
        if (field === "title") {
          const t = value.trim();
          if (t.length < YOUTUBE_TITLE_CHARS.min || [...t].length > YOUTUBE_TITLE_CHARS.max || /[<>]/.test(t)) add("youtubeTitle", t);
        } else if (/[<>]/.test(value)) add("youtubeText", "<>");
      }
    }
  }
  return out;
}

/** Whether the words may go out unread. */
export function textPasses(input: TextGateInput): boolean {
  return textProblems(input).length === 0;
}

// --- end autonomy ---
