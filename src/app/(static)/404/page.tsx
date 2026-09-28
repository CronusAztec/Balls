import type { Metadata } from "next";
import NotFoundStatic from "@/components/site/NotFoundStatic";

export const metadata: Metadata = { title: "404" };

/** Exported to out/404/index.html and copied to out/404.html by scripts/postexport.mjs. */
export default function NotFoundPage() {
  return <NotFoundStatic />;
}
