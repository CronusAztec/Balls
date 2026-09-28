import { SITE_NAME } from "@/lib/site";

/**
 * Blog posts. Each post has one entry per locale; `getPosts(locale)` falls back to English
 * when a translation is missing. Content is Markdown rendered by src/lib/markdown.tsx.
 * To add a post: append an object here (keep the slug identical across locales).
 */
export interface BlogPost {
  slug: string;
  locale: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  readingTime: string;
  tags: string[];
  content: string;
}

import { POSTS_EN } from "./blog.en";
import { POSTS_PL } from "./blog.pl";
import { POSTS_ES } from "./blog.es";

const ALL_POSTS: BlogPost[] = [...POSTS_EN, ...POSTS_PL, ...POSTS_ES];

export function getPosts(locale: string): BlogPost[] {
  const lang = locale.split("-")[0].toLowerCase();
  const localized = ALL_POSTS.filter((p) => p.locale === lang);
  const english = ALL_POSTS.filter((p) => p.locale === "en");
  // Localised where available, English otherwise (one entry per slug).
  const bySlug = new Map<string, BlogPost>();
  for (const p of english) bySlug.set(p.slug, p);
  for (const p of localized) bySlug.set(p.slug, p);
  return [...bySlug.values()].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getPost(locale: string, slug: string): BlogPost | undefined {
  return getPosts(locale).find((p) => p.slug === slug);
}

export function getAllSlugs(): string[] {
  return [...new Set(ALL_POSTS.map((p) => p.slug))];
}

export const BLOG_SITE_NAME = SITE_NAME;
