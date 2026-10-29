/*
 * --- learner --- Every threshold of the learner, one named constant each, with its reason and the simulation behind it. The
 * learner reads its posts' numbers (lib/insights/stats.ts), tests one change at a time on normal posts and up to three at a
 * time on Trial Reel pairs (lib/insights/lab.ts), and keeps only what wins (lib/insights/learner.ts). Its dials are
 * lib/insights/dials.ts, and lib/insights/feasibility.ts plans every arm before a test opens.
 *
 * "sim" names the learner plan's toy simulations (29 Oct 2026): final.py and merged.py, and l0.py, which runs the final rules
 * with reads missed while the app is closed, posts left out and clips the crew drops (python3 -I sim/l0.py, seed 20261029;
 * its output is pinned in tests/insightsLearner.test.ts and tests/insightsLab.test.ts). The toy world: log-normal views with
 * a spread of 1.0, a shared day effect of 30 % of the variance, 1 % of posts a 30x hit, every score clipped at ln 10. The
 * owner's real spread is unknown until about 60 measured clips.
 *
 * Once tuned on the owner's numbers this file joins scripts/agent/protected.json, so a later change is the owner's decision.
 * Pure data: no imports, so the app's main process can bundle it.
 */

// --- learner ---

/* ------------------------------------------------------------------ the score (stats.ts) */

/** The score's rule number. A verdict records it, so a later fix to the score is told apart from the numbers it read. */
export const SCORE_RULE = 1;
/** Every score is clipped at plus or minus ln 10, so one 30x hit cannot decide a test (sim: final.py, 1 % of posts 30x). */
export const SCORE_CLIP = Math.log(10);
/** The usual is the median of the channel's last 20 measured posts in the lane: enough to be steady, recent enough to drift. */
export const USUAL_POSTS = 20;
/** ...within 120 days, so a channel's usual follows its growth and the platforms' drift. */
export const USUAL_WINDOW_DAYS = 120;
/** The normal lane changes nothing before a channel has 5 measured posts ("Learning your usual: 3 of 5"). */
export const USUAL_MIN_POSTS = 5;
/** A usual under 10 views is too small to score against (ln((v + 1) / 11) would swing on a handful of views). */
export const USUAL_MIN_VIEWS = 10;
/**
 * How views grow with age: views ~ age^0.35. It projects a lone read to 72 h until the channel's own growth is known
 * (sim: final.py C, the post-time bias; l0.py draws each post's growth from N(0.35, 0.10)).
 */
export const GROWTH_PRIOR = 0.35;
/** The channel's own growth replaces the prior once 5 of its posts have two reads each. */
export const GROWTH_MIN_POSTS = 5;
/** A growth exponent stays inside [0, 1]: views never fall, and never grow faster than age. */
export const GROWTH_BOUNDS = { min: 0, max: 1 } as const;

/* ------------------------------------------------------------------ the reads (stats.ts) */

/** The hour the score is drawn at: Instagram's own window for a Trial Reel, and the plan's one score. */
export const SCORE_AGE_H = 72;
/** The early read (shown only, as Meta's numbers can lag up to 48 h). */
export const EARLY_WINDOW_H = { from: 18, to: 36 } as const;
/** The 3-day read, as near 72 h as the app is open. */
export const DAY3_WINDOW_H = { from: 60, to: 96 } as const;
/** The week read. */
export const WEEK_WINDOW_H = { from: 144, to: 240 } as const;
/**
 * The ages a score may rest on: a post with no read between 48 h and 168 h is not measured. A 3-day read missed while the
 * app was closed is caught up until 168 h (sim: l0.py, 25 % of reads missed: the rates hold and the horizon moves).
 */
