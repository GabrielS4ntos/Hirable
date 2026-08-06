/**
 * Normalization of one LinkedIn result card.
 *
 * The pipeline used to flatten the whole card into innerText and hunt for
 * meaning with regexes, which is why work mode and posting date were effectively
 * unavailable. LinkedIn already renders both as their own elements, so the
 * scraper hands them over separately and this module only normalizes them.
 *
 * Nothing here guesses: an unreadable field becomes "unknown" or null, and the
 * prefilter decides what that means for the phase it is in.
 */

export const WORK_MODES = ["remote", "hybrid", "onsite", "unknown"];

const HYBRID = /h[íi]brid|hybrid/i;
const REMOTE = /remot/i;
const ONSITE = /presencial|on-?site|no local/i;

/**
 * Hybrid is checked first on purpose: a hybrid vacancy almost always also says
 * "remoto" somewhere ("híbrido, 2 dias remoto"), and reading that as fully
 * remote is exactly how an on-site job reached a remote-only profile.
 */
export function parseWorkMode(text) {
  const value = String(text || "");
  if (!value.trim()) return "unknown";
  if (HYBRID.test(value)) return "hybrid";
  if (ONSITE.test(value)) return "onsite";
  if (REMOTE.test(value)) return "remote";
  return "unknown";
}

const UNITS = [
  { pattern: /(minuto|minute)/i, ms: 60 * 1000 },
  { pattern: /(hora|hour)/i, ms: 60 * 60 * 1000 },
  { pattern: /(dia|day)/i, ms: 24 * 60 * 60 * 1000 },
  { pattern: /(semana|week)/i, ms: 7 * 24 * 60 * 60 * 1000 },
  { pattern: /(m[êe]s|mes|month)/i, ms: 30 * 24 * 60 * 60 * 1000 },
  { pattern: /(ano|year)/i, ms: 365 * 24 * 60 * 60 * 1000 }
];

/**
 * Posting time, preferring the machine-readable attribute.
 *
 * Returns null when neither source parses. Null must never be treated as fresh:
 * deciding freshness on a guess is how months-old vacancies kept coming back.
 */
export function parsePostedAt(datetimeAttribute, label, now = new Date()) {
  const attribute = String(datetimeAttribute || "").trim();
  if (attribute) {
    const parsed = new Date(attribute);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const text = String(label || "").trim();
  if (!text) return null;

  const amount = Number(/(\d+)/.exec(text)?.[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = UNITS.find((item) => item.pattern.test(text));
  if (!unit) return null;

  return new Date(now.getTime() - amount * unit.ms).toISOString();
}

function clean(value, limit = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

/**
 * @param {object} raw            fields handed over by the DOM scrape
 * @param {object} options
 * @param {string} options.searchName  which configured search produced the card
 * @param {Date} options.now
 * @returns {object|null}  null when the card carries no job id
 */
export function normalizeJobCard(raw, { searchName = "", now = new Date() } = {}) {
  const externalId = String(raw?.external_id || "").trim();
  if (!externalId) return null;

  const text = clean(raw?.text, 500);
  // The badge is authoritative when present; the card text is the fallback,
  // and "unknown" is a real answer that promotes the job to enrichment.
  const workMode = raw?.work_mode_label
    ? parseWorkMode(raw.work_mode_label)
    : parseWorkMode(`${raw?.location || ""} ${text}`);

  return {
    search_name: clean(searchName, 120),
    external_id: externalId,
    url: clean(raw?.url, 2000),
    apply_url: clean(raw?.apply_url, 2000)
      || `https://www.linkedin.com/jobs/view/${externalId}/apply/?openSDUIApplyFlow=true`,
    title: clean(raw?.title, 200),
    company: clean(raw?.company, 200),
    location: clean(raw?.location, 160),
    work_mode: workMode,
    posted_at: parsePostedAt(raw?.posted_datetime, raw?.posted_label, now),
    easy_apply: Boolean(raw?.easy_apply),
    applied: Boolean(raw?.applied),
    sponsored: Boolean(raw?.sponsored),
    compact_text: text
  };
}
