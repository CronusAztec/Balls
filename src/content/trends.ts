import data from "./trends.json";
import { parseTrends, type TrendSummary } from "@/lib/trends";

/*
 * --- trends --- What is trending in short simulation videos: the committed summary of the agent toolbox's inspire reports
 * (`npm run trends -- <report …>` writes trends.json; lib/trends.ts is its shape and check). The app's AI reads it next to
 * the virality playbook (lib/desktop/ai/playbookContext.ts trendingContext). null when the file fails its check, so a
 * broken summary never reaches a prompt (tests/trends.test.ts keeps the committed one sound).
 */
export const TRENDS: TrendSummary | null = parseTrends(data);
