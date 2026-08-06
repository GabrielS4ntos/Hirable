/**
 * Layer 1 of the jobs filter: LinkedIn's own search parameters.
 *
 * These filter on the structured fields of the posting, not on its text, which
 * is why they are immune to the language the vacancy was written in — the
 * problem that made the previous regex-based filters unreliable.
 *
 * Layer 1 is an optimization, never a guarantee: these parameters are public
 * and long-lived but they are not a contract, so everything decided here is
 * re-checked against the enriched posting in layer 3.
 */

export const LINKEDIN_JOBS_SEARCH_BASE = "https://www.linkedin.com/jobs/search/";

const LINKEDIN_JOBS_URL = /^https:\/\/(www\.)?linkedin\.com\/jobs\//i;

/** Experience levels: 1 internship, 2 entry, 3 associate, 4 mid-senior, 5 director, 6 executive. */
const INDIVIDUAL_CONTRIBUTOR_LEVELS = "2,3,4";

/** Remote. 1 is on-site and 3 is hybrid; neither is set unless the user asks for them. */
const WORK_TYPE_REMOTE = "2";

export function isRemoteOnly(profile) {
  const value = profile?.work_eligibility?.remote_only;
  return value === true || value === "sim";
}

/**
 * Adds the parameters the caller wants without touching the ones already there.
 *
 * A URL the user pasted is a deliberate instruction: if they narrowed the search
 * themselves, silently widening or narrowing it further would make the interface
 * lie about what is being searched. Only absent parameters are filled in.
 */
export function normalizeSearchUrl(url, { remoteOnly = false, freshnessDays = 7, excludeExecutive = true } = {}) {
  const text = String(url || "").trim();
  if (!LINKEDIN_JOBS_URL.test(text)) {
    throw new Error(`URL de busca precisa ser do linkedin.com/jobs: ${text || "(vazia)"}`);
  }

  const parsed = new URL(text);
  const fill = (key, value) => {
    if (value !== null && value !== undefined && !parsed.searchParams.has(key)) {
      parsed.searchParams.set(key, String(value));
    }
  };

  // Newest first, so crossing the freshness horizon is a valid reason to stop
  // scrolling instead of a filter applied after the fact.
  fill("sortBy", "DD");

  const seconds = Math.max(1, Math.round(Number(freshnessDays) || 1)) * 86400;
  fill("f_TPR", `r${seconds}`);

  if (remoteOnly) fill("f_WT", WORK_TYPE_REMOTE);
  if (excludeExecutive) fill("f_E", INDIVIDUAL_CONTRIBUTOR_LEVELS);

  // f_AL (Easy Apply only) is deliberately never set: the digest exists to hand
  // over the vacancies that cannot be submitted automatically, so filtering them
  // out of the search would remove the pipeline's whole second half.

  return parsed.toString();
}

/**
 * The searches for one run.
 *
 * Configured searches win when present; otherwise one search per target role in
 * the profile, so adding a role in the profile screen is enough to widen the
 * scan without anyone assembling a LinkedIn URL by hand.
 */
export function buildSearchUrls(profile, config) {
  const options = {
    remoteOnly: isRemoteOnly(profile),
    freshnessDays: Number(config?.jobs_watcher?.freshness_days) || 7,
    excludeExecutive: true
  };

  const configured = Array.isArray(config?.jobs_watcher?.searches) ? config.jobs_watcher.searches : [];
  const sources = configured.length > 0
    ? configured.map((item) => ({ name: item?.name || "", url: item?.url || "" }))
    : (profile?.professional?.target_roles || []).map((role) => ({
      name: String(role),
      url: `${LINKEDIN_JOBS_SEARCH_BASE}?keywords=${encodeURIComponent(String(role))}`
    }));

  const searches = [];
  for (const source of sources) {
    const name = String(source.name || "").trim();
    if (!name && !source.url) continue;
    try {
      searches.push({ name: name || "busca", url: normalizeSearchUrl(source.url, options) });
    } catch {
      // A stored search that no longer parses must not take the whole run down.
    }
  }
  return searches;
}
