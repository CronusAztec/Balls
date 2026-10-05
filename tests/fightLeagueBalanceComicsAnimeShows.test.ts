import { FL_CONFERENCES } from "@/lib/physics/modes/fightLeagueRoster";
import { defineBalanceTests } from "./flBalance";

/** --- fl-overhaul --- (Stage 2) The balance gate of the comics, anime, shows conference(s) (see tests/flBalance.ts). */
defineBalanceTests((["comics", "anime", "shows"] as const).flatMap((c) => [...FL_CONFERENCES[c]]));