export const MEASURED_FROM_H = 48;
export const MEASURED_UNTIL_H = 168;
/** Never one post twice within an hour (Postiz caches nothing: posts.service.ts reads its Redis copy nowhere). */
export const READ_SPACING_H = 1;
/** An empty answer for a published post is "no answer", tried again 2 hours later... */
export const NO_ANSWER_RETRY_H = 2;
/** ...at most 3 times inside its window, then "not measured", never zero. */
export const NO_ANSWER_TRIES = 3;
/** At most 20 numbers calls an hour: Postiz's docs say 30, and the owner's other tools may share that budget. */
export const READS_PER_HOUR = 20;
/** A 429 waits an hour. */
export const RATE_LIMIT_WAIT_H = 1;
/** After 3 empty or failed reads in a row on one channel, its reads wait 6 hours (a read can refresh, and lose, a token). */
export const CHANNEL_FAIL_STREAK = 3;
export const CHANNEL_BACKOFF_H = 6;
/** 5 published posts in a row with no answer on one platform: "Postiz returned no numbers for your Instagram posts". */
export const NO_ANSWER_STREAK = 5;
/** The stored rows: at most 1000, none older than 180 days, YouTube's deleted after 30 (its derived-metrics policy). */
export const INSIGHT_ROWS_MAX = 1000;
export const INSIGHT_ROW_MAX_DAYS = 180;
export const YOUTUBE_ROW_MAX_DAYS = 30;
/** No data older than a metric's change of meaning: Instagram's plays became views, YouTube Shorts counted views anew. */
export const METRIC_BREAKS = { instagram: "2025-04-21", youtube: "2025-03-31" } as const;

/* ------------------------------------------------------------------ the decision (learner.ts, lab.ts) */

/** The prior on any change's effect: N(0, 0.5^2) on the log ratio, as most changes move views by less than 1.65x. */
export const PRIOR_SD = 0.5;
/** A change is kept when it is better with at least 80 % certainty... (sim: final.py, merged.py; l0.py with misses) */
export const KEEP_P = 0.8;
/** ...and its shrunken ratio is at least 1.25x. Together: no difference kept 10-14 % of the time, 0.67x 1-3 % (l0.py). */
export const KEEP_RATIO = 1.25;
/**
 * The normal lane looks once, after 8 scored test clips against at least 8 best clips of the same window (l0.py: 2x kept
 * 66-68 %, 1.5x 40-41 %, no difference 11-14 %, 0.67x 1-3 %; 11-14 days at 3 clips a day, 25-29 at 1 a day).
 */
export const NORMAL_TEST_CLIPS = 8;
export const NORMAL_BEST_MIN = 8;
/**
 * A Trial Reel block reads once, after 8 clean pairs (l0.py, two or three dials: 2x kept 67-69 %, no difference 14 %, 0.67x
 * 2-3 %; a median of 12-14 days at one pair a day, none short of pairs within 21 days).
 */
export const BLOCK_PAIRS = 8;
/** The noise prior of the pair fit: sd 1.2, worth 6 pseudo-pairs (merged.py). */
export const NOISE_PRIOR_SD = 1.2;
export const NOISE_PRIOR_PAIRS = 6;
/** A block that cannot finish 8 clean pairs within 21 days closes as "not enough clean pairs". */
export const BLOCK_MAX_DAYS = 21;
/** A question that lost rests 60 days, because platforms drift... */
export const REST_DAYS = 60;
/** ...and a question that lost twice in a row rests 60 more. */
export const REST_TWICE_DAYS = 120;

/* ------------------------------------------------------------------ the checks (learner.ts) */

/** After a kept change, the next 16 normal posts: 4 keep the old combination, 12 use the new one (final.py D, l0.py 3). */
export const CHECK_POSTS = 16;
export const CHECK_OLD = 4;
/** The old combination ahead with 80 % certainty sends every change of its test back (0.5x: 47 %, 0.67x: 28 %, 2x: 1 %). */
export const CHECK_BACK_P = 0.8;

/* ------------------------------------------------------------------ the slots (learner.ts) */

