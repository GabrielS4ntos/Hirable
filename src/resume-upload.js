/**
 * Matching a stored résumé against the ones LinkedIn already has.
 *
 * The DOM side of this lives in the Easy Apply pipeline; everything here is
 * pure so the matching rules can be tested without a browser.
 *
 * The rules exist because LinkedIn does not show the filename verbatim: it
 * drops the extension, truncates long names with an ellipsis, and renders the
 * card as "name · uploaded on <date>". A plain equality check therefore misses
 * a résumé that is right there, and a loose "contains" check happily matches
 * "CV.pdf" against "CV_antigo_2019.pdf" — which would submit the wrong
 * document. What follows is the narrow path between those two failures.
 */

/** Shortest prefix that may stand in for a truncated name. */
const MIN_TRUNCATED_PREFIX = 12;

export function stripExtension(name) {
  return String(name ?? "").replace(/\.(pdf|docx?|rtf|txt|md)$/i, "");
}

/**
 * Canonical form for comparison: no extension, no accents, no separators,
 * lowercase. `Gabriel Santos-CV (1).pdf` and `gabriel_santos_cv_1` converge.
 */
export function normalizeResumeName(name) {
  return stripExtension(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Whether `candidate` — one entry as LinkedIn renders it — is our `target` file.
 *
 * Truncation is accepted only in the direction it actually happens: LinkedIn
 * shortens a long name, so a candidate that is a *prefix* of ours can be the
 * same document. The reverse ("CV" matching our "CV_antigo_2019") is refused,
 * because a short stored name would otherwise match half the list.
 */
export function resumeNameMatches(candidate, target) {
  const a = normalizeResumeName(candidate);
  const b = normalizeResumeName(target);
  if (!a || !b) return false;
  if (a === b) return true;

  // The ellipsis is the only signal that the text was cut short.
  const truncated = /[…]|\.\.\./.test(String(candidate));
  if (!truncated) return false;
  return a.length >= MIN_TRUNCATED_PREFIX && b.startsWith(a);
}

/**
 * Finds our résumé among the entries read from the expanded list.
 *
 * @param {string[]} entries  visible text of each résumé card
 * @param {string} target     original filename of the stored document
 * @returns {{index: number, text: string}|null}
 */
export function findResumeEntry(entries = [], target = "") {
  for (const [index, text] of entries.entries()) {
    if (resumeNameMatches(text, target)) return { index, text };
  }
  return null;
}

/** LinkedIn rejects anything else at the Easy Apply résumé step. */
export const UPLOADABLE_EXTENSIONS = Object.freeze([".pdf", ".doc", ".docx"]);
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Whether a stored document can be uploaded at all.
 *
 * Checked before navigating anywhere: discovering that a `.txt` résumé cannot
 * be attached is much cheaper before the application is half-submitted than in
 * the middle of the form.
 */
export function canUploadResume(resume, sizeBytes = resume?.size_bytes) {
  const name = String(resume?.original_name || "");
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();

  if (!UPLOADABLE_EXTENSIONS.includes(extension)) {
    return { ok: false, reason: "extensao_nao_aceita_pelo_linkedin", extension };
  }
  if (Number(sizeBytes) > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "arquivo_acima_de_2mb", size_bytes: Number(sizeBytes) };
  }
  return { ok: true, reason: null, extension };
}
