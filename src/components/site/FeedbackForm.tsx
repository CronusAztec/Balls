"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SITE_NAME } from "@/lib/site";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Field, { inputClass, textareaClass } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import { IconCheck, IconExternal, IconStar, IconWarning } from "@/components/ui/icons";

const CATEGORIES = ["general", "bug", "feature", "design", "other"] as const;

/**
 * The site is a static export, so feedback is delivered straight from the browser. The first
 * configured channel wins:
 *  1. NEXT_PUBLIC_FEEDBACK_ENDPOINT – POST JSON to any form backend or webhook (Formspree,
 *     Basin, a Cloudflare Worker, your own API...).
 *  2. NEXT_PUBLIC_FEEDBACK_EMAIL    – open the visitor's email app with a prefilled message.
 *  3. NEXT_PUBLIC_GITHUB_REPO       – open a prefilled "new issue" form on GitHub
 *     (the GitHub Pages workflow sets this automatically).
 * With none of them set the form explains that no channel is configured.
 */
const ENDPOINT = process.env.NEXT_PUBLIC_FEEDBACK_ENDPOINT || "";
const EMAIL = process.env.NEXT_PUBLIC_FEEDBACK_EMAIL || "";
const GITHUB_REPO = process.env.NEXT_PUBLIC_GITHUB_REPO || "";
export type FeedbackChannel = "endpoint" | "email" | "github" | "none";
export const FEEDBACK_CHANNEL: FeedbackChannel = ENDPOINT ? "endpoint" : EMAIL ? "email" : GITHUB_REPO ? "github" : "none";

interface FeedbackEntry {
  rating: number;
  category: string;
  message: string;
  email: string;
  locale: string;
  page: string;
}

/** Plain-text version of an entry for email bodies and GitHub issues. */
export function formatFeedback(entry: FeedbackEntry): string {
  const lines = [`Rating: ${entry.rating ? `${entry.rating}/5` : "-"}`, `Category: ${entry.category}`, `Language: ${entry.locale}`, `Page: ${entry.page || "-"}`, "", entry.message];
  if (entry.email) lines.push("", `Reply to: ${entry.email}`);
  return lines.join("\n");
}

