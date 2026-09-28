"use client";

import { useTranslations } from "next-intl";
import Accordion from "./Accordion";
import { SITE_NAME } from "@/lib/site";
import { FAQ_KEYS } from "@/lib/faq";

export default function FAQ() {
  const t = useTranslations("FAQ");
  const headings = useTranslations("Headings");
  const v = { siteName: SITE_NAME };
  return (
    <section id="faq" className="w-full max-w-3xl mx-auto mt-16 px-4 scroll-mt-16">
      <h2 className="text-2xl font-bold text-white mb-8 text-center">{headings("faq")}</h2>
      <Accordion compact items={FAQ_KEYS.map((k) => ({ question: t(`${k}.question`, v), answer: t(`${k}.answer`, v) }))} />
    </section>
  );
}
