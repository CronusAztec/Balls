"use client";

import { useTranslations } from "next-intl";
import Accordion from "./Accordion";
import { SITE_NAME } from "@/lib/site";
import { FAQ_KEYS } from "@/lib/faq";

/* The FAQ – --- site-redesign --- two columns of accordion rows from 1024 px (the JSON-LD stays on the landing page). */
export default function FAQ() {
  const t = useTranslations("FAQ");
  const headings = useTranslations("Headings");
  const v = { siteName: SITE_NAME };
  return (
    <section id="faq" className="border-t border-line scroll-mt-20" aria-labelledby="faq-title">
      <div className="site-container py-16 sm:py-20">
        <h2 id="faq-title" className="mb-10 text-2xl font-bold text-ink">
          {headings("faq")}
        </h2>
        <Accordion columns={2} items={FAQ_KEYS.map((k) => ({ question: t(`${k}.question`, v), answer: t(`${k}.answer`, v) }))} />
      </div>
    </section>
  );
}
