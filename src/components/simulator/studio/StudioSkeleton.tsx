import { buttonClass } from "@/components/ui/Button";
import { IconPlay } from "@/components/ui/icons";

/*
 * --- studio-first-open --- What the studio page shows while its script loads (the Suspense fallback of the simulator page, a
 * server component, so it is in the page's HTML): the studio's own boxes – the strip with the mode's name, the stage frame
 * with the mode's poster, the transport bar with a disabled Start and a thin bar that fills while the studio loads – laid out
 * by the studio's CSS (globals.css), so the real studio takes the same places when it takes over. The desk's columns are
 * there, empty, so the stage has the width it will have.
 * A small inline script, run as the page is parsed (before the first paint), puts in the poster and the name of the mode the
 * address names (?mode=, else Classic; none for a share code or the daily challenge, whose mode is inside them), and watches
 * the load: when a script under /_next/static fails (its error event; for one that failed before the script ran, an error
 * status in its resource timing, or, while one still has none after 15 s, a HEAD request for it that fails), the page
 * reloads once (sessionStorage, in try/catch), and a second failure, or nothing that has taken over 15 s after the page's
 * scripts have all arrived (a minute at most), turns the skeleton into "The studio did not load" with a Reload button. (The button's click is taken on the window, in the capture phase: React, once its root is
 * up, holds back clicks inside a boundary it has not hydrated yet, and a boundary whose script failed never is.) With
 * scripts off a noscript line says what is missing. Nothing here is recorded, and
 * nothing is kept but the one reload's flag, which goes once the studio has taken over.
 */

/** The sessionStorage flag of the one automatic reload. */
export const STUDIO_RELOAD_KEY = "jumpingballslive_studio_reload";
/** How long the studio may take to take over once the page's scripts have all arrived. */
export const STUDIO_LOAD_TIMEOUT_MS = 15000;

/** The inline script: the mode's poster and name, then the watch over the load (see above). */
export function skeletonScript(names: Readonly<Record<string, string>>, base: string): string {
  const data = JSON.stringify({ names, base, key: STUDIO_RELOAD_KEY, wait: STUDIO_LOAD_TIMEOUT_MS }).replace(/</g, "\\u003c");
  return `(function(){var root=document.currentScript&&document.currentScript.parentNode;if(!root||!root.hasAttribute||!root.hasAttribute("data-studio-skeleton"))return;var d=${data};
var q=new URLSearchParams(location.search),id=q.get("mode");if(!(id&&Object.prototype.hasOwnProperty.call(d.names,id)))id=q.get("c")||q.get("daily")?null:"classic";
var img=root.querySelector("[data-skeleton-poster]"),name=root.querySelector("[data-skeleton-name]");if(id){img.setAttribute("fetchpriority","high");img.src=d.base+"/modes/"+id+".webp";name.textContent=d.names[id];}
var over=false,timer=0,watch=0;function stop(){over=true;clearTimeout(timer);clearInterval(watch);}
function fail(){if(over||!root.isConnected)return;stop();root.setAttribute("data-failed","");root.setAttribute("aria-busy","false");}
function chunkFailed(){if(over||!root.isConnected)return;var again=false;try{if(!sessionStorage.getItem(d.key)){sessionStorage.setItem(d.key,"1");again=true;}}catch(e){}if(again){stop();location.reload();}else fail();}
addEventListener("error",function(e){var t=e.target,src=t&&(t.src||t.href);if(typeof src==="string"&&src.indexOf("/_next/static/")>=0)chunkFailed();},true);
addEventListener("unhandledrejection",function(e){if(e.reason&&e.reason.name==="ChunkLoadError")chunkFailed();});
function scripts(test){var s=document.querySelectorAll('script[src*="/_next/static/"]');for(var i=0;i<s.length;i++)if(test(performance.getEntriesByName(s[i].src)))return s[i].src;return "";}
function pending(){return scripts(function(e){return !e.length;});}
function broken(){return scripts(function(e){return e.length>0&&e[e.length-1].responseStatus>=400;});}
var probing=false;function probe(src){if(probing||typeof fetch!=="function")return;probing=true;fetch(src,{method:"HEAD",cache:"no-store"}).then(function(r){probing=false;if(r.status>=400)chunkFailed();},function(){probing=false;chunkFailed();});}
function check(){if(over||!root.isConnected)return;if(broken())return chunkFailed();var s=pending();if(s&&performance.now()<60000){probe(s);timer=setTimeout(check,3000);return;}fail();}
var button=root.querySelector("[data-skeleton-reload]");addEventListener("click",function(e){if(root.isConnected&&e.target instanceof Node&&button.contains(e.target))location.reload();},true);
timer=setTimeout(check,d.wait);watch=setInterval(function(){if(!root.isConnected){stop();try{sessionStorage.removeItem(d.key);}catch(e){}}},500);
if(broken())chunkFailed();})();`;
}

