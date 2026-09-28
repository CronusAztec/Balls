"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SITE_NAME } from "@/lib/site";

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

/** URL of GitHub's "new issue" form with the feedback prefilled. */
export function githubIssueUrl(repo: string, entry: FeedbackEntry): string {
  const title = `[${entry.category}] Feedback from ${SITE_NAME}`;
  const params = new URLSearchParams({ title, body: formatFeedback(entry), labels: "feedback" });
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

/** mailto: link with the feedback prefilled. */
export function mailtoUrl(email: string, entry: FeedbackEntry): string {
  const subject = `[${SITE_NAME}] ${entry.category} feedback`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formatFeedback(entry))}`;
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
        window.location.href = mailtoUrl(EMAIL, entry);
      } else if (FEEDBACK_CHANNEL === "github") {
        const popup = window.open(githubIssueUrl(GITHUB_REPO, entry), "_blank", "noopener,noreferrer");
        if (popup === null && typeof window.open === "function") {
          // Pop-up blocked: navigate in place instead so the feedback is not lost.
          window.location.href = githubIssueUrl(GITHUB_REPO, entry);
        }
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
      <div className="text-center space-y-4 py-10">
        <div className="text-5xl" aria-hidden="true">
          🎉
        </div>
        <h2 className="text-2xl font-bold text-white">{t("successTitle")}</h2>
        <p className="text-zinc-400 max-w-md mx-auto">{successText}</p>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setMessage("");
            setRating(0);
          }}
          className="mt-2 px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-colors cursor-pointer"
        >
          {t("sendAnother")}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset>
        <legend className="text-sm font-medium text-zinc-300 mb-2">{t("ratingLabel")}</legend>
        <div className="flex gap-1" onMouseLeave={() => setHoverRating(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHoverRating(n)}
              aria-label={`${n}/5`}
              aria-pressed={rating === n}
              className={`text-3xl transition-transform hover:scale-110 cursor-pointer ${(hoverRating || rating) >= n ? "grayscale-0" : "grayscale opacity-40"}`}
            >
              ⭐
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="text-sm font-medium text-zinc-300 mb-2 block">{t("categoryLabel")}</label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${category === c ? "bg-[#93d119] text-slate-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
            >
              {t(`category_${c}`)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="feedback-message" className="text-sm font-medium text-zinc-300 mb-2 block">
          {t("messageLabel")}
        </label>
        <textarea
          id="feedback-message"
          required
          rows={6}
          maxLength={4000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("messagePlaceholder")}
          className="w-full px-4 py-3 bg-zinc-800 text-white rounded-xl border border-zinc-700 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 text-sm resize-y"
        />
      </div>
      <div>
        <label htmlFor="feedback-email" className="text-sm font-medium text-zinc-300 mb-2 block">
          {t("emailLabel")} <span className="text-zinc-500 font-normal">({t("optional")})</span>
        </label>
        <input
          id="feedback-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          maxLength={200}
          className="w-full px-4 py-3 bg-zinc-800 text-white rounded-xl border border-zinc-700 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 text-sm"
        />
      </div>
      {FEEDBACK_CHANNEL === "none" && (
        <p className="text-sm text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3" role="status">
          {t("notConfigured")}
        </p>
      )}
      {status === "error" && <p className="text-sm text-red-400">{t("errorMessage")}</p>}
      <button
        type="submit"
        disabled={status === "sending" || !message.trim() || FEEDBACK_CHANNEL === "none"}
        className="w-full sm:w-auto px-8 py-3.5 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-cyan-600 to-cyan-500 shadow-lg shadow-cyan-600/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        {status === "sending" ? t("sending") : submitLabel}
      </button>
    </form>
  );
}
