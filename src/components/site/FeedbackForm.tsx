"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SITE_NAME } from "@/lib/site";

const CATEGORIES = ["general", "bug", "feature", "design", "other"] as const;

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
    setStatus("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, category, message: message.trim(), email: email.trim(), locale, page: typeof window !== "undefined" ? window.location.href : "" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("success");
    } catch (err) {
      console.error("Feedback submission failed:", err);
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <div className="text-center space-y-4 py-10">
        <div className="text-5xl" aria-hidden="true">
          🎉
        </div>
        <h2 className="text-2xl font-bold text-white">{t("successTitle")}</h2>
        <p className="text-zinc-400 max-w-md mx-auto">{t("successMessage", { siteName: SITE_NAME })}</p>
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
      {status === "error" && <p className="text-sm text-red-400">{t("errorMessage")}</p>}
      <button
        type="submit"
        disabled={status === "sending" || !message.trim()}
        className="w-full sm:w-auto px-8 py-3.5 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-cyan-600 to-cyan-500 shadow-lg shadow-cyan-600/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        {status === "sending" ? t("sending") : t("submit")}
      </button>
    </form>
  );
}
