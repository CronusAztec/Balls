"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Tooltip from "../Tooltip";
import { ColorPicker, Searchable, Slider, offBtn, onBtn, rainbowBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { BACKGROUND_TYPES, PARTICLE_STYLES, THEMES, isThemeIntact, normalizeHexColor, plainLookPatch, themeById, themePatch, type BackgroundType, type ParticleStyle, type Theme } from "@/lib/themes";

import { IconClose, IconUpload } from "@/components/ui/icons"; // --- site-redesign ---
/** The background picture uploaded in this session (a data: URL kept in memory, like the ball image). */
export interface ThemeImageInfo {
  name: string;
  url: string;
}

/** The page's side of the background picture: what is loaded and how to change it. */
export interface ThemeImageProps {
  image: ThemeImageInfo | null;
  onUpload: (file: File) => void;
  onRemove: () => void;
}

export interface ThemeSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  image: ThemeImageProps;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.visual in Controls.tsx). */
export const THEME_KEYS = ["theme", "themeBackground", "themeBgDim", "themeParticles", "themeTrail"];

const BACKGROUND_LABELS: Record<BackgroundType, string> = { solid: "themeBgSolid", gradient: "themeBgGradient", image: "themeBgImage" };
const PARTICLE_LABELS: Record<ParticleStyle, [string, string]> = {
  confetti: ["🎊", "themeParticleConfetti"],
  sparks: ["✨", "themeParticleSparks"],
  petals: ["🌸", "themeParticlePetals"],
  pixels: ["👾", "themeParticlePixels"],
  bubbles: ["🫧", "themeParticleBubbles"],
};

function backgroundCss(type: "solid" | "gradient", colors: readonly string[]): string {
  return type === "gradient" ? `linear-gradient(to bottom, ${colors[0]}, ${colors[1]})` : colors[0];
}

/** A small preview of a look: the background, a ring in the wall colour and the two balls. */
function Swatch({ background, ring, ball, ball2 }: { background: string; ring: CSSProperties; ball: string; ball2: string }) {
  return (
    <span className="relative block w-full h-10 rounded-md overflow-hidden border border-line-strong/70" style={{ background }} aria-hidden="true">
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full" style={ring} />
      <span className="absolute left-1/2 top-1/2 -translate-x-[3px] -translate-y-[5px] w-2 h-2 rounded-full" style={{ background: ball, boxShadow: `0 0 4px ${ball}` }} />
      <span className="absolute left-1/2 top-1/2 translate-x-[2px] translate-y-[1px] w-1.5 h-1.5 rounded-full" style={{ background: ball2 }} />
    </span>
  );
}

function ThemeCard({ label, selected, edited, onClick, children }: { label: string; selected: boolean; edited: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={`flex flex-col items-stretch gap-1 p-1 rounded-lg transition-all cursor-pointer bg-surface-2/60 hover:bg-surface-3/70 ${selected ? (edited ? "ring-2 ring-accent/50" : "ring-2 ring-accent") : "ring-1 ring-transparent"}`}
    >
      {children}
      <span className={`block text-xs leading-tight truncate ${selected ? "text-accent font-semibold" : "text-ink-2"}`}>{label}</span>
    </button>
  );
}

/**
 * "Theme" block at the top of the Visual section: the theme cards (one click merges a curated palette into
 * the settings – see lib/themes.ts), the background (solid, gradient or an uploaded picture with its dim), the
 * particle style of the bursts and the colour-trail colours. Everything stays individually editable; the
 * drawing lives in themeRenderer.ts and the particle bursts in lib/physics/particleStyles.ts.
 */
