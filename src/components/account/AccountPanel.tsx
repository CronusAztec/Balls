"use client";

import { useEffect, useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import Button, { buttonClass } from "@/components/ui/Button";
import Field, { Hint, inputClass } from "@/components/ui/Field";
import { IconArrowRight, IconClose, IconPlus, IconUsers } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import { useAccount } from "@/lib/account/hooks";
import { ACCOUNT_PROFILE_ID, type AccountSnapshot } from "@/lib/account/controller";
import { accountViews, getPublishController, type AccountView, type PublishSnapshot } from "@/lib/publish/controller";
import { PUBLISH_PLATFORMS, type PublishPlatform } from "@/lib/publish/platforms";
import { assetPath } from "@/lib/site";

/*
 * --- user-accounts --- The Account page's panel (the site and the Windows app render the same page). Signed out: Create account
 * and Sign in on one form, plus the relay's address under Server. Signed in: who, Sign out, the connected channels – any
 * number of TikTok, Instagram and YouTube accounts, each added through the platform's own sign-in popup and kept on the
 * relay – then a pointer to the studio's Publish block, and Security (change the password, delete the account). The account's
 * state is lib/account/controller.ts; the channels are the Publish controller's relay accounts of the account's profile.
 */

const PLATFORM_NAMES: Record<PublishPlatform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
const smallBtn = "px-2 py-1 rounded-md text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

type Translate = ReturnType<typeof useTranslations>;

/**
 * A link to another page of the site in the visitor's language. A plain anchor, not next-intl's Link: the studio's panel (which
 * shows this panel in a dialog) is imported by code that runs outside Next (tests/), where that Link cannot load. Inside the
 * studio's dialog it opens a new tab, so the clips waiting there are not lost.
 */
function SiteLink({ href, embedded, className, children }: { href: string; embedded: boolean; className?: string; children: ReactNode }) {
  const locale = useLocale();
  return (
    <a href={assetPath(`/${locale}${href}/`)} className={className} {...(embedded ? { target: "_blank", rel: "noopener" } : {})}>
      {children}
    </a>
  );
}

/** An error in the page's language (its code under `Account.errors`), else the error's own text. */
function errorText(t: Translate, code: string | null, raw: string | null): string | null {
  return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : raw;
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full bg-surface-3 object-cover" />;
  }
  return (
    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm text-ink">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/* ------------------------------------------------------------------ signed out */

function ServerSettings({ a, t }: { a: AccountSnapshot; t: Translate }) {
  const { controller } = useAccount();
  const id = useId();
  const [value, setValue] = useState("");
  const missing = a.ready && !a.relayUrl;
  // The block opens by itself while there is no server to talk to, and then stays as the visitor leaves it: saving the address
  // must not close it on the "Connected to …" line that answers the save.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (missing) setOpen(true);
  }, [missing]);
  let host = "";
  try {
    host = a.relayUrl ? new URL(a.relayUrl).host : "";
  } catch {
    host = a.relayUrl;
  }
  return (
    <details className="mt-6 border-t border-line pt-4 text-sm" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-testid="account-server">
      <summary className="cursor-pointer select-none text-ink-2">{t("server.summary")}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-ink-3">{missing ? t("server.none") : t("server.intro")}</p>
        {a.healthStatus === "loading" && <Hint>{t("server.checking")}</Hint>}
        {a.healthStatus === "ok" && host && <Hint tone="ok">{t("server.ready", { host })}</Hint>}
        {a.healthStatus === "error" && <Hint tone="danger">{t("server.unreachable")}</Hint>}
        <Field label={t("server.label")} htmlFor={id}>
          <input id={id} type="url" value={value} onChange={(e) => setValue(e.target.value)} placeholder={a.relayUrl || t("server.placeholder")} className={inputClass} autoComplete="off" spellCheck={false} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => controller.setRelayUrl(value)} disabled={!value.trim()}>
            {t("server.save")}
          </Button>
          {a.envRelayUrl && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue("");
                controller.setRelayUrl("");
              }}
            >
              {t("server.reset")}
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}