/** URL of GitHub's "new issue" form with the feedback prefilled (the title prefix is what to filter on). */
export function githubIssueUrl(repo: string, entry: FeedbackEntry): string {
  const title = `[${entry.category}] Feedback from ${SITE_NAME}`;
  const params = new URLSearchParams({ title, body: formatFeedback(entry) });
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

/** mailto: link with the feedback prefilled. */
export function mailtoUrl(email: string, entry: FeedbackEntry): string {
  const subject = `[${SITE_NAME}] ${entry.category} feedback`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formatFeedback(entry))}`;
}

/** Longest URL the email and GitHub channels can carry (mail clients and GitHub reject longer ones). */
export const URL_LIMITS = { email: 1800, github: 7000 } as const;

/**
 * The email and GitHub channels carry the whole message in a URL, where non-ASCII text grows
 * several times when percent-encoded. Shortens the message until the URL fits the limit.
 */
export function fitUrl(build: (entry: FeedbackEntry) => string, entry: FeedbackEntry, limit: number): { url: string; shortened: boolean } {
  let url = build(entry);
  if (url.length <= limit) return { url, shortened: false };
  let message = entry.message;
  while (url.length > limit && message.length > 40) {
    message = message.slice(0, Math.floor(message.length * 0.8)).trimEnd();
    url = build({ ...entry, message: `${message}… [message shortened]` });
  }
  return { url, shortened: true };
}

export default function FeedbackForm() {
  const t = useTranslations("Feedback");
  const locale = useLocale();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("general");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  // Link shown on the success screen for the email/GitHub channels, in case nothing opened.
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() || status === "sending") return;
    const entry: FeedbackEntry = { rating, category, message: message.trim(), email: email.trim(), locale, page: typeof window !== "undefined" ? window.location.href : "" };
    setStatus("sending");
    try {
      if (FEEDBACK_CHANNEL === "endpoint") {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(entry),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else if (FEEDBACK_CHANNEL === "email") {
        const { url } = fitUrl((e) => mailtoUrl(EMAIL, e), entry, URL_LIMITS.email);
        setManualUrl(url);
        window.location.href = url;
      } else if (FEEDBACK_CHANNEL === "github") {
        const { url } = fitUrl((e) => githubIssueUrl(GITHUB_REPO, e), entry, URL_LIMITS.github);
        setManualUrl(url);
        // No "noopener" in the feature string: with it window.open always returns null, which
        // would look like a blocked pop-up. The opener is severed by hand instead, and the
        // success screen offers the link for the case where the pop-up really was blocked.
        const popup = window.open(url, "_blank");
        if (popup) popup.opener = null;
      } else {
        throw new Error("No feedback channel configured");
      }
      setStatus("success");
    } catch (err) {
      console.error("Feedback submission failed:", err);
      setStatus("error");
    }
  };

  const successText = FEEDBACK_CHANNEL === "email" ? t("successEmail") : FEEDBACK_CHANNEL === "github" ? t("successGithub") : t("successMessage", { siteName: SITE_NAME });
  const submitLabel = FEEDBACK_CHANNEL === "email" ? t("submitEmail") : FEEDBACK_CHANNEL === "github" ? t("submitGithub") : t("submit");

  if (status === "success") {
    return (
      <div className="flex flex-col items-start gap-4 py-4">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-ok/40 bg-ok/10 text-ok" aria-hidden="true">
          <IconCheck size={20} />
        </span>
        <h2 className="text-xl font-bold text-ink">{t("successTitle")}</h2>
        <p className="max-w-[56ch] text-md text-ink-2">{successText}</p>
        {manualUrl && (
          <a href={manualUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong">
            {t("openManually")}
            <IconExternal size={14} />
          </a>
        )}
        <Button
          variant="secondary"
          size="md"
          className="mt-2"
          onClick={() => {
            setStatus("idle");
            setMessage("");
            setRating(0);
            setManualUrl(null);
          }}
        >
          {t("sendAnother")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      <fieldset>
        <legend className="text-sm font-medium text-ink-2">{t("ratingLabel")}</legend>
        <div className="mt-3 flex gap-1" onMouseLeave={() => setHoverRating(0)}>
          {[1, 2, 3, 4, 5].map((n) => {
            const lit = (hoverRating || rating) >= n;
            return (
              <button
                type="button"
                key={n}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHoverRating(n)}
                aria-label={`${n}/5`}
                aria-pressed={rating === n}
                className={cx("inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-150 hover:bg-surface-2 cursor-pointer [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11", lit ? "text-accent" : "text-ink-3")}
              >
                <IconStar size={22} filled={lit} />
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium text-ink-2">{t("categoryLabel")}</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Chip key={c} pressed={category === c} onClick={() => setCategory(c)}>
              {t(`category_${c}`)}
            </Chip>
          ))}
        </div>
      </fieldset>
      <Field label={t("messageLabel")} htmlFor="feedback-message">
        <textarea id="feedback-message" required rows={6} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("messagePlaceholder")} className={textareaClass} />
      </Field>
      <Field
        label={
          <>
            {t("emailLabel")} <span className="font-normal text-ink-3">({t("optional")})</span>
          </>
        }
        htmlFor="feedback-email"
      >
        <input id="feedback-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPlaceholder")} maxLength={200} className={inputClass} />
      </Field>
      {FEEDBACK_CHANNEL === "none" && (
        <p className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 text-sm text-warn" role="status">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          <span>{t("notConfigured")}</span>
        </p>
      )}
      {status === "error" && (
        <p className="flex items-start gap-2 text-sm text-danger" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          <span>{t("errorMessage")}</span>
        </p>
      )}
      <div className="border-t border-line pt-6">
        <Button type="submit" variant="primary" size="md" className="w-full sm:w-auto" disabled={status === "sending" || !message.trim() || FEEDBACK_CHANNEL === "none"}>
          {status === "sending" ? t("sending") : submitLabel}
        </Button>
      </div>
    </form>
  );
}
