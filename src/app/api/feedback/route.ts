import { NextResponse } from "next/server";
import { appendFile, mkdir } from "fs/promises";
import path from "path";

/**
 * Receives feedback from the /feedback form.
 *
 * - When FEEDBACK_WEBHOOK_URL is set, the payload is POSTed there as JSON (Slack/Discord/
 *   Zapier/your own service).
 * - Otherwise it is appended to ./data/feedback.jsonl on the server (git-ignored).
 *
 * A tiny in-memory rate limit protects the endpoint from accidental floods.
 */

const CATEGORIES = new Set(["general", "bug", "feature", "design", "other"]);
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) return true;
  list.push(now);
  hits.set(key, list);
  return false;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });
  const rating = typeof body.rating === "number" && body.rating >= 0 && body.rating <= 5 ? Math.round(body.rating) : 0;
  const category = typeof body.category === "string" && CATEGORIES.has(body.category) ? body.category : "general";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";
  const locale = typeof body.locale === "string" ? body.locale.slice(0, 10) : "";
  const page = typeof body.page === "string" ? body.page.slice(0, 500) : "";
  const entry = { receivedAt: new Date().toISOString(), rating, category, message, email, locale, page, userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? "" };

  const webhook = process.env.FEEDBACK_WEBHOOK_URL;
  try {
    if (webhook) {
      const res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) });
      if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
    } else {
      const dir = path.join(process.cwd(), "data");
      await mkdir(dir, { recursive: true });
      await appendFile(path.join(dir, "feedback.jsonl"), JSON.stringify(entry) + "\n", "utf8");
    }
  } catch (err) {
    console.error("Failed to store feedback:", err);
    return NextResponse.json({ error: "Failed to store feedback" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
