/**
 * Denylist matching for the external application destination.
 *
 * Matching is on the host, by domain and subdomain — never by substring of the
 * URL. Substring matching would make an entry for "example-website.ai" also block
 * "naoexample-website.com.br" and "example-website.ai.example.com", which is how a denylist turns
 * into a silent, unexplainable filter.
 */

/** Lowercase host with a leading `www.` removed, or null when the URL will not parse. */
export function registrableDomain(url) {
  const text = String(url || "").trim();
  if (!text) return null;
  try {
    const host = new URL(text).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The blocked entry that matched, or null. */
export function matchesBlockedDomain(url, blocked) {
  const host = registrableDomain(url);
  if (!host) return null;

  for (const entry of blocked || []) {
    // The entry may be typed as a bare domain or pasted as a full URL.
    const raw = String(entry || "").trim().toLowerCase();
    if (!raw) continue;
    const needle = registrableDomain(raw.includes("://") ? raw : `https://${raw}`);
    if (!needle) continue;
    if (host === needle || host.endsWith(`.${needle}`)) return needle;
  }
  return null;
}