export default function StudioSkeleton({ names, base, labels }: { names: Readonly<Record<string, string>>; base: string; labels: { mode: string; start: string; failed: string; reload: string; noScript: string } }) {
  return (
    <div className="studio-main group min-h-[calc(100svh-56px)]" data-studio-skeleton="" aria-busy="true">
      <div className="studio">
        <div className="studio-stage">
          <div className="studio-stage-column">
            {/* the stage strip: the mode's name (the script fills it in), the load bar along its foot */}
            <div className="relative flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4 [@media(pointer:coarse)]:h-12">
              <span className="eyebrow shrink-0 text-ink-3 max-sm:hidden">{labels.mode}</span>
              <span className="min-w-0 truncate text-sm font-medium text-ink" data-skeleton-name="" />
              <span aria-hidden="true" className="studio-skeleton-bar absolute inset-x-0 -bottom-px h-0.5 bg-accent group-data-[failed]:hidden" />
            </div>
            {/* the stage frame at the studio's size (the area does not grow: the frame stays at the top, where the studio puts it) */}
            <div className="studio-stage-area stage-vignette relative flex-none">
              <div className="stage-frame relative overflow-hidden rounded-[var(--radius-stage)] border border-line bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element -- the poster the script names, in the frame's centred square (none: no picture, not a broken one's outline) */}
                <img data-skeleton-poster="" alt="" width={360} height={360} decoding="async" className="absolute inset-0 h-full w-full object-contain [&:not([src])]:hidden" />
                <noscript>
                  <div className="absolute inset-0 flex items-center justify-center bg-bg/85 p-4 text-center">
                    <p className="max-w-xs text-sm text-ink-2">{labels.noScript}</p>
                  </div>
                  <style>{"[data-studio-skeleton] .studio-skeleton-bar{display:none}"}</style>
                </noscript>
                <div role="alert" className="absolute inset-0 hidden flex-col items-center justify-center gap-3 bg-bg/85 p-4 text-center group-data-[failed]:flex">
                  <p className="text-md font-medium text-ink">{labels.failed}</p>
                  <button type="button" className={buttonClass({ variant: "secondary", size: "sm" })} data-skeleton-reload="">
                    {labels.reload}
                  </button>
                </div>
              </div>
            </div>
            <div className="studio-transport">
              <button type="button" disabled className={buttonClass({ variant: "primary", size: "sm" })}>
                <IconPlay size={16} />
                {labels.start}
              </button>
            </div>
          </div>
        </div>
        {/* the desk's places, empty: the rail (the phone's tab strip, the column from 1280 px; none at 768-899 px, where it follows the stage) and the panel */}
        <div className="studio-desk" aria-hidden="true">
          <div className="studio-rail md:max-[900px]:hidden" />
          <div className="studio-panel max-md:hidden" />
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: skeletonScript(names, base) }} />
    </div>
  );
}
