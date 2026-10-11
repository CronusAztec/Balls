import { FL_CONFERENCES } from "@/lib/physics/modes/fightLeagueRoster";
import { defineBalanceTests } from "./flBalance";

/** --- fl-overhaul --- (Stage 2) The balance gate of the games conference(s) (see tests/flBalance.ts). */
defineBalanceTests((["games"] as const).flatMap((c) => [...FL_CONFERENCES[c]]));
