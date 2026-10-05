import { FL_CONFERENCES } from "@/lib/physics/modes/fightLeagueRoster";
import { defineBalanceTests } from "./flBalance";

/** --- fl-overhaul --- (Stage 2) The balance gate of the movies conference(s) (see tests/flBalance.ts). */
defineBalanceTests((["movies"] as const).flatMap((c) => [...FL_CONFERENCES[c]]));
