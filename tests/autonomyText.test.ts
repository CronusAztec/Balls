import { describe, expect, it } from "vitest";
import { numbersIn } from "@/lib/crew/clip";
import { FL_ROSTER } from "@/lib/physics/modes/fightLeagueRoster";
import { TEXT_PROBLEM_KEYS, YOUTUBE_TITLE_CHARS, languageScores, otherLanguageOf, textPasses, textProblems, type TextFacts, type TextGateChannel, type TextLanguage, type TextProblemKey } from "@/lib/desktop/autonomyText";
import { importsOf, mainBundleInputs } from "./mainBundle";

/*
 * --- autonomy --- The word check for posts nobody reads before they go out (lib/desktop/autonomyText.ts): a fixture of bad
 * captions and titles in English, Polish and Spanish, each waiting with its reason, and a fixture of good ones that pass.
 * The numbers are read with the crew's own reader (src/lib/crew/clip.ts numbersIn), as the main process will pass it.
 */

// --- autonomy ---

const FACTS: TextFacts = { numbers: [1, 15, 20], winner: "Red", contestants: ["Red", "Blue"] };
const NAMES = FL_ROSTER.map((f) => f.name);

const ig = (text: string): TextGateChannel => ({ id: "ig-1", platform: "instagram", text });
const yt = (title: string, text = "Watch the end"): TextGateChannel => ({ id: "yt-1", platform: "youtube", text, title });
const check = (channel: TextGateChannel, language: TextLanguage = "en", facts: TextFacts = FACTS) => textProblems({ channels: [channel], language, facts, names: NAMES, readNumbers: numbersIn });
const keysOf = (channel: TextGateChannel, language?: TextLanguage, facts?: TextFacts) => [...new Set(check(channel, language, facts).map((p) => p.key))];

