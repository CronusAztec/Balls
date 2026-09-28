import { Fragment, type ReactNode } from "react";
import Link from "next/link";

/**
 * A deliberately small Markdown renderer for blog posts: headings (##, ###), paragraphs,
 * unordered/ordered lists, bold, italics, inline code, links and horizontal rules.
 * It renders React elements directly (no dangerouslySetInnerHTML), so post content can
 * never inject markup. Extend `renderInline` for more syntax.
 */

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

export function renderInline(text: string): ReactNode[] {
  const parts = text.split(INLINE_PATTERN);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = link[2];
      if (href.startsWith("/")) {
        // Site-internal link (written with its locale, e.g. /en/simulator): next/link adds the
        // base path and trailing slash of the static export.
        return (
          <Link key={i} href={href}>
            {link[1]}
          </Link>
        );
      }
      const external = /^https?:\/\//.test(href);
      return (
        <a key={i} href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
          {link[1]}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function renderMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(<p key={key++}>{renderInline(paragraph.join(" "))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{renderInline(item)}</li>);
    out.push(list.ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const content = renderInline(heading[2]);
      if (level <= 2) out.push(<h2 key={key++}>{content}</h2>);
      else if (level === 3) out.push(<h3 key={key++}>{content}</h3>);
      else out.push(<h4 key={key++}>{content}</h4>);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      out.push(<hr key={key++} />);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (trimmed.startsWith("> ")) {
      flushParagraph();
      flushList();
      out.push(<blockquote key={key++}>{renderInline(trimmed.slice(2))}</blockquote>);
      continue;
    }
    if (list) {
      // Continuation of the previous list item.
      list.items[list.items.length - 1] += " " + trimmed;
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return out;
}

export function formatPostDate(date: string, locale: string): string {
  const tag = locale === "pl" ? "pl-PL" : locale === "es" ? "es-ES" : "en-US";
  return new Date(date + "T00:00:00Z").toLocaleDateString(tag, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
