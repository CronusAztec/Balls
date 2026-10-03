"use client";

import { useTranslations } from "next-intl";
import type { Translate } from "../ControlPrimitives";
import { COUNTRIES, countryByCode, countryOfFlag, countryTeamEntry } from "@/lib/countries";
import type { TeamEntry } from "@/lib/teams";

/**
 * --- land-claim --- The "Country" picker of a roster row (Teams section): a compact select – a globe while closed – listing
 * the built-in countries (lib/countries.ts) by their translated names; picking one fills the entry with the country's name,
 * its flag as the emoji and its primary colour (`countryTeamEntry()`). The modes draw the flag on the balls (Land Claim inside
 * a ring in the team colour – its two-letter code where the fonts have no flag glyphs).
 */
export default function CountryPicker({ t, index, team, onPick }: { t: Translate; index: number; team: TeamEntry; onPick: (patch: Partial<TeamEntry>) => void }) {
  const names = useTranslations("Countries");
  const n = index + 1;
  const nameOf = (code: string, english: string) => (names.has(code) ? names(code) : english);
  const current = countryOfFlag(team.emoji);
  const options = COUNTRIES.map((c) => ({ code: c.code, flag: c.flag, name: nameOf(c.code, c.name) })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select
      value=""
      onChange={(e) => {
        const country = countryByCode(e.target.value);
        if (country) onPick(countryTeamEntry(country, nameOf(country.code, country.name)));
      }}
      aria-label={t("teamCountry", { n })}
      title={current ? nameOf(current.code, current.name) : t("teamCountryTip")}
      className="w-10 shrink-0 h-9 px-1 bg-surface-2 text-ink text-center text-base rounded-lg border border-line-strong focus:border-accent-dim cursor-pointer"
      data-testid="team-country"
    >
      <option value="">🌍</option>
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {c.flag} {c.name}
        </option>
      ))}
    </select>
  );
}