/** 1 normal clip in 3 is a test clip while a test runs, and only one test or check runs at a time. */
export const TEST_EVERY = 3;
/** Without Trial Reels, a newcomer or format test takes at most 1 normal clip in 5 (it risks more with followers). */
export const NEWCOMER_TEST_EVERY = 5;
/**
 * A newcomer test's best arm is its format's rotation, not the best settings, so only 2 clips per test clip take it (8 test
 * clips against 16, as the decision rule's worlds): the day's other clips keep the best settings and count for no test, so a
 * newcomer test never locks the whole lane, Shorts included, to one format, and the variety caps hold. At 1 test clip in 3
 * it is 1 per test clip, so 1 clip in 3 keeps the best settings.
 */
export const NEWCOMER_ROTATION_CLIPS = 2;
/** Trial Reel pairs a day: one by default (the owner's answer 1), at most two. */
export const PAIRS_PER_DAY_DEFAULT = 1;
export const PAIRS_PER_DAY_MAX = 2;
/** The two reels of a pair go out at least 2 hours apart (the windows below are 2.5 h apart). */
export const PAIR_GAP_H = 2;
/**
 * The Trial Reel windows (local, 30 minutes each): pair 1 takes the first two that start outside quiet hours, pair 2 the next
 * two; a pair that does not fit is not made that day (learner.ts trialPairWindows).
 */
export const TRIAL_WINDOWS = ["10:00", "12:30", "15:00", "17:30"] as const;
export const TRIAL_WINDOW_MIN = 30;
/**
 * The post-time windows (local): noon, evening, night. "spread" walks them by date, never by a clip's role, so a test's clips
 * and its best clips meet each window as often (learner.ts spreadWindows).
 */
export const POST_WINDOWS = { noon: ["12:00", "14:00"], evening: ["17:00", "19:00"], night: ["20:00", "22:00"] } as const;

/* ------------------------------------------------------------------ variety (learner.ts) */

/** At most 40 % of a channel's posts in 7 days from one template (YouTube's "made with a template", TikTok's unoriginal rule)... */
export const TEMPLATE_SHARE_MAX = 0.4;
export const VARIETY_DAYS = 7;
/** ...once the channel has 5 posts in those days (one post is 100 % of one). */
export const VARIETY_MIN_POSTS = 5;
/** At least 3 templates in 7 days when 3 are ready. */
export const VARIETY_MIN_TEMPLATES = 3;
/** While the ending is untested, 1 best clip in 3 is a cliffhanger where its template allows one (a share of 0.2 to 0.5). */
export const CLIFF_EVERY = 3;

/* ------------------------------------------------------------------ the crew (learner.ts, feasibility.ts) */

/** A dropped clip is replaced in its slot at most twice; then the slot goes to the best setting and the test notes it. */
export const REPLACE_MAX = 2;
/** The drop rule looks after at least 6 attempts per arm... */
export const DROP_MIN_ATTEMPTS = 6;
/** ...and closes the test as "rarely passes the crew's checks" when one arm passes 20 or more points less often... */
export const DROP_GAP = 0.2;
/**
 * ...and the gap is at least 2.58 standard errors. The plan's words alone (20 points after 6 attempts, at any look) closed 39 %
 * of tests whose arms pass equally often (85 % each) in l0.py 4; with 2.58 standard errors 2-4 %, while it still closes 42 %
 * of tests at 50 % against 85 % and 79 % at 30 % against 85 %.
 */
export const DROP_GAP_Z = 2.58;
/** Every arm is planned 3 times with the seed search and the crew's rule gates before its test opens... */
export const FEASIBILITY_PLANS = 3;
/** ...and at least 2 of the 3 must pass every rule gate, or its dial is swapped for the next one (Gerald's Portal, short). */
export const FEASIBILITY_PASS = 2;

/* ------------------------------------------------------------------ graduation (shown by the card) */

/** A Trial Reel that beat its pair and did at least 1.5x the trial usual gets "Share it to everyone in Instagram". */
export const GRADUATE_RATIO = 1.5;

// --- end learner ---
