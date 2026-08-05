/**
 * SHA-256 of the pasted résumé, matching `hashResumeText` on the server.
 *
 * Both sides normalize whitespace and keep the same 32 hex characters, so the
 * marker the server stores after an extraction can be compared here without a
 * round trip on every keystroke.
 *
 * SubtleCrypto needs a secure context; 127.0.0.1 and localhost qualify, which
 * is everywhere this console runs. The fallback exists so a stray deployment
 * degrades to "always offer the button" rather than to a broken screen.
 */
export async function sha256Hex(text: string): Promise<string> {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (!globalThis.crypto?.subtle) return `plain:${normalized.length}`;

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