describe("the text gate: words nobody reads", () => {
  it("passes good captions and titles in the three languages", () => {
    const good: [TextGateChannel, TextLanguage][] = [
      [ig("Red escapes first. Watch until the end 🔊 #satisfying #physics"), "en"],
      [ig("20 rings and 1 ball. Who breaks out? #satisfying #oddlysatisfying"), "en"],
      [ig("Red wins the race. #physics"), "en"],
      [ig("Which one escapes first? 🔊"), "en"],
      [ig("Czerwona kulka wygrywa wyścig. #satisfying"), "pl"],
      [ig("20 pierścieni i jedna kulka. Czy ucieknie? #satisfying"), "pl"],
      [ig("Kto wygra? Czerwona czy niebieska?"), "pl"],
      [ig("¿Qué bola gana? 20 anillos y una bola. #satisfying"), "es"],
      [yt("Which ball escapes first?", "20 rings, 1 ball. #shorts"), "en"],
      [yt("Która kulka ucieknie pierwsza?", "Czy ucieknie przed końcem?"), "pl"],
    ];
    for (const [channel, language] of good) expect(check(channel, language), `${channel.title ?? ""} ${channel.text}`).toEqual([]);
    expect(textPasses({ channels: good.slice(0, 4).map(([c]) => c), language: "en", facts: FACTS, readNumbers: numbersIn })).toBe(true);
  });

  it("refuses links and web addresses", () => {
    for (const text of ["Full video at jumpingballslive.com", "https://example.org/clip", "Try it: www.balls.pl", "write to hi@balls.com", "more on youtu.be/abc"]) expect(keysOf(ig(text)), text).toContain("link");
  });

  it("refuses a bare host before a path, and the link shorteners' domains", () => {
    for (const text of ["More on linktr.ee/jumpingballs", "Try it: goo.gl/abc123", "Clip: is.gd/x1", "lnkd.in/abc", "see balls.anything/clip", "linktr.ee", "goo.gl"]) expect(keysOf(ig(text)), text).toContain("link");
    // a decimal, a ratio, an abbreviation and an ellipsis are no address
    for (const text of ["1.5x faster, 20 rings", "1/20 escapes", "Red, i.e. the first one.", "Wait for it... Red!"]) expect(keysOf(ig(text)), text).not.toContain("link");
  });

  it("refuses @ names", () => {
    expect(keysOf(ig("Made with @someone"))).toContain("mention");
    expect(keysOf(ig("@ballfan look at this"))).toContain("mention");
  });

  it("refuses engagement bait in every language", () => {
    const bait: [string, TextLanguage][] = [
      ["Follow for more balls!", "en"],
      ["Tag a friend who needs this", "en"],
      ["Comment your guess below", "en"],
      ["Link in bio", "en"],
      ["Like and share if Red escapes", "en"],
      ["Obserwuj po więcej kulek!", "pl"],
      ["Oznacz znajomego, który to musi zobaczyć", "pl"],
      ["Napisz w komentarzu, która kulka ucieknie", "pl"],
      ["Síguenos para más bolas", "es"],
      ["Comenta qué bola gana", "es"],
      ["Dale like si te gusta", "es"],
    ];
    for (const [text, language] of bait) expect(keysOf(ig(text), language), text).toContain("bait");
  });

  it("refuses bait with a few words between the ask and its condition, and the asks to send, leave or let know", () => {
    const bait: [string, TextLanguage][] = [
      ["Comment RED if you called it 🔴", "en"],
      ["Comment the colour you picked below", "en"],
      ["Drop a 🔴 if you think Red escapes first", "en"],
      ["Drop your guess below", "en"],
      ["Send this to a friend who needs it", "en"],
      ["Send it to your best friend", "en"],
      ["Leave a comment with your pick", "en"],
      ["Let me know who wins", "en"],
      ["Daj znać w komentarzu, czy Red ucieknie", "pl"],
      ["Zostaw komentarz, jeśli zgadłeś", "pl"],
      ["Dajcie znać, która ucieknie", "pl"],
      ["Wyślij to znajomemu", "pl"],
      ["Napisz poniżej, która wygra", "pl"],
      ["Deja tu comentario si acertaste", "es"],
      ["Déjame saber quién gana", "es"],
      ["Dime qué bola gana", "es"],
      ["Envía esto a un amigo", "es"],
      ["Escríbelo en un comentario", "es"],
    ];
    for (const [text, language] of bait) expect(keysOf(ig(text), language), text).toContain("bait");
    // the same verbs in a plain sentence are no ask
    const plain: [string, TextLanguage][] = [
      ["Balls drop if the floor opens", "en"],
      ["The paddle sends it flying to the top", "en"],
      ["Watch the balls drop one by one.", "en"],
      ["Kulki spadają, gdy podłoga się otwiera.", "pl"],
      ["La bola cae cuando el suelo se abre.", "es"],
    ];
    for (const [text, language] of plain) expect(keysOf(ig(text), language), text).not.toContain("bait");
  });

  it("refuses the claims docs/ADS.md bans: viral in any language, growth, earnings, best, number one, official", () => {
    const claims: [string, TextLanguage][] = [
      ["This will go viral", "en"],
      ["Viral ball race", "en"],
      ["Ten klip jest wiralowy", "pl"],
      ["Esto se va a hacer viral", "es"],
      ["Se va a viralizar", "es"],
      ["Guaranteed views every time", "en"],
      ["Get followers with this trick", "en"],
      ["Earn money with ball videos", "en"],
      ["Zarabiaj na kulkach", "pl"],
      ["Gana dinero con bolas", "es"],
      ["The best ball race", "en"],
      ["#1 ball race", "en"],
      ["Number one simulator", "en"],
      ["Najlepsza kulka w historii", "pl"],
      ["La mejor carrera de bolas", "es"],
      ["Official ball race", "en"],
      ["Oficjalny wyścig kulek", "pl"],
    ];
    for (const [text, language] of claims) expect(keysOf(ig(text), language), text).toContain("claim");
  });

  it("refuses odds and sizes no clip holds, which the number reader does not read", () => {
    const claims: [string, TextLanguage][] = [
      ["1 in a billion shot", "en"],
      ["One in a million escape", "en"],
      ["A billion bounces", "en"],
      ["Trillions of balls", "en"],
      ["Jeden na milion", "pl"],
      ["Miliard odbić", "pl"],
      ["Uno en un millón", "es"],
      ["Mil millones de rebotes", "es"],
      ["Un billón de bolas", "es"],
    ];
    for (const [text, language] of claims) expect(keysOf(ig(text), language), text).toContain("claim");
    // a count the clip holds is no claim
    expect(keysOf(ig("20 rings and one ball"))).not.toContain("claim");
  });

  it("refuses franchise, fighter and other creators' names", () => {
    expect(keysOf(ig("Thor vs Loki"))).toContain("name");
    expect(keysOf(ig("A Pokémon style race"))).toContain("name");
    expect(keysOf(ig("Made for DC fans"))).toContain("name");
    const fighter = NAMES.find((n) => n.length >= 4 && /^[A-Z][a-z]+$/.test(n) && !["Thor", "Loki"].includes(n))!;
    expect(keysOf(ig(`${fighter} is back`)), fighter).toContain("name");
    const creator = textProblems({ channels: [ig("Inspired by MrBallz")], language: "en", facts: FACTS, names: ["MrBallz"], readNumbers: numbersIn });
    expect(creator.map((p) => p.key)).toContain("name");
    // a lowercase word is not the capitalised acronym
    expect(keysOf(ig("Red escapes. dc"))).not.toContain("name");
  });

  it("reads the banned claims, bait and franchise names inside a hashtag, in the three languages", () => {
    const noWinner: TextFacts = { numbers: [1, 20], winner: null, contestants: [] };
    const held: [string, TextLanguage, TextProblemKey][] = [
      ["Which ball escapes first? #satisfying #goviral", "en", "claim"],
      ["Which ball escapes first? #satisfying #reelsviral", "en", "claim"],
      ["Which ball escapes first? #satisfying #instaviral", "en", "claim"],
      ["Which ball escapes first? #satisfying #fypviral", "en", "claim"],
      ["Which ball escapes first? #satisfying #bestoftheday", "en", "claim"],
      ["Which ball escapes first? #satisfying #bestreels", "en", "claim"],
      ["Która kulka ucieknie pierwsza? #satysfakcja #polskiewirale", "pl", "claim"],
      ["Która kulka ucieknie pierwsza? #najlepszefilmiki", "pl", "claim"],
      ["¿Qué bola escapa primero? #satisfactorio #videoviral", "es", "claim"],
      ["¿Qué bola escapa primero? #losmejoresvideos", "es", "claim"],
      ["Which ball escapes first? #satisfying #followforfollow", "en", "bait"],
      ["Which ball escapes first? #satisfying #likeforlike", "en", "bait"],
      ["Which ball escapes first? #satisfying #followme", "en", "bait"],
      ["Which ball escapes first? #satisfying #linkinbio", "en", "bait"],
      ["Which ball escapes first? #satisfying #tagafriend", "en", "bait"],
      ["Która kulka ucieknie pierwsza? #obserwujmnie", "pl", "bait"],
      ["Która kulka ucieknie pierwsza? #linkwbio", "pl", "bait"],
      ["¿Qué bola escapa primero? #Sígueme", "es", "bait"],
      ["¿Qué bola escapa primero? #enlaceenbio", "es", "bait"],
      ["Which ball escapes first? #satisfying #minecraftmemes", "en", "name"],
      ["Which ball escapes first? #satisfying #pokemongo", "en", "name"],
      ["Which ball escapes first? #PokémonGO", "en", "name"],
      ["¿Qué bola escapa primero? #fortniteclips", "es", "name"],
      ["Która kulka ucieknie pierwsza? #DCfani", "pl", "name"],
    ];
    for (const [text, language, key] of held) expect(keysOf(ig(text), language, noWinner), text).toContain(key);
    expect(check(ig("Which ball escapes first? #satisfying #goviral"), "en", noWinner).find((p) => p.key === "claim")?.match).toBe("#goviral");
    // a fighter's name run together with other words, and another creator's
    const fighter = NAMES.find((n) => n.length >= 4 && /^[A-Z][a-z]+$/.test(n) && !["Thor", "Loki"].includes(n))!;
    expect(keysOf(ig(`Which ball escapes first? #${fighter.toLowerCase()}fans`), "en", noWinner), fighter).toContain("name");
    expect(textProblems({ channels: [ig("Which ball escapes first? #mrballzfan")], language: "en", facts: noWinner, names: ["MrBallz"], readNumbers: numbersIn }).map((p) => p.key)).toContain("name");
    // the everyday hashtags pass in each language
    const everyday: [string, TextLanguage][] = [
      ["Which ball escapes first? #satisfying #oddlysatisfying #physics #asmr #simulation #marblerace #fyp #foryou #reels #explore #trending #shorts", "en"],
      ["Która kulka ucieknie pierwsza? #satysfakcja #fizyka #symulacja #kulki", "pl"],
      ["¿Qué bola escapa primero? #satisfactorio #física #simulación #bolas", "es"],
    ];
    for (const [text, language] of everyday) expect(check(ig(text), language, noWinner), text).toEqual([]);
  });

  it("reads 'escapes first', 'survives', 'beats' and the like as a claim of who won, in the three languages", () => {
    const blue: TextFacts = { numbers: [1, 20], winner: "Blue", contestants: ["Red", "Blue"] };
    const wrong: [string, TextLanguage][] = [
      ["Red escapes first. Watch until the end", "en"],
      ["Red makes it out first", "en"],
      ["Only Red survives", "en"],
      ["Red beats Blue", "en"],
      ["Red is the last one standing", "en"],
      ["Red finishes first", "en"],
      ["Red is out first", "en"],
      ["Gerald escapes first", "en"],
      ["Gerald makes it out", "en"],
      ["Czerwona ucieka pierwsza", "pl"],
      ["Tylko czerwona przetrwa", "pl"],
      ["Czerwona pokonuje niebieską", "pl"],
      ["La roja escapa primero", "es"],
      ["Solo la roja sobrevive", "es"],
      ["La roja vence a la azul", "es"],
    ];
    for (const [text, language] of wrong) expect(keysOf(ig(text), language, blue), text).toContain("winner");
    // the clip's own winner said the same ways, a question and a pronoun claim nothing wrong
    const right: [string, TextLanguage][] = [
      ["Blue escapes first. Watch until the end", "en"],
      ["Only Blue survives", "en"],
      ["Blue is the last one standing", "en"],
      ["It escapes first. Watch until the end", "en"],
      ["Which ball escapes first?", "en"],
      ["Niebieska ucieka pierwsza", "pl"],
      ["Która kulka ucieknie pierwsza?", "pl"],
      ["La azul escapa primero", "es"],
      ["¿Qué bola escapa primero?", "es"],
    ];
    for (const [text, language] of right) expect(keysOf(ig(text), language, blue), text).not.toContain("winner");
    // a run with no winner: anyone said to come first waits
    expect(keysOf(ig("Red escapes first"), "en", { ...blue, winner: null })).toContain("winner");
  });

  it("refuses a number the clip's facts do not hold, in digits or in words", () => {
    expect(keysOf(ig("50 rings and one ball"))).toContain("number");
    expect(keysOf(ig("Fifty rings, one ball"))).toContain("number");
    expect(keysOf(ig("Pięćdziesiąt pierścieni"), "pl")).toContain("number");
    expect(keysOf(ig("Cincuenta anillos"), "es")).toContain("number");
    expect(check(ig("50 rings and one ball")).find((p) => p.key === "number")?.match).toBe("50");
    expect(keysOf(ig("20 rings and one ball"))).not.toContain("number");
  });

  it("refuses a winner the clip does not have; a question claims nothing", () => {
    expect(keysOf(ig("Blue wins!"))).toContain("winner");
    expect(keysOf(ig("Niebieska kulka wygrywa."), "pl")).toContain("winner");
    expect(keysOf(ig("Gana la bola azul."), "es")).toContain("winner");
    expect(keysOf(ig("Red wins!"), "en", { ...FACTS, winner: null })).toContain("winner");
    expect(keysOf(ig("Gerald wins!"))).toContain("winner");
    expect(keysOf(ig("And then Gerald wins."))).toContain("winner");
    expect(keysOf(ig("Finally Red wins!"))).not.toContain("winner");
    expect(keysOf(ig("Wow, Red wins!"))).not.toContain("winner");
    expect(keysOf(ig("Red wins!"))).not.toContain("winner");
    expect(keysOf(ig("The winner is Red."))).not.toContain("winner");
    expect(keysOf(ig("Captain Falcon wins it."), "en", { numbers: [1], winner: "Captain Falcon", contestants: ["Captain Falcon", "Little Mac"] }).filter((k) => k !== "name")).not.toContain("winner");
    expect(keysOf(ig("Little Mac wins it."), "en", { numbers: [1], winner: "Captain Falcon", contestants: ["Captain Falcon", "Little Mac"] })).toContain("winner");
    expect(keysOf(ig("Red or Blue: who wins?"))).not.toContain("winner");
    expect(keysOf(ig("¿Quién gana, roja o azul?"), "es")).not.toContain("winner");
  });

  it("refuses words in another language than the autopilot's", () => {
    expect(keysOf(ig("¿Qué bola escapa primero? Mira hasta el final."), "en")).toContain("language");
    expect(keysOf(ig("Which ball escapes first? Watch the end."), "pl")).toContain("language");
    expect(keysOf(ig("Która kulka ucieknie pierwsza? Czy zdąży?"), "es")).toContain("language");
    expect(otherLanguageOf("#satisfying #physics 🔊", "pl")).toBeNull();
    const s = languageScores("¿Qué bola gana?");
    expect(s.es).toBeGreaterThan(s.en);
  });

  it("applies YouTube's title and description rules", () => {
    expect(keysOf(yt("<b>Balls</b>"))).toContain("youtubeTitle");
    expect(keysOf(yt("x".repeat(YOUTUBE_TITLE_CHARS.max + 1)))).toContain("youtubeTitle");
    expect(keysOf(yt(""))).toContain("youtubeTitle");
    expect(keysOf(yt("Which ball escapes first?", "Watch <this>"))).toContain("youtubeText");
    // the title is read like the text
    const title = check(yt("Follow for more"));
    expect(title.find((p) => p.key === "bait")).toMatchObject({ field: "title", channelId: "yt-1" });
  });

  it("names every reason with a closed key, the channel and the field", () => {
    const all = textProblems({ channels: [ig("Follow for more, @x at balls.com: 99 views, the best, Thor wins! #viral"), yt("<>", "x")], language: "en", facts: FACTS, names: NAMES, readNumbers: numbersIn });
    for (const p of all) {
      expect(TEXT_PROBLEM_KEYS).toContain(p.key);
      expect(["ig-1", "yt-1"]).toContain(p.channelId);
      expect(p.match.length).toBeLessThanOrEqual(60);
    }
    const keys = new Set<TextProblemKey>(all.map((p) => p.key));
    for (const k of ["link", "mention", "bait", "claim", "name", "number", "winner", "youtubeTitle"] as TextProblemKey[]) expect(keys, k).toContain(k);
  });
});

describe("what the main process bundles", () => {
  // the crew's number reader and the fighters' names come in as arguments: the file itself imports nothing
  it("imports nothing, so the app's main process bundles the file alone", async () => {
    expect(importsOf("src/lib/desktop/autonomyText.ts")).toEqual([]);
    expect(await mainBundleInputs("src/lib/desktop/autonomyText.ts")).toEqual(["src/lib/desktop/autonomyText.ts"]);
  });
});

// --- end autonomy ---
