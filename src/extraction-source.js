import crypto from "node:crypto";

/**
 * Identity of what the profile extraction last read.
 *
 * Each run costs a model call, and re-running over the exact same résumé
 * produces the exact same fields — so the button that triggers it stays
 * disabled until the source actually changes. Comparing a hash rather than the
 * text itself keeps the stored marker small and means the résumé is not written
 * to a second place just to support the comparison.
 */

/** Whitespace-insensitive: a reflowed paste is not a new résumé. */
export function hashResumeText(text) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

/** Hash of the bytes on disk, so an edited file counts as a new source. */
export function hashResumeFile(content) {
  if (!content?.length) return "";
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
}

/**
 * Whether the extraction should be offered for this source.
 *
 * A different file always counts as new, even when its contents happen to
 * match: the user replacing the document is a deliberate act, and refusing to
 * act on it would look broken.
 */
export function extractionChanged(last, current) {
  if (!last?.hash) return true;
  if (current?.source === "file" && last.source === "file") {
    return last.resume_id !== current.resume_id || last.hash !== current.hash;
  }
  return last.hash !== current?.hash;
}
