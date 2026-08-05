import crypto from "node:crypto";

/**
 * Turns a stream of alerts into a small number of notifications.
 *
 * The mailbox problem is that one broken thing fires the same alert on every
 * tick: fifty identical emails say nothing more than the first one. Alerts are
 * therefore grouped by a fingerprint of *what broke*, not of the exact text, and
 * only the first occurrence in a window is delivered — with the suppressed count
 * attached to the next one that gets through.
 */

export const DEFAULT_DEDUPE_MINUTES = 120;

/** Volatile fragments that make two instances of the same failure look different. */
const NOISE = [
  // Absolute paths, then line/column suffixes left behind by stack frames.
  [/(?:\/[\w.@ -]+){2,}\.(?:js|mjs|cjs|ts|tsx|json)/g, "<path>"],
  [/:\d+:\d+/g, ":<pos>"],
  [/\b[0-9a-f]{7,}\b/gi, "<hex>"],
  [/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?\b/g, "<timestamp>"],
  [/\bhttps?:\/\/\S+/g, "<url>"],
  [/\b\d[\d.,]*\b/g, "<n>"],
  [/\s+/g, " "]
];

/**
 * Normalizes an alert message so that the same failure about different jobs,
 * URLs or timestamps collapses into one group.
 */
export function normalizeAlertMessage(message) {
  let text = String(message ?? "").trim();
  // Only the first stack line identifies the failure; frames below it repeat.
  const firstFrame = text.indexOf("\n    at ");
  if (firstFrame > 0) text = text.slice(0, firstFrame);
  for (const [pattern, replacement] of NOISE) text = text.replace(pattern, replacement);
  return text.toLowerCase().slice(0, 500);
}

/**
 * Stable identity of an alert: same command, same status, same normalized text.
 *
 * @returns {string} hex digest, safe to use as a primary key
 */
export function fingerprintAlert({ command = "", status = "", level = "", message = "" } = {}) {
  const canonical = [level, command, status, normalizeAlertMessage(message)].join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * Decides whether an alert should reach the user right now.
 *
 * @param {{notified_at: string|null, occurrences_since_notify: number}|null} previous
 * @param {number} windowMinutes  silence window after a delivered notification
 * @param {Date} now
 */
export function shouldNotify(previous, windowMinutes = DEFAULT_DEDUPE_MINUTES, now = new Date()) {
  if (!previous?.notified_at) return { notify: true, reason: "first_occurrence", suppressed: 0 };

  const elapsedMs = now.getTime() - new Date(previous.notified_at).getTime();
  const windowMs = Math.max(0, Number(windowMinutes) || 0) * 60_000;
  if (elapsedMs >= windowMs) {
    return { notify: true, reason: "window_elapsed", suppressed: previous.occurrences_since_notify || 0 };
  }
  return {
    notify: false,
    reason: "within_window",
    suppressed: previous.occurrences_since_notify || 0,
    retry_after_seconds: Math.ceil((windowMs - elapsedMs) / 1000)
  };
}
