/** Joins class names, skipping the falsy ones: cx("a", on && "b"). */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  return parts.filter(Boolean).join(" ");
}