function SignedOut({ a, t, embedded }: { a: AccountSnapshot; t: Translate; embedded: boolean }) {
  const { controller } = useAccount();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const ids = { name: useId(), email: useId(), password: useId() };
  const closed = mode === "signup" && a.health?.signup === false;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void (mode === "signup" ? controller.signup(form.email, form.password, form.name) : controller.login(form.email, form.password)).then((ok) => {
      if (ok) setForm({ name: "", email: "", password: "" });
    });
  };
  const error = errorText(t, a.errorCode, a.error);
  return (
    <section className="max-w-[460px]" aria-labelledby="account-form-title" data-testid="account-signed-out">
      <h2 id="account-form-title" className="sr-only">
        {t("tabs.label")}
      </h2>
      <div role="tablist" aria-label={t("tabs.label")} className="mb-5 inline-flex rounded-md border border-line bg-surface-1 p-0.5">
        {(["signup", "login"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              controller.dismiss();
            }}
            className={cx("h-8 rounded px-4 text-sm font-medium transition-colors [@media(pointer:coarse)]:min-h-11", mode === m ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}
            data-testid={`account-tab-${m}`}
          >
            {m === "signup" ? t("tabs.signUp") : t("tabs.signIn")}
          </button>
        ))}
      </div>
      {a.notice && a.notice !== "passwordChanged" && (
        <p role="status" className="mb-4 text-sm text-ink-2" data-testid="account-notice">
          {t(`notice.${a.notice}`)}
        </p>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        {mode === "signup" && (
          <Field label={t("form.name")} htmlFor={ids.name} hint={t("form.nameHint")}>
            <input id={ids.name} type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} autoComplete="name" maxLength={60} />
          </Field>
        )}
        <Field label={t("form.email")} htmlFor={ids.email}>
          <input id={ids.email} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} autoComplete="email" inputMode="email" required />
        </Field>
        <Field label={t("form.password")} htmlFor={ids.password} hint={mode === "signup" ? t("form.passwordHint") : undefined}>
          <input id={ids.password} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
        </Field>
        {closed && <Hint tone="warn">{t("server.closed")}</Hint>}
        {error && (
          <p role="alert" className="text-sm text-danger" data-testid="account-error" data-code={a.errorCode ?? ""}>
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" block disabled={a.busy || !a.relayUrl || closed} data-testid="account-submit">
          {a.busy ? t("form.working") : mode === "signup" ? t("form.createAccount") : t("form.signIn")}
        </Button>
        {mode === "signup" && (
          <p className="text-xs leading-relaxed text-ink-3">
            {t.rich("form.agree", {
              terms: (chunks) => (
                <SiteLink href="/terms" embedded={embedded} className="underline hover:text-ink">
                  {chunks}
                </SiteLink>
              ),
              privacy: (chunks) => (
                <SiteLink href="/privacy" embedded={embedded} className="underline hover:text-ink">
                  {chunks}
                </SiteLink>
              ),
            })}
          </p>
        )}
      </form>
      <ServerSettings a={a} t={t} />
    </section>
  );
}

/* ------------------------------------------------------------------ signed in */

function ChannelRow({ view, s, t }: { view: AccountView; s: PublishSnapshot; t: Translate }) {
  const c = getPublishController();
  const label = view.handle ? `${view.name} · ${view.handle}` : view.name;
  return (
    <li className="flex items-center gap-3 py-2" data-account-channel={view.id} data-platform={view.platform}>
      <Avatar src={view.avatar} name={view.name} />
      <span className="min-w-0 flex-1 truncate text-md text-ink" title={view.note ?? label}>
        {label}
      </span>
      {view.expired && (
        <button type="button" onClick={() => c.connectRelay(view.platform)} className={`${smallBtn} bg-warn/20 text-warn hover:bg-warn/30`}>
          {t("connections.reconnect")}
        </button>
      )}
      <button
        type="button"
        onClick={() => void c.removeRelayAccount(view.id)}
        disabled={s.sending}
        className={`${smallBtn} text-ink-3 hover:bg-surface-2 hover:text-ink`}
        aria-label={t("connections.disconnect", { name: label })}
        title={t("connections.disconnect", { name: label })}
      >
        <IconClose size={14} />
      </button>
    </li>
  );
}