export default function ThemeSection({ t, search, matches, settings: s, update, image }: ThemeSectionProps) {
  const [drag, setDrag] = useState(false);
  const intact = isThemeIntact(s);
  const edited = !!themeById(s.themeId) && !intact;
  const colors = s.backgroundColors;
  const setColor = (i: 0 | 1, value: string) => update({ backgroundColors: i === 0 ? [value, colors[1]] : [colors[0], value] });
  const customTrail = s.trailColors.length === 2;
  const showTrail = (s.showTrails && s.colorTrail) || !!search;
  const pickTheme = (theme: Theme) => update(themePatch(theme, s));
  const pickDefault = () => update(plainLookPatch(s, defaultSettings(s.mode)));
  const hex = (value: string) => normalizeHexColor(value) ?? "#ffffff";

  return (
    <>
      <Searchable search={search} matches={matches} labelKey="theme">
        <div className="space-y-2" data-testid="theme-section">
          <label className="text-sm font-medium text-ink-2 flex items-center justify-between gap-2">
            <span>
              {t("theme")}
              <Tooltip text={t("themeTip")} />
            </span>
            {edited && <span className="text-xs font-normal text-ink-3 truncate" data-testid="theme-edited">{t("themeEdited")}</span>}
          </label>
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t("theme")}>
            <ThemeCard label={t("themeDefault")} selected={!s.themeId} edited={false} onClick={pickDefault}>
              <Swatch background="#0a0a0a" ring={{ background: "conic-gradient(#f43f5e, #facc15, #4ade80, #22d3ee, #818cf8, #f43f5e)", WebkitMask: "radial-gradient(circle, transparent 11px, #000 12px)", mask: "radial-gradient(circle, transparent 11px, #000 12px)" }} ball="#ffffff" ball2="#ff3366" />
            </ThemeCard>
            {THEMES.map((theme) => (
              <ThemeCard key={theme.id} label={t(theme.nameKey)} selected={s.themeId === theme.id} edited={s.themeId === theme.id && edited} onClick={() => pickTheme(theme)}>
                <Swatch background={backgroundCss(theme.background.type, theme.background.colors)} ring={{ border: `2px solid ${theme.circleColor}`, boxShadow: `0 0 6px ${theme.circleColor}66` }} ball={theme.ballColor} ball2={theme.ballColor2} />
              </ThemeCard>
            ))}
          </div>
        </div>
      </Searchable>

      <Searchable search={search} matches={matches} labelKey="themeBackground">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("themeBackground")}
            <Tooltip text={t("themeBackgroundTip")} />
          </label>
          <div className="flex gap-1" role="group" aria-label={t("themeBackground")}>
            {BACKGROUND_TYPES.map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => update({ backgroundType: type })}
                aria-pressed={s.backgroundType === type}
                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.backgroundType === type ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
              >
                {t(BACKGROUND_LABELS[type])}
              </button>
            ))}
          </div>
          {s.backgroundType === "solid" && <ColorPicker value={hex(colors[0])} onChange={(v) => setColor(0, v)} label={t("themeBgColor")} />}
          {s.backgroundType === "gradient" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-xs text-ink-3">{t("themeBgTop")}</span>
                <ColorPicker value={hex(colors[0])} onChange={(v) => setColor(0, v)} label={t("themeBgTop")} />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-ink-3">{t("themeBgBottom")}</span>
                <ColorPicker value={hex(colors[1])} onChange={(v) => setColor(1, v)} label={t("themeBgBottom")} />
              </div>
            </div>
          )}
          {s.backgroundType === "image" &&
            (image.image ? (
              <div className="flex items-center gap-3 px-3 py-2 bg-surface-2/60 rounded-lg border border-line-strong/60" data-testid="theme-bg-image">
                <div className="flex-shrink-0 rounded-md" style={{ width: 48, height: 32, backgroundImage: `url(${image.image.url})`, backgroundSize: "cover", backgroundPosition: "center" }} aria-hidden="true" />
                <p className="flex-1 min-w-0 text-sm text-ink truncate" title={image.image.name}>
                  {image.image.name}
                </p>
                <button type="button" onClick={image.onRemove} aria-label={t("themeBgRemove")} title={t("themeBgRemove")} className="text-ink-3 hover:text-danger transition-colors text-sm cursor-pointer px-1">
                  <IconClose size={14} />
                </button>
              </div>
            ) : (
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) image.onUpload(file);
                }}
                className={`flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg font-medium transition-all text-xs cursor-pointer border border-dashed ${
                  drag ? "bg-accent/10 border-accent text-accent scale-[1.02]" : "bg-surface-2 border-line-strong text-ink-2 hover:bg-surface-3 hover:border-ink-3"
                }`}
              >
                <IconUpload size={20} className={drag ? "text-accent" : "text-ink-3"} />
                <span className="font-semibold">{drag ? t("themeBgDrop") : t("themeBgChoose")}</span>
                <input
                  id="theme-bg-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      image.onUpload(file);
                      e.target.value = "";
                    }
                  }}
                />
              </label>
            ))}
          {s.backgroundType === "image" && <p className="text-xs text-ink-3 leading-relaxed">{t("themeBgImageNote")}</p>}
        </div>
      </Searchable>
      {(s.backgroundType === "image" || !!search) && (
        <Slider t={t} search={search} matches={matches} labelKey="themeBgDim" tipKey="themeBgDimTip" value={s.backgroundDim} range={RANGES.backgroundDim} onChange={(v) => update({ backgroundDim: v })} display={`${Math.round(s.backgroundDim * 100)}%`} />
      )}

      <Searchable search={search} matches={matches} labelKey="themeParticles">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("themeParticles")}
            <Tooltip text={t("themeParticlesTip")} />
          </label>
          <div className="grid grid-cols-5 gap-1" role="group" aria-label={t("themeParticles")}>
            {PARTICLE_STYLES.map((style) => (
              <button
                type="button"
                key={style}
                onClick={() => update({ particleStyle: style })}
                aria-pressed={s.particleStyle === style}
                aria-label={t(PARTICLE_LABELS[style][1])}
                title={t(PARTICLE_LABELS[style][1])}
                className={`flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.particleStyle === style ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
              >
                <span className="text-base leading-none" aria-hidden="true">
                  {PARTICLE_LABELS[style][0]}
                </span>
                <span className="truncate max-w-full">{t(PARTICLE_LABELS[style][1])}</span>
              </button>
            ))}
          </div>
        </div>
      </Searchable>

      {showTrail && (
        <Searchable search={search} matches={matches} labelKey="themeTrail">
          <div className="space-y-2">
            {/* --- review fix (ui-i18n) --- the buttons wrap under a long label (es "Colores del rastro") on a narrow panel */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium text-ink-2">
                {t("themeTrail")}
                <Tooltip text={t("themeTrailTip")} />
              </label>
              <div className="flex gap-1" role="group" aria-label={t("themeTrail")}>
                <button
                  type="button"
                  onClick={() => update({ trailColors: [] })}
                  aria-pressed={!customTrail}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${!customTrail ? rainbowBtn : offBtn}`}
                >
                  {t("themeTrailRainbow")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!customTrail) update({ trailColors: [hex(s.ballColor), hex(s.circleColor)] });
                  }}
                  aria-pressed={customTrail}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${customTrail ? onBtn : offBtn}`}
                >
                  {t("themeTrailCustom")}
                </button>
              </div>
            </div>
            {customTrail && (
              <div className="grid grid-cols-2 gap-2">
                <ColorPicker value={hex(s.trailColors[0])} onChange={(v) => update({ trailColors: [v, s.trailColors[1]] })} label={t("themeTrailStart")} />
                <ColorPicker value={hex(s.trailColors[1])} onChange={(v) => update({ trailColors: [s.trailColors[0], v] })} label={t("themeTrailEnd")} />
              </div>
            )}
          </div>
        </Searchable>
      )}
      {!search && <div className="border-b border-line/60" />}
    </>
  );
}
