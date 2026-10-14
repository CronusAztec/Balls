/**
 * Renders a JSON-LD structured-data script tag. `<` is written as \u003c (the same JSON): a value that carries `</script>` (the
 * operator's name or address come from build settings) must not be able to end the tag and open markup of its own.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
