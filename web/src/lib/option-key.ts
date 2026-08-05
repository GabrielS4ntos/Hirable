/**
 * Accent- and case-insensitive key for matching a stored value against a
 * curated option list. Mirrors `optionKey` in `src/profile-schema.js`, so the
 * interface and the server agree on when a value *is* one of the options.
 */
export function optionKey(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