function Channels({ t }: { t: Translate }) {
  const c = getPublishController();
  const s = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getServerSnapshot);
  // The channels shown are the account's: make its relay profile the one in use (Publish may have another selected).
  const hasProfile = s.stored.relayProfiles.some((p) => p.id === ACCOUNT_PROFILE_ID);
  const active = s.relay.profileId === ACCOUNT_PROFILE_ID;
  useEffect(() => {
    if (hasProfile && !active) c.selectProfile(ACCOUNT_PROFILE_ID);
  }, [c, hasProfile, active]);
  const views = active ? accountViews(s, Date.now()).filter((v) => v.via === "relay") : [];
  const apps = s.relay.info?.platforms;
  return (
    <section className="mt-10 border-t border-line pt-8" aria-labelledby="account-channels" data-testid="account-channels">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="account-channels" className="text-xl font-bold text-ink">
          {t("connections.title")}
        </h2>
        <button type="button" onClick={() => void c.refreshRelay()} className="text-sm text-ink-3 hover:text-ink">
          {t("connections.reload")}
        </button>
      </div>
      <p className="mt-2 max-w-[640px] text-md text-ink-2">{t("connections.intro")}</p>
      {s.relay.status === "loading" && <p className="mt-3 text-sm text-ink-3">{t("connections.loading")}</p>}
      {s.relay.error && (
        <p role="alert" className="mt-3 text-sm text-danger" data-testid="account-channels-error">
          {t("connections.relayError", { error: s.relay.error })}
        </p>
      )}
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {PUBLISH_PLATFORMS.map((platform) => {
          const list = views.filter((v) => v.platform === platform);
          const missing = apps && !apps[platform];
          const name = PLATFORM_NAMES[platform];
          return (
            <div key={platform} className="rounded-xl border border-line bg-surface-1 p-4" data-account-platform={platform}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-md font-medium text-ink">{name}</h3>
                <span className="text-xs text-ink-3">{t("connections.count", { count: list.length })}</span>
              </div>
              {list.length > 0 && (
                <ul className="mt-2 divide-y divide-line">
                  {list.map((v) => (
                    <ChannelRow key={v.key} view={v} s={s} t={t} />
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <Button
                  size="sm"
                  variant={list.length ? "secondary" : "primary"}
                  icon={<IconPlus size={14} />}
                  onClick={() => c.connectRelay(platform)}
                  disabled={!!missing || !!s.connecting || s.relay.status === "error" || !active}
                  data-account-connect={platform}
                >
                  {list.length ? t("connections.another", { platform: name }) : t("connections.connect", { platform: name })}
                </Button>
                {missing && <Hint className="mt-2">{t("connections.notSetUp", { platform: name })}</Hint>}
              </div>
            </div>
          );
        })}
      </div>
      {s.connecting && (
        <div className="mt-4 flex items-center gap-3 text-sm text-ink-2" role="status">
          <span>{t("connections.waiting", { platform: PLATFORM_NAMES[s.connecting] })}</span>
          <Button size="sm" variant="ghost" onClick={() => c.cancelConnect()}>
            {t("connections.cancel")}
          </Button>
        </div>
      )}
      {s.connectLink && (
        <p className="mt-3 text-sm text-warn">
          {t("connections.popupBlocked")}{" "}
          <a href={s.connectLink} target="_blank" rel="noopener" className="text-accent underline">
            {t("connections.openSignIn")}
          </a>
        </p>
      )}
    </section>
  );
}

function Security({ a, t }: { a: AccountSnapshot; t: Translate }) {
  const { controller } = useAccount();
  const ids = { current: useId(), next: useId(), del: useId() };
  const [pw, setPw] = useState({ current: "", next: "" });
  const [del, setDel] = useState("");
  const error = errorText(t, a.errorCode, a.error);
  return (
    <section className="mt-10 border-t border-line pt-8" aria-labelledby="account-security">
      <h2 id="account-security" className="text-xl font-bold text-ink">
        {t("security.title")}
      </h2>
      {a.notice === "passwordChanged" && (
        <p role="status" className="mt-3 text-sm text-ok" data-testid="account-notice">
          {t("notice.passwordChanged")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger" data-testid="account-error" data-code={a.errorCode ?? ""}>
          {error}
        </p>
      )}
      <div className="mt-5 grid gap-10 md:grid-cols-2">
        <form
          className="max-w-[360px] space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void controller.changePassword(pw.current, pw.next).then((ok) => ok && setPw({ current: "", next: "" }));
          }}
        >
          <Field label={t("security.currentPassword")} htmlFor={ids.current}>
            <input id={ids.current} type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className={inputClass} autoComplete="current-password" required />
          </Field>
          <Field label={t("security.newPassword")} htmlFor={ids.next} hint={t("form.passwordHint")}>
            <input id={ids.next} type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className={inputClass} autoComplete="new-password" required />
          </Field>
          <Button type="submit" disabled={a.busy || !pw.current || !pw.next}>
            {t("security.changePassword")}
          </Button>
        </form>
        <form
          className="max-w-[360px] space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void controller.deleteAccount(del);
          }}
        >
          <h3 className="text-md font-medium text-ink">{t("security.deleteTitle")}</h3>
          <Hint tone="warn">{t("security.deleteWarning")}</Hint>
          <Field label={t("security.deletePassword")} htmlFor={ids.del}>
            <input id={ids.del} type="password" value={del} onChange={(e) => setDel(e.target.value)} className={inputClass} autoComplete="current-password" required />
          </Field>
          <Button type="submit" variant="danger" disabled={a.busy || !del} data-testid="account-delete">
            {t("security.delete")}
          </Button>
        </form>
      </div>
    </section>
  );
}

function SignedIn({ a, t, embedded }: { a: AccountSnapshot; t: Translate; embedded: boolean }) {
  const { controller } = useAccount();
  const session = a.session!;
  return (
    <div data-testid="account-signed-in">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface-1 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
            <IconUsers size={20} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-md font-medium text-ink" data-testid="account-name">
              {t("signedIn.title", { name: session.user.name })}
            </p>
            <p className="truncate text-sm text-ink-3" data-testid="account-email">
              {session.user.email}
            </p>
          </div>
        </div>
        <Button onClick={() => void controller.logout()} disabled={a.busy} data-testid="account-signout">
          {t("signedIn.signOut")}
        </Button>
      </section>
      <p className="mt-3 text-sm text-ink-3">{t("signedIn.note")}</p>
      <Channels t={t} />
      {!embedded && (
      <section className="mt-10 border-t border-line pt-8" aria-labelledby="account-next">
        <h2 id="account-next" className="text-xl font-bold text-ink">
          {t("next.title")}
        </h2>
        <p className="mt-2 max-w-[640px] text-md text-ink-2">{t("next.text")}</p>
        <SiteLink href="/simulator" embedded={false} className={buttonClass({ variant: "primary", className: "mt-4" })}>
          {t("next.studio")}
          <IconArrowRight size={16} />
        </SiteLink>
      </section>
      )}
      <Security a={a} t={t} />
    </div>
  );
}

/** `embedded`: inside the studio's Account dialog, where "Open the studio" would point at the page it is on. */
export default function AccountPanel({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations("Account");
  const { snapshot: a } = useAccount();
  if (!a.ready) return <div className="min-h-[240px]" aria-busy="true" data-testid="account-loading" />;
  // --- legal-copy --- the relay's own answer decides: when its health lists no platform, no channel can be connected, and the page says so
  const noPlatform = a.healthStatus === "ok" && !!a.health && !a.health.platforms.tiktok && !a.health.platforms.instagram && !a.health.platforms.youtube;
  return (
    <>
      {noPlatform && (
        <div role="status" className="mb-6 max-w-[640px] rounded-xl border border-warn/30 bg-warn/5 p-4" data-testid="account-channels-closed">
          <p className="text-md font-medium text-ink">{t("closed.title")}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{t("closed.text")}</p>
        </div>
      )}
      {a.session ? <SignedIn a={a} t={t} embedded={embedded} /> : <SignedOut a={a} t={t} embedded={embedded} />}
    </>
  );
}
