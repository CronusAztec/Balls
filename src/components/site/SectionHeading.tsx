/** Badge + big heading used by the editorial sections and content pages. */
export default function SectionHeading({ badge, title, description, as: Tag = "h2" }: { badge: string; title: string; description?: string; as?: "h1" | "h2" }) {
  return (
    <div className="mb-8 text-center">
      <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
        <span className="w-2 h-2 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500" />
        {badge}
      </span>
      <Tag className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-50">{title}</Tag>
      {description && <p className="mt-3 text-slate-400 max-w-xl mx-auto leading-relaxed">{description}</p>}
    </div>
  );
}
