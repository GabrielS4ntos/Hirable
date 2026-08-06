# Jobs Pipeline: Layered Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the jobs pipeline's hardcoded text filters with four explicit layers — LinkedIn search parameters, a minimal local prefilter, LLM judgement over the enriched job description, and a deterministic eligibility veto — and turn the digest email into an actionable list.

**Architecture:** Today every decision is made from `compact_text`, 500 characters scraped off a result card, and the pipeline never opens the job page. Each filtering criterion moves to the layer that actually holds the data for it. Three new pure modules (`job-search-url.js`, `job-card.js`, `job-prefilter.js`) plus a domain matcher come out of `cli.js` and are unit-testable without a browser; `runJobsScan` becomes a four-phase orchestrator over them.

**Tech Stack:** Node 22 ESM, `node:sqlite`, `node:test`, Playwright, React/Vite/Tailwind console in `web/`.

**Spec:** `docs/superpowers/specs/2026-08-06-jobs-pipeline-layered-filtering-design.md`

## Global Constraints

- Node 22 ESM only. No new npm dependencies.
- **Every new `src/*.test.js` MUST be added to the `test` script in `package.json`** — a test file not listed there does not run.
- Verification for any task touching `src/*.js`: `node --check <file>` then `npm test`. Tasks touching `web/`: also `npx tsc --noEmit` inside `web/`.
- `SAFETY` in `src/config-defaults.js` is never widened, never made editable, and never moved into the database.
- Secrets never reach the client. Any new client-facing payload field must stay covered by the regression test in `src/integrations.test.js`.
- UI text is bilingual: every key added to `web/src/lib/i18n.tsx` goes into **both** the `pt-BR` and the `en` map. Portuguese strings are written with accents (a test asserts no unaccented placeholders).
- Comments explain *why* a constraint exists, not what the line does.
- Any invariant must hold in the CLI, the HTTP API and the scheduler — all three reach these paths independently.
- Commit after every task. Use `rtk git ...` per the repository's CLAUDE.md.

---

### Task 1: Search URL builder

Layer 1. Pushes work mode, freshness, seniority and sort order into LinkedIn's own query parameters, which filter on structured job fields rather than text and are therefore language-independent.

**Files:**
- Create: `src/job-search-url.js`
- Test: `src/job-search-url.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `normalizeSearchUrl(url: string, options: {remoteOnly: boolean, freshnessDays: number, excludeExecutive: boolean}) => string`
  - `buildSearchUrls(profile: object, config: object) => Array<{name: string, url: string}>`
  - `LINKEDIN_JOBS_SEARCH_BASE: string`

- [ ] **Step 1: Write the failing test**

Create `src/job-search-url.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchUrl, buildSearchUrls } from "./job-search-url.js";

const OPTIONS = { remoteOnly: true, freshnessDays: 7, excludeExecutive: true };

test("injects sort, freshness and remote parameters", () => {
  const url = new URL(normalizeSearchUrl("https://www.linkedin.com/jobs/search/?keywords=node", OPTIONS));
  assert.equal(url.searchParams.get("sortBy"), "DD");
  assert.equal(url.searchParams.get("f_TPR"), "r604800");
  assert.equal(url.searchParams.get("f_WT"), "2");
  assert.equal(url.searchParams.get("keywords"), "node");
});

test("never sets f_AL: Easy Apply filtering would hide the jobs the digest exists for", () => {
  const url = new URL(normalizeSearchUrl("https://www.linkedin.com/jobs/search/?keywords=node", OPTIONS));
  assert.equal(url.searchParams.get("f_AL"), null);
});

test("a parameter the user pasted is preserved, not overwritten", () => {
  const pasted = "https://www.linkedin.com/jobs/search/?keywords=node&f_WT=1,3&f_TPR=r86400";
  const url = new URL(normalizeSearchUrl(pasted, OPTIONS));
  assert.equal(url.searchParams.get("f_WT"), "1,3");
  assert.equal(url.searchParams.get("f_TPR"), "r86400");
  // sortBy was absent, so it is still injected.
  assert.equal(url.searchParams.get("sortBy"), "DD");
});

test("work mode is left open when the profile is not remote-only", () => {
  const url = new URL(normalizeSearchUrl(
    "https://www.linkedin.com/jobs/search/?keywords=node",
    { ...OPTIONS, remoteOnly: false }
  ));
  assert.equal(url.searchParams.get("f_WT"), null);
});

test("excludes director and executive experience levels", () => {
  const url = new URL(normalizeSearchUrl("https://www.linkedin.com/jobs/search/?keywords=node", OPTIONS));
  assert.equal(url.searchParams.get("f_E"), "2,3,4");
});

test("a non-LinkedIn URL is rejected rather than navigated to", () => {
  assert.throws(() => normalizeSearchUrl("https://example.com/jobs", OPTIONS), /linkedin/i);
});

test("derives one search per target role when no manual search is configured", () => {
  const profile = {
    professional: { target_roles: ["Backend Engineer", "AI Engineer"] },
    work_eligibility: { remote_only: true }
  };
  const config = { jobs_watcher: { searches: [], freshness_days: 7 } };
  const searches = buildSearchUrls(profile, config);

  assert.deepEqual(searches.map((item) => item.name), ["Backend Engineer", "AI Engineer"]);
  for (const search of searches) {
    assert.equal(new URL(search.url).searchParams.get("f_WT"), "2");
    assert.equal(new URL(search.url).searchParams.get("sortBy"), "DD");
  }
  assert.equal(new URL(searches[0].url).searchParams.get("keywords"), "Backend Engineer");
});

test("manual searches replace the derived ones but still get the missing parameters", () => {
  const profile = {
    professional: { target_roles: ["Backend Engineer"] },
    work_eligibility: { remote_only: true }
  };
  const config = {
    jobs_watcher: {
      searches: [{ name: "minha busca", url: "https://www.linkedin.com/jobs/search/?keywords=go" }],
      freshness_days: 7
    }
  };
  const searches = buildSearchUrls(profile, config);

  assert.equal(searches.length, 1);
  assert.equal(searches[0].name, "minha busca");
  assert.equal(new URL(searches[0].url).searchParams.get("keywords"), "go");
  assert.equal(new URL(searches[0].url).searchParams.get("sortBy"), "DD");
});

test("remote_only accepts the Portuguese tristate value", () => {
  const profile = {
    professional: { target_roles: ["Backend"] },
    work_eligibility: { remote_only: "sim" }
  };
  const searches = buildSearchUrls(profile, { jobs_watcher: { searches: [], freshness_days: 7 } });
  assert.equal(new URL(searches[0].url).searchParams.get("f_WT"), "2");
});

test("a profile with no target roles and no manual search yields nothing", () => {
  assert.deepEqual(buildSearchUrls({}, { jobs_watcher: { searches: [], freshness_days: 7 } }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/job-search-url.test.js`
Expected: FAIL — `Cannot find module './job-search-url.js'`

- [ ] **Step 3: Write the implementation**

Create `src/job-search-url.js`:

```js
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
```

- [ ] **Step 4: Register the test file**

In `package.json`, append ` src/job-search-url.test.js` to the end of the `test` script value. Without this the file is never executed by `npm test`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --check src/job-search-url.js && node --test src/job-search-url.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
rtk git add src/job-search-url.js src/job-search-url.test.js package.json && \
rtk git commit -m "$(cat <<'EOF'
Empurre modalidade, frescor e senioridade para a URL de busca

Filtro de parâmetro roda no servidor do LinkedIn sobre os campos do anúncio,
não sobre o texto, então não depende do idioma em que a vaga foi escrita.
URL colada pelo usuário só recebe o que falta: se ele estreitou a busca de
propósito, alargá-la em silêncio faria a interface mentir sobre o que busca.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Card normalizer

Turns the raw DOM scrape of one result card into the canonical job shape, with a real `work_mode` and `posted_at` instead of the current heuristic over flattened `innerText`.

**Files:**
- Create: `src/job-card.js`
- Test: `src/job-card.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `WORK_MODES: ["remote", "hybrid", "onsite", "unknown"]`
  - `parseWorkMode(text: string) => "remote"|"hybrid"|"onsite"|"unknown"`
  - `parsePostedAt(datetimeAttribute: string|null, label: string|null, now: Date) => string|null` (ISO 8601)
  - `normalizeJobCard(raw: object, options: {searchName: string, now: Date}) => object` returning
    `{search_name, external_id, url, apply_url, title, company, location, work_mode, posted_at, easy_apply, applied, sponsored, compact_text}`

- [ ] **Step 1: Write the failing test**

Create `src/job-card.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkMode, parsePostedAt, normalizeJobCard } from "./job-card.js";

const NOW = new Date("2026-08-06T12:00:00.000Z");

test("reads work mode in both languages", () => {
  assert.equal(parseWorkMode("Remoto"), "remote");
  assert.equal(parseWorkMode("Remote"), "remote");
  assert.equal(parseWorkMode("Híbrido"), "hybrid");
  assert.equal(parseWorkMode("Hybrid"), "hybrid");
  assert.equal(parseWorkMode("Presencial"), "onsite");
  assert.equal(parseWorkMode("On-site"), "onsite");
});

test("an unreadable work mode is unknown, never a guess", () => {
  assert.equal(parseWorkMode("São Paulo, Brasil"), "unknown");
  assert.equal(parseWorkMode(""), "unknown");
  assert.equal(parseWorkMode(null), "unknown");
});

test("hybrid wins over remote when both words appear", () => {
  // "Híbrido - trabalho remoto parcial" must not be read as fully remote.
  assert.equal(parseWorkMode("Híbrido - trabalho remoto parcial"), "hybrid");
});

test("the datetime attribute wins over the relative label", () => {
  const iso = parsePostedAt("2026-08-01T09:00:00.000Z", "há 3 dias", NOW);
  assert.equal(iso, "2026-08-01T09:00:00.000Z");
});

test("falls back to the relative label in both languages", () => {
  assert.equal(parsePostedAt(null, "há 3 dias", NOW), "2026-08-03T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "3 days ago", NOW), "2026-08-03T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "2 semanas atrás", NOW), "2026-07-23T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "1 month ago", NOW), "2026-07-07T12:00:00.000Z");
  assert.equal(parsePostedAt(null, "há 5 horas", NOW), "2026-08-06T07:00:00.000Z");
});

test("an unreadable date is null, so freshness cannot be decided on a guess", () => {
  assert.equal(parsePostedAt(null, "recentemente", NOW), null);
  assert.equal(parsePostedAt(null, null, NOW), null);
});

test("normalizes a full card", () => {
  const card = normalizeJobCard({
    external_id: "4321",
    url: "https://www.linkedin.com/jobs/view/4321/?trackingId=abc",
    apply_url: "",
    title: "Senior Backend Engineer",
    company: "Acme",
    location: "Brasil",
    work_mode_label: "Remoto",
    posted_datetime: null,
    posted_label: "há 2 dias",
    easy_apply: true,
    applied: false,
    sponsored: false,
    text: "Senior Backend Engineer\nAcme\nBrasil (Remoto)\nCandidatura simplificada"
  }, { searchName: "Backend", now: NOW });

  assert.equal(card.external_id, "4321");
  assert.equal(card.search_name, "Backend");
  assert.equal(card.work_mode, "remote");
  assert.equal(card.posted_at, "2026-08-04T12:00:00.000Z");
  assert.equal(card.easy_apply, true);
  assert.equal(card.apply_url, "https://www.linkedin.com/jobs/view/4321/apply/?openSDUIApplyFlow=true");
  assert.equal(card.compact_text.length <= 500, true);
});

test("falls back to the card text when there is no work mode badge", () => {
  const card = normalizeJobCard({
    external_id: "9",
    url: "https://www.linkedin.com/jobs/view/9/",
    title: "Dev",
    company: "Acme",
    location: "Curitiba, PR",
    work_mode_label: "",
    posted_label: "há 1 dia",
    text: "Dev\nAcme\nCuritiba, PR (Presencial)"
  }, { searchName: "Dev", now: NOW });

  assert.equal(card.work_mode, "onsite");
});

test("a card with no id is rejected", () => {
  assert.equal(normalizeJobCard({ title: "Dev" }, { searchName: "x", now: NOW }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/job-card.test.js`
Expected: FAIL — `Cannot find module './job-card.js'`

- [ ] **Step 3: Write the implementation**

Create `src/job-card.js`:

```js
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
```

- [ ] **Step 4: Register the test file**

Append ` src/job-card.test.js` to the `test` script in `package.json`.

- [ ] **Step 5: Run tests**

Run: `node --check src/job-card.js && node --test src/job-card.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
rtk git add src/job-card.js src/job-card.test.js package.json && \
rtk git commit -m "$(cat <<'EOF'
Leia modalidade e data do card em vez de adivinhá-las no texto

O LinkedIn já renderiza as duas como elementos próprios; achatar o card em
innerText era o que tornava as duas indisponíveis. Híbrido é testado antes de
remoto porque vaga híbrida quase sempre também diz "remoto", e ler isso como
totalmente remota é como vaga presencial chegava a um perfil remote-only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Apply-domain matcher

The denylist for external application destinations. Split out because the substring-versus-domain distinction is the whole point and deserves its own tests.

**Files:**
- Create: `src/apply-domain.js`
- Test: `src/apply-domain.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `registrableDomain(url: string) => string|null` — lowercase host with `www.` stripped
  - `matchesBlockedDomain(url: string, blocked: string[]) => string|null` — the entry that matched, or null

- [ ] **Step 1: Write the failing test**

Create `src/apply-domain.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { registrableDomain, matchesBlockedDomain } from "./apply-domain.js";

test("normalizes the host", () => {
  assert.equal(registrableDomain("https://WWW.example-website.ai/jobs/123"), "example-website.ai");
  assert.equal(registrableDomain("http://boards.greenhouse.io/acme"), "boards.greenhouse.io");
});

test("a URL that does not parse has no domain", () => {
  assert.equal(registrableDomain("not a url"), null);
  assert.equal(registrableDomain(""), null);
  assert.equal(registrableDomain(null), null);
});

test("blocks the domain and its subdomains", () => {
  assert.equal(matchesBlockedDomain("https://example-website.ai/apply/9", ["example-website.ai"]), "example-website.ai");
  assert.equal(matchesBlockedDomain("https://jobs.example-website.ai/apply/9", ["example-website.ai"]), "example-website.ai");
  assert.equal(matchesBlockedDomain("https://www.example-website.ai/apply/9", ["example-website.ai"]), "example-website.ai");
});

test("does not block a domain that merely contains the string", () => {
  // The reason this module exists: substring matching would block this.
  assert.equal(matchesBlockedDomain("https://naoexample-website.com.br/apply", ["example-website.ai"]), null);
  assert.equal(matchesBlockedDomain("https://example-website.ai.example.com/apply", ["example-website.ai"]), null);
});

test("the blocked entry is normalized the same way as the URL", () => {
  assert.equal(matchesBlockedDomain("https://example-website.ai/x", ["  HTTPS://WWW.example-website.AI/  "]), "example-website.ai");
});

test("an empty or missing list blocks nothing", () => {
  assert.equal(matchesBlockedDomain("https://example-website.ai/x", []), null);
  assert.equal(matchesBlockedDomain("https://example-website.ai/x", null), null);
});

test("an unresolvable URL is not blocked", () => {
  // Failing open is deliberate: these jobs are never sent automatically.
  assert.equal(matchesBlockedDomain("", ["example-website.ai"]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/apply-domain.test.js`
Expected: FAIL — `Cannot find module './apply-domain.js'`

- [ ] **Step 3: Write the implementation**

Create `src/apply-domain.js`:

```js
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
```

- [ ] **Step 4: Register the test file**

Append ` src/apply-domain.test.js` to the `test` script in `package.json`.

- [ ] **Step 5: Run tests**

Run: `node --check src/apply-domain.js && node --test src/apply-domain.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
rtk git add src/apply-domain.js src/apply-domain.test.js package.json && \
rtk git commit -m "$(cat <<'EOF'
Case a lista de bloqueio por domínio, não por substring

Substring faria uma entrada "example-website.ai" bloquear também "naoexample-website.com.br" e
"example-website.ai.example.com" — é assim que uma lista de bloqueio vira um filtro
silencioso que ninguém consegue explicar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Structural prefilter

Layers 2 and 3's deterministic half. This is where the inversion bug and the permanent tombstone are fixed, and where "unknown" changes meaning by phase.

**Files:**
- Create: `src/job-prefilter.js`
- Test: `src/job-prefilter.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `matchesBlockedDomain` from `src/apply-domain.js` (Task 3); `isRemoteOnly` from `src/job-search-url.js` (Task 1).
- Produces:
  - `FILTER_STAGES = { SEARCH: "search", PREFILTER: "prefilter", ENRICHMENT: "enrichment", MODEL: "model", ELIGIBILITY: "eligibility", CAP: "cap" }`
  - `prefilterJob(job, context, options) => {pass: boolean, stage: string, code: string, reason: string}`
    where `context = {config, profile, state, now, quarantine}` and `options = {phase: "card"|"enriched"}`.
    `quarantine` is a `Map<string, string>` of `external_id -> blocked_until` ISO.

- [ ] **Step 1: Write the failing test**

Create `src/job-prefilter.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { prefilterJob, FILTER_STAGES } from "./job-prefilter.js";

const NOW = new Date("2026-08-06T12:00:00.000Z");

function baseJob(overrides = {}) {
  return {
    external_id: "1",
    title: "Senior Backend Engineer",
    company: "Acme",
    work_mode: "remote",
    posted_at: "2026-08-05T12:00:00.000Z",
    easy_apply: true,
    applied: false,
    apply_url: "https://www.linkedin.com/jobs/view/1/apply/",
    ...overrides
  };
}

function baseContext(overrides = {}) {
  return {
    config: {
      jobs_watcher: {
        easy_apply_enabled: true,
        read_only: false,
        freshness_days: 7,
        blocked_companies: [],
        blocked_apply_domains: []
      }
    },
    profile: { work_eligibility: { remote_only: true } },
    state: { jobs: { applications: {} } },
    quarantine: new Map(),
    now: NOW,
    ...overrides
  };
}

const CARD = { phase: "card" };
const ENRICHED = { phase: "enriched" };

test("a fresh remote job passes both phases", () => {
  assert.equal(prefilterJob(baseJob(), baseContext(), CARD).pass, true);
  assert.equal(prefilterJob(baseJob(), baseContext(), ENRICHED).pass, true);
});

test("easy_apply_enabled=false blocks instead of allowing", () => {
  // The previous implementation returned "no hard block" here, so turning Easy
  // Apply off made the pipeline apply. This test exists to keep that from
  // coming back.
  const context = baseContext();
  context.config.jobs_watcher.easy_apply_enabled = false;
  const result = prefilterJob(baseJob(), context, ENRICHED);
  assert.equal(result.pass, false);
  assert.equal(result.code, "easy_apply_disabled");
});

test("read_only blocks instead of allowing", () => {
  const context = baseContext();
  context.config.jobs_watcher.read_only = true;
  const result = prefilterJob(baseJob(), context, ENRICHED);
  assert.equal(result.pass, false);
  assert.equal(result.code, "read_only");
});

test("unknown work mode promotes on the card and rejects once enriched", () => {
  const job = baseJob({ work_mode: "unknown" });
  assert.equal(prefilterJob(job, baseContext(), CARD).pass, true);

  const enriched = prefilterJob(job, baseContext(), ENRICHED);
  assert.equal(enriched.pass, false);
  assert.equal(enriched.code, "work_mode_unknown");
});

test("hybrid and on-site are rejected in both phases for a remote-only profile", () => {
  for (const mode of ["hybrid", "onsite"]) {
    const job = baseJob({ work_mode: mode });
    assert.equal(prefilterJob(job, baseContext(), CARD).pass, false, mode);
    assert.equal(prefilterJob(job, baseContext(), CARD).code, "work_mode_not_remote");
  }
});

test("work mode is not filtered when the profile is not remote-only", () => {
  const context = baseContext({ profile: { work_eligibility: { remote_only: false } } });
  assert.equal(prefilterJob(baseJob({ work_mode: "onsite" }), context, ENRICHED).pass, true);
  assert.equal(prefilterJob(baseJob({ work_mode: "unknown" }), context, ENRICHED).pass, true);
});

test("a job older than the horizon is rejected", () => {
  const job = baseJob({ posted_at: "2026-07-01T12:00:00.000Z" });
  const result = prefilterJob(job, baseContext(), CARD);
  assert.equal(result.pass, false);
  assert.equal(result.code, "too_old");
});

test("unknown posting date promotes on the card and rejects once enriched", () => {
  const job = baseJob({ posted_at: null });
  assert.equal(prefilterJob(job, baseContext(), CARD).pass, true);
  assert.equal(prefilterJob(job, baseContext(), ENRICHED).code, "posted_at_unknown");
});

test("blocked company is rejected on the card, before any enrichment cost", () => {
  const context = baseContext();
  context.config.jobs_watcher.blocked_companies = ["example-website"];
  const result = prefilterJob(baseJob({ company: "example-website Inc" }), context, CARD);
  assert.equal(result.pass, false);
  assert.equal(result.code, "blocked_company");
  assert.equal(result.stage, FILTER_STAGES.PREFILTER);
});

test("blocked apply domain is only evaluated once enriched", () => {
  const context = baseContext();
  context.config.jobs_watcher.blocked_apply_domains = ["example-website.ai"];
  const job = baseJob({ easy_apply: false, external_apply_url: "https://jobs.example-website.ai/9" });

  assert.equal(prefilterJob(job, context, CARD).pass, true);
  const enriched = prefilterJob(job, context, ENRICHED);
  assert.equal(enriched.pass, false);
  assert.equal(enriched.code, "blocked_apply_domain");
});

test("a job already applied to is rejected", () => {
  assert.equal(prefilterJob(baseJob({ applied: true }), baseContext(), CARD).code, "already_applied");

  const context = baseContext();
  context.state.jobs.applications["1"] = { applied_at: NOW.toISOString() };
  assert.equal(prefilterJob(baseJob(), context, CARD).code, "already_applied");
});

test("quarantine blocks until it expires, then stops blocking", () => {
  const context = baseContext();
  context.quarantine.set("1", "2026-08-06T18:00:00.000Z");
  const blocked = prefilterJob(baseJob(), context, CARD);
  assert.equal(blocked.pass, false);
  assert.equal(blocked.code, "quarantined");

  context.quarantine.set("1", "2026-08-06T06:00:00.000Z");
  assert.equal(prefilterJob(baseJob(), context, CARD).pass, true);
});

test("a job without Easy Apply survives the prefilter so the digest can carry it", () => {
  const job = baseJob({ easy_apply: false });
  assert.equal(prefilterJob(job, baseContext(), CARD).pass, true);
  assert.equal(prefilterJob(job, baseContext(), ENRICHED).pass, true);
});

test("every rejection carries a human-readable reason", () => {
  const context = baseContext();
  context.config.jobs_watcher.blocked_companies = ["example-website"];
  const result = prefilterJob(baseJob({ company: "example-website" }), context, CARD);
  assert.equal(typeof result.reason, "string");
  assert.ok(result.reason.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/job-prefilter.test.js`
Expected: FAIL — `Cannot find module './job-prefilter.js'`

- [ ] **Step 3: Write the implementation**

Create `src/job-prefilter.js`:

```js
/**
 * The deterministic half of layers 2 and 3.
 *
 * It decides only what is *structural*: settings that disarm the pipeline, our
 * own send history, quarantine, work mode, freshness and the user's own block
 * lists. It deliberately never judges merit — stack alignment, disguised
 * seniority, a posting that contradicts its own badge — because that requires
 * reading the description, and that is the model's job in layer 3.
 *
 * Phase matters. On a card, an unreadable field means "we have not looked
 * properly yet", so the job is promoted to enrichment. Once enriched there will
 * be no better data, so the same unreadable field is a rejection. Encoding both
 * in one function is what keeps the two phases from drifting apart.
 */

import { matchesBlockedDomain } from "./apply-domain.js";
import { isRemoteOnly } from "./job-search-url.js";

export const FILTER_STAGES = Object.freeze({
  SEARCH: "search",
  PREFILTER: "prefilter",
  ENRICHMENT: "enrichment",
  MODEL: "model",
  ELIGIBILITY: "eligibility",
  CAP: "cap"
});

function reject(stage, code, reason) {
  return { pass: false, stage, code, reason };
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * @param {object} job      normalized card, optionally enriched
 * @param {object} context  { config, profile, state, quarantine, now }
 * @param {object} options  { phase: "card" | "enriched" }
 */
export function prefilterJob(job, context, { phase = "card" } = {}) {
  const settings = context?.config?.jobs_watcher || {};
  const enriched = phase === "enriched";
  const now = context?.now instanceof Date ? context.now : new Date();
  const stage = enriched ? FILTER_STAGES.ENRICHMENT : FILTER_STAGES.PREFILTER;

  // Only checked once the job is a genuine send candidate: these settings
  // disarm sending, not scanning, and a scan with sending off must still fill
  // the table and the digest.
  if (enriched && job.easy_apply) {
    if (!settings.easy_apply_enabled) {
      return reject(stage, "easy_apply_disabled", "Candidatura automática desligada nas configurações.");
    }
    if (settings.read_only) {
      return reject(stage, "read_only", "Pipeline em modo somente leitura.");
    }
  }

  if (job.applied || context?.state?.jobs?.applications?.[job.external_id]) {
    return reject(FILTER_STAGES.PREFILTER, "already_applied", "Já houve candidatura para esta vaga.");
  }

  const quarantinedUntil = context?.quarantine?.get?.(String(job.external_id));
  if (quarantinedUntil && new Date(quarantinedUntil).getTime() > now.getTime()) {
    return reject(
      FILTER_STAGES.PREFILTER,
      "quarantined",
      `Em quarentena após falha anterior até ${quarantinedUntil}.`
    );
  }

  const company = normalize(job.company);
  for (const entry of settings.blocked_companies || []) {
    const needle = normalize(entry);
    if (needle && company.includes(needle)) {
      return reject(FILTER_STAGES.PREFILTER, "blocked_company", `Empresa "${job.company}" está na sua lista de bloqueio.`);
    }
  }

  if (isRemoteOnly(context?.profile)) {
    if (job.work_mode === "hybrid" || job.work_mode === "onsite") {
      return reject(stage, "work_mode_not_remote", "Vaga não é remota e o perfil aceita somente remotas.");
    }
    if (job.work_mode === "unknown" && enriched) {
      return reject(stage, "work_mode_unknown", "Modalidade não declarada no anúncio e o perfil aceita somente remotas.");
    }
  }

  const horizonDays = Number(settings.freshness_days) || 7;
  if (job.posted_at) {
    const ageDays = (now.getTime() - new Date(job.posted_at).getTime()) / 86400000;
    if (ageDays > horizonDays) {
      return reject(stage, "too_old", `Publicada há mais de ${horizonDays} dia(s).`);
    }
  } else if (enriched) {
    return reject(stage, "posted_at_unknown", "Data de publicação não encontrada no anúncio.");
  }

  if (enriched && job.external_apply_url) {
    const blocked = matchesBlockedDomain(job.external_apply_url, settings.blocked_apply_domains);
    if (blocked) {
      return reject(stage, "blocked_apply_domain", `Site de candidatura "${blocked}" está na sua lista de bloqueio.`);
    }
  }

  return { pass: true, stage, code: "", reason: "" };
}
```

- [ ] **Step 4: Register the test file**

Append ` src/job-prefilter.test.js` to the `test` script in `package.json`.

- [ ] **Step 5: Run tests**

Run: `node --check src/job-prefilter.js && node --test src/job-prefilter.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
rtk git add src/job-prefilter.js src/job-prefilter.test.js package.json && \
rtk git commit -m "$(cat <<'EOF'
Concentre as regras estruturais num pré-filtro com fase explícita

Corrige a inversão de hasHardEasyApplyBlock, em que easy_apply_enabled=false
e read_only=true tornavam a pipeline mais permissiva em vez de desarmá-la.

Campo ilegível significa coisas diferentes por fase: no card ainda não olhamos
direito, então promove para enriquecimento; enriquecido não haverá dado melhor,
então reprova. As duas regras vivem numa função só para não divergirem.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Configuration surface

New editable keys, the `string_list` coercion the two block lists need, and the removal of the hard ceilings on application volume.

**Files:**
- Modify: `src/config-defaults.js`
- Modify: `src/config.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: config paths `jobs_watcher.freshness_days`, `jobs_watcher.blocked_companies`, `jobs_watcher.blocked_apply_domains`, `jobs_watcher.resolve_external_apply_url`, `jobs_watcher.quarantine_hours`, `jobs_watcher.run_budget_minutes`; coercion type `string_list`.

- [ ] **Step 1: Write the failing test**

Append to `src/config.test.js`:

```js
test("as novas chaves do pipeline de vagas têm padrão", () => {
  const config = resolveConfig();
  assert.equal(config.jobs_watcher.freshness_days, 7);
  assert.deepEqual(config.jobs_watcher.blocked_companies, []);
  assert.deepEqual(config.jobs_watcher.blocked_apply_domains, []);
  assert.equal(config.jobs_watcher.resolve_external_apply_url, false);
  assert.equal(config.jobs_watcher.quarantine_hours, 72);
  assert.equal(config.jobs_watcher.run_budget_minutes, 12);
});

test("string_list normaliza, deduplica e descarta vazios", () => {
  const value = coerceEditable("jobs_watcher.blocked_companies", ["  example-website ", "example-website", "", "Outra"]);
  assert.deepEqual(value, ["example-website", "Outra"]);
});

test("string_list recusa o que não é lista", () => {
  assert.throws(() => coerceEditable("jobs_watcher.blocked_apply_domains", "example-website.ai"), /lista/i);
});

test("o teto de candidatura é configurável, com limite de sanidade", () => {
  assert.equal(coerceEditable("jobs_watcher.max_easy_apply_per_run", 40), 40);
  assert.throws(() => coerceEditable("jobs_watcher.max_easy_apply_per_run", 5000), /entre/i);
});

test("SAFETY continua fora da superfície editável", () => {
  for (const field of EDITABLE) {
    assert.ok(!field.path.startsWith("security."), field.path);
    assert.notEqual(field.path, "jobs_watcher.blocked_question_patterns");
  }
});
```

Ensure the file's import line includes what these tests use — at the top of `src/config.test.js` the import from `./config-defaults.js` must include `coerceEditable` and `EDITABLE`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/config.test.js`
Expected: FAIL — `config.jobs_watcher.freshness_days` is `undefined`, and `coerceEditable` throws `configuração não editável`.

- [ ] **Step 3: Add the defaults**

In `src/config-defaults.js`, inside the `jobs_watcher` block of `DEFAULTS` (around line 181), add these keys and **remove** `history_days` and `max_minutes_per_search`:

```js
    // Horizon for the whole pipeline: feeds LinkedIn's f_TPR parameter, the
    // prefilter's age check and the pruning of processed_jobs.
    freshness_days: 7,
    // The user's own lists. Unlike a heuristic in code, these are exact and
    // editable in the interface, so a new bad actor costs no commit.
    blocked_companies: [],
    blocked_apply_domains: [],
    // Resolving the external apply link may need a click, which registers an
    // "apply click" in LinkedIn's telemetry. Off until the user opts in.
    resolve_external_apply_url: false,
    // A transient failure used to disqualify a job forever; now it rests.
    quarantine_hours: 72,
    // Time is the scarce resource, not the number of cards: this budgets the
    // whole run rather than each search.
    run_budget_minutes: 12,
```

- [ ] **Step 4: Loosen the volume ceilings**

In `HARD_LIMITS` (line 94), delete `max_easy_apply_per_run`, `max_easy_apply_per_day`, `max_easy_apply_per_week`, `max_searches_per_run` and `max_jobs_per_search`, leaving only `max_accepts_per_run` and `max_threads_to_scan`. Add this comment above the object:

```js
/**
 * Hard ceilings a user preference may lower but never raise.
 *
 * Application volume is deliberately NOT here. These ceilings exist to bound
 * what the agent *discloses* — SAFETY's territory — and how many messages it
 * touches. How many applications the user wants to send is their decision, so
 * those limits are configurable, bounded only by the sanity ceiling in the
 * `int` coercion, which is input validation against a slipped digit.
 */
```

Then update the `EDITABLE` entries that referenced the deleted limits so their `max` is a literal `500` for the three `max_easy_apply_per_*` paths, `50` for `jobs_watcher.max_jobs_per_search` and `20` for `jobs_watcher.max_searches_per_run`. Fix the `searches` coercion at line 357, which reads `HARD_LIMITS.max_searches_per_run * 3` — replace with the literal `60`.

- [ ] **Step 5: Add the new EDITABLE entries and the string_list coercion**

In the `EDITABLE` array, after the existing `jobs_watcher` entries, add:

```js
  { path: "jobs_watcher.freshness_days", type: "int", min: 1, max: 90, label: "Horizonte de vagas (dias)" },
  { path: "jobs_watcher.quarantine_hours", type: "int", min: 1, max: 720, label: "Quarentena após falha (horas)" },
  { path: "jobs_watcher.run_budget_minutes", type: "int", min: 1, max: 120, label: "Orçamento por execução (min)" },
  { path: "jobs_watcher.resolve_external_apply_url", type: "boolean", label: "Resolver link externo de candidatura" },
  { path: "jobs_watcher.blocked_companies", type: "string_list", label: "Empresas bloqueadas" },
  { path: "jobs_watcher.blocked_apply_domains", type: "string_list", label: "Sites de candidatura bloqueados" },
```

And in `coerceEditable`, add a case before the `searches` case:

```js
    case "string_list": {
      if (!Array.isArray(value)) throw new Error(`${field.label}: envie uma lista`);
      const seen = new Set();
      const items = [];
      for (const entry of value) {
        const text = String(entry ?? "").trim().slice(0, 120);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(text);
      }
      return items.slice(0, 200);
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --check src/config-defaults.js && node --check src/config.js && npm test`
Expected: PASS. If `src/scheduler.test.js` or `src/app-store.test.js` referenced a deleted `HARD_LIMITS` key, update those references to the literal ceiling.

- [ ] **Step 7: Commit**

```bash
rtk git add src/config-defaults.js src/config.test.js && \
rtk git commit -m "$(cat <<'EOF'
Torne o volume de candidatura configurável e adicione as listas de bloqueio

HARD_LIMITS existe para limitar o que o agente divulga, que é território do
SAFETY. Quantas candidaturas o usuário quer enviar é decisão dele, então os
tetos saem de lá e ficam presos apenas ao limite de sanidade da coerção, que
é validação de entrada contra um dedo escorregando no formulário.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Schema columns and record fields

The five new `agent_records` columns, carried end to end from `normalizeJobRecord` through the upsert to `mapAgentRecordRow`.

**Files:**
- Modify: `src/app-store.js:75-270` (schema), add `#migrateAgentRecordColumns`, `upsertAgentRecord` (line 898), `mapAgentRecordRow` (line 1504)
- Modify: `src/agent-record.js` (`baseRecord`, `normalizeJobRecord`)
- Modify: `src/agent-record.test.js`, `src/app-store.test.js`

**Interfaces:**
- Consumes: `FILTER_STAGES` from `src/job-prefilter.js` (Task 4).
- Produces: record fields `posted_at`, `work_mode`, `filter_stage`, `blocked_until`, `digested_at` on every record returned by `getAgentRecord` / `listAgentRecords`; `AppStore.markRecordsDigested(recordIds: string[], at: string) => number`; `AppStore.listQuarantine(pipeline: string) => Map<string,string>`.

- [ ] **Step 1: Write the failing test**

Append to `src/agent-record.test.js`:

```js
test("o registro de vaga carrega modalidade, data e a camada que decidiu", () => {
  const record = normalizeJobRecord(
    {
      external_id: "77",
      title: "Backend",
      company: "Acme",
      url: "https://www.linkedin.com/jobs/view/77/",
      easy_apply: true,
      work_mode: "remote",
      posted_at: "2026-08-05T12:00:00.000Z"
    },
    null,
    { filterStage: "prefilter", blockedUntil: "2026-08-09T12:00:00.000Z" }
  );

  assert.equal(record.work_mode, "remote");
  assert.equal(record.posted_at, "2026-08-05T12:00:00.000Z");
  assert.equal(record.filter_stage, "prefilter");
  assert.equal(record.blocked_until, "2026-08-09T12:00:00.000Z");
  assert.equal(record.digested_at, null);
});

test("modalidade ausente vira unknown em vez de string vazia", () => {
  const record = normalizeJobRecord({ external_id: "78", title: "x", easy_apply: false }, null, {});
  assert.equal(record.work_mode, "unknown");
  assert.equal(record.posted_at, null);
});
```

Append to `src/app-store.test.js` (follow the file's existing helper for opening a temporary store):

```js
test("as colunas novas de agent_records sobrevivem ao round-trip", () => {
  const store = openTemporaryStore();
  store.upsertAgentRecord({
    record_id: "abc", pipeline: "jobs", kind: "job", external_id: "1",
    title: "Backend", send_method: "easy_apply", send_state: "available",
    work_mode: "remote", posted_at: "2026-08-05T12:00:00.000Z",
    filter_stage: "prefilter", blocked_until: null, digested_at: null, raw: {}
  });

  const record = store.getAgentRecord("abc");
  assert.equal(record.work_mode, "remote");
  assert.equal(record.posted_at, "2026-08-05T12:00:00.000Z");
  assert.equal(record.filter_stage, "prefilter");
  store.close();
});

test("markRecordsDigested carimba só os ids informados", () => {
  const store = openTemporaryStore();
  for (const id of ["a", "b"]) {
    store.upsertAgentRecord({
      record_id: id, pipeline: "jobs", kind: "job", external_id: id,
      title: id, send_method: "external", send_state: "unsupported", raw: {}
    });
  }

  assert.equal(store.markRecordsDigested(["a"], "2026-08-06T12:00:00.000Z"), 1);
  assert.equal(store.getAgentRecord("a").digested_at, "2026-08-06T12:00:00.000Z");
  assert.equal(store.getAgentRecord("b").digested_at, null);
  store.close();
});

test("listQuarantine devolve só o que ainda está bloqueado no futuro", () => {
  const store = openTemporaryStore();
  store.upsertAgentRecord({
    record_id: "q1", pipeline: "jobs", kind: "job", external_id: "10",
    title: "x", send_method: "easy_apply", send_state: "blocked",
    blocked_until: "2099-01-01T00:00:00.000Z", raw: {}
  });
  store.upsertAgentRecord({
    record_id: "q2", pipeline: "jobs", kind: "job", external_id: "11",
    title: "y", send_method: "easy_apply", send_state: "blocked",
    blocked_until: "2000-01-01T00:00:00.000Z", raw: {}
  });

  const quarantine = store.listQuarantine("jobs");
  assert.equal(quarantine.get("10"), "2099-01-01T00:00:00.000Z");
  assert.equal(quarantine.has("11"), false);
  store.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/agent-record.test.js src/app-store.test.js`
Expected: FAIL — `record.work_mode` is `undefined`; `store.markRecordsDigested is not a function`.

- [ ] **Step 3: Add the columns to the schema and the migration**

In `src/app-store.js`, in the `CREATE TABLE IF NOT EXISTS agent_records` block (line 131), add before `raw_json`:

```sql
        work_mode TEXT NOT NULL DEFAULT 'unknown',
        posted_at TEXT,
        filter_stage TEXT NOT NULL DEFAULT '',
        blocked_until TEXT,
        digested_at TEXT,
```

Add an index for the quarantine lookup, next to the existing indexes:

```sql
      CREATE INDEX IF NOT EXISTS idx_agent_records_quarantine ON agent_records(pipeline, blocked_until);
```

Add a migration method next to `#migrateNotificationColumns` and call it from the constructor right after it:

```js
  /**
   * Adds the layered-filter columns to an existing install.
   *
   * Plain ADD COLUMN with defaults, so an upgraded database keeps every record
   * it already had instead of losing the send history behind them.
   */
  #migrateAgentRecordColumns() {
    const columns = new Set(
      this.db.prepare("PRAGMA table_info(agent_records)").all().map((row) => row.name)
    );
    const additions = [
      ["work_mode", "TEXT NOT NULL DEFAULT 'unknown'"],
      ["posted_at", "TEXT"],
      ["filter_stage", "TEXT NOT NULL DEFAULT ''"],
      ["blocked_until", "TEXT"],
      ["digested_at", "TEXT"]
    ];
    for (const [name, definition] of additions) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE agent_records ADD COLUMN ${name} ${definition}`);
    }
  }
```

- [ ] **Step 4: Carry the columns through the upsert and the row mapper**

In `upsertAgentRecord` (line 898): add the five column names to the `INSERT` column list, add five `?` to the `VALUES` list, add the five `excluded.` assignments to the `DO UPDATE SET` block, and add the five values to the `.run(...)` arguments in the same order:

```js
      record.work_mode || "unknown",
      record.posted_at || null,
      record.filter_stage || "",
      record.blocked_until || null,
      record.digested_at || null,
```

Important: `digested_at` must **not** be overwritten by a rescan that does not know about it. In the `DO UPDATE SET` block write `digested_at = COALESCE(excluded.digested_at, agent_records.digested_at)`, so a later scan cannot make an already-sent digest look unsent.

In `mapAgentRecordRow` (line 1504) add the five fields to the returned object, before `raw`.

- [ ] **Step 5: Add the two new store methods**

Next to `agentRecordCounts`:

```js
  /** Stamps the digest send so a job is not emailed again for the same reason. */
  markRecordsDigested(recordIds, at) {
    const ids = (recordIds || []).map((id) => String(id)).filter(Boolean);
    if (!ids.length) return 0;
    const statement = this.db.prepare("UPDATE agent_records SET digested_at = ?, updated_at = ? WHERE record_id = ?");
    const timestamp = nowIso();
    let changed = 0;
    for (const id of ids) changed += Number(statement.run(at, timestamp, id).changes || 0);
    return changed;
  }

  /** external_id -> blocked_until, for the quarantine entries still in the future. */
  listQuarantine(pipeline) {
    const rows = this.db.prepare(
      "SELECT external_id, blocked_until FROM agent_records WHERE pipeline = ? AND blocked_until IS NOT NULL AND blocked_until > ?"
    ).all(String(pipeline), nowIso());
    return new Map(rows.map((row) => [String(row.external_id), row.blocked_until]));
  }
```

- [ ] **Step 6: Carry the fields in agent-record.js**

In `baseRecord`, add `work_mode: "unknown"`, `posted_at: null`, `filter_stage: ""`, `blocked_until: null`, `digested_at: null` before `raw`.

In `normalizeJobRecord`, after `record.location = ...`:

```js
  record.work_mode = ["remote", "hybrid", "onsite", "unknown"].includes(job.work_mode) ? job.work_mode : "unknown";
  record.posted_at = job.posted_at || null;
  record.filter_stage = cleanText(context.filterStage, 40);
  record.blocked_until = context.blockedUntil || null;
```

Also add `work_mode` and `posted_at` to the `record.raw.job` object so the detail dialog can show them.

- [ ] **Step 7: Run tests**

Run: `node --check src/app-store.js && node --check src/agent-record.js && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add src/app-store.js src/agent-record.js src/agent-record.test.js src/app-store.test.js && \
rtk git commit -m "$(cat <<'EOF'
Grave modalidade, data, camada de filtro, quarentena e digest no registro

filter_stage é o que torna a recusa visível: sem ele o usuário só vê a vaga
sumir. digested_at usa COALESCE no upsert porque uma varredura posterior não
sabe do digest e não pode fazer um e-mail já enviado parecer pendente.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Structured card extraction and the stop criterion

Rewrites `extractJobsFromPage` to hand structured fields to `normalizeJobCard`, and replaces the blind scroll budget with one that counts qualified jobs and respects the freshness horizon.

**Files:**
- Modify: `src/cli.js:2732-2805` (`extractJobsFromPage`)
- Test: `src/job-scan-budget.test.js` (create)
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `normalizeJobCard` (Task 2), `prefilterJob` (Task 4).
- Produces:
  - `shouldStopScrolling(state, limits) => {stop: boolean, reason: string}` exported from `src/job-scan-budget.js`
    where `state = {qualifiedCount, staleScrolls, oldestPostedAt, elapsedMs, scrolls}` and
    `limits = {staleScrollLimit, budgetMs, maxScrolls, freshnessDays, now}`
  - `extractJobsFromPage(page, searchName, config, context)` now returns normalized cards.

- [ ] **Step 1: Write the failing test**

Create `src/job-scan-budget.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { shouldStopScrolling } from "./job-scan-budget.js";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const LIMITS = { staleScrollLimit: 3, budgetMs: 60000, maxScrolls: 12, freshnessDays: 7, now: NOW };

test("keeps scrolling while jobs still qualify", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 4, staleScrolls: 0, oldestPostedAt: "2026-08-05T12:00:00.000Z", elapsedMs: 1000, scrolls: 1 },
    LIMITS
  );
  assert.equal(result.stop, false);
});

test("stops when the cards cross the freshness horizon", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 4, staleScrolls: 0, oldestPostedAt: "2026-07-01T12:00:00.000Z", elapsedMs: 1000, scrolls: 1 },
    LIMITS
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "freshness_horizon");
});

test("stops after enough scrolls without a qualified job", () => {
  // Counting scrolls that produced no *qualified* job, not scrolls that
  // produced no card: a page full of jobs we will never send is still stale.
  const result = shouldStopScrolling(
    { qualifiedCount: 1, staleScrolls: 3, oldestPostedAt: "2026-08-05T12:00:00.000Z", elapsedMs: 1000, scrolls: 5 },
    LIMITS
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "no_qualified_yield");
});

test("stops when the run budget is spent", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 9, staleScrolls: 0, oldestPostedAt: "2026-08-05T12:00:00.000Z", elapsedMs: 60001, scrolls: 2 },
    LIMITS
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "run_budget");
});

test("stops at the scroll ceiling", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 9, staleScrolls: 0, oldestPostedAt: "2026-08-05T12:00:00.000Z", elapsedMs: 100, scrolls: 12 },
    LIMITS
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "max_scrolls");
});

test("an unknown oldest date does not stop the scroll", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 2, staleScrolls: 0, oldestPostedAt: null, elapsedMs: 100, scrolls: 1 },
    LIMITS
  );
  assert.equal(result.stop, false);
});

test("the budget wins over everything else", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 0, staleScrolls: 0, oldestPostedAt: null, elapsedMs: 999999, scrolls: 0 },
    LIMITS
  );
  assert.equal(result.reason, "run_budget");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/job-scan-budget.test.js`
Expected: FAIL — `Cannot find module './job-scan-budget.js'`

- [ ] **Step 3: Write the budget module**

Create `src/job-scan-budget.js`:

```js
/**
 * When to stop scrolling a search.
 *
 * The previous criterion counted collected cards, so a page full of vacancies
 * that would never be sent still looked like progress. All three reasons here
 * are about yield or cost:
 *
 *  - the results crossed the freshness horizon (valid only because the search
 *    is sorted newest-first, so everything below is older still);
 *  - the last few scrolls produced no *qualified* job;
 *  - the run spent its time budget, which is the scarce resource.
 */
export function shouldStopScrolling(state, limits) {
  const now = limits?.now instanceof Date ? limits.now : new Date();

  if (state.elapsedMs >= limits.budgetMs) return { stop: true, reason: "run_budget" };
  if (state.scrolls >= limits.maxScrolls) return { stop: true, reason: "max_scrolls" };

  if (state.oldestPostedAt) {
    const ageDays = (now.getTime() - new Date(state.oldestPostedAt).getTime()) / 86400000;
    if (ageDays > limits.freshnessDays) return { stop: true, reason: "freshness_horizon" };
  }

  if (state.staleScrolls >= limits.staleScrollLimit) return { stop: true, reason: "no_qualified_yield" };

  return { stop: false, reason: "" };
}
```

- [ ] **Step 4: Rewrite the DOM extraction**

In `src/cli.js`, replace the body of `extractJobsFromPage` (line 2732). The `page.evaluate` callback must return **raw structured fields**, not interpreted ones — interpretation belongs to `normalizeJobCard`, which is testable:

```js
async function extractJobsFromPage(page, searchName, config, context) {
  await page.waitForSelector('a[href*="/jobs/view/"], [data-job-id], .job-card-container', { timeout: 5000 }).catch(() => { });
  const allById = new Map();
  let staleScrolls = 0;
  let scrolls = 0;
  const startedAt = Date.now();
  const limits = {
    staleScrollLimit: Number(config.jobs_watcher.stop_after_stale_scrolls) || 3,
    budgetMs: context.remainingBudgetMs,
    maxScrolls: Number(config.jobs_watcher.max_scrolls_per_search) || 12,
    freshnessDays: Number(config.jobs_watcher.freshness_days) || 7,
    now: new Date()
  };

  while (true) {
    const batch = await page.evaluate(() => {
      const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const cards = Array.from(document.querySelectorAll('[data-job-id], li.jobs-search-results__list-item, div.job-card-container'));
      const seen = new Set();
      const out = [];

      for (const card of cards) {
        const link = card.querySelector('a[href*="/jobs/view/"]');
        const url = link?.href || "";
        const externalId = card.getAttribute("data-job-id")
          || url.match(/(?:currentJobId=|\/jobs\/view\/)(\d+)/)?.[1]
          || null;
        if (!externalId || seen.has(externalId)) continue;
        seen.add(externalId);

        const text = clean(card.innerText || card.textContent || "");
        // LinkedIn renders these as their own elements. Reading them directly is
        // the whole point: flattening the card into innerText is what made work
        // mode and posting date unavailable to the filters.
        const time = card.querySelector("time");
        const metadata = Array.from(card.querySelectorAll("li, .job-card-container__metadata-item, [class*='metadata']"))
          .map((node) => clean(node.innerText || node.textContent || ""))
          .filter(Boolean);

        out.push({
          external_id: externalId,
          url,
          apply_url: card.querySelector('a[href*="/apply/"], a[href*="openSDUIApplyFlow=true"]')?.href || "",
          title: clean(link?.innerText || card.querySelector("h3, [class*='title']")?.innerText || ""),
          company: clean(card.querySelector("[class*='subtitle'], h4")?.innerText || ""),
          location: metadata.find((item) => /,|remoto|remote|presencial|h[íi]brido|hybrid|on-?site/i.test(item)) || "",
          work_mode_label: metadata.find((item) => /remoto|remote|presencial|h[íi]brido|hybrid|on-?site/i.test(item)) || "",
          posted_datetime: time?.getAttribute("datetime") || "",
          posted_label: clean(time?.innerText || time?.textContent || ""),
          easy_apply: /easy apply|candidatura simplificada/i.test(text),
          applied: /applied|candidatou-se|candidatou/i.test(text),
          sponsored: /promoted|patrocinad/i.test(text),
          text
        });
      }
      return out;
    });

    let qualifiedThisScroll = 0;
    let oldestPostedAt = null;
    for (const raw of batch) {
      const card = normalizeJobCard(raw, { searchName, now: new Date() });
      if (!card || allById.has(card.external_id)) continue;
      allById.set(card.external_id, card);
      if (card.posted_at && (!oldestPostedAt || card.posted_at < oldestPostedAt)) oldestPostedAt = card.posted_at;
      if (prefilterJob(card, context.prefilterContext, { phase: "card" }).pass) qualifiedThisScroll++;
    }

    staleScrolls = qualifiedThisScroll === 0 ? staleScrolls + 1 : 0;
    const verdict = shouldStopScrolling(
      { qualifiedCount: allById.size, staleScrolls, oldestPostedAt, elapsedMs: Date.now() - startedAt, scrolls },
      limits
    );
    if (verdict.stop) return { jobs: Array.from(allById.values()), stop_reason: verdict.reason };

    await page.evaluate(() => {
      const scrollables = Array.from(document.querySelectorAll("*")).filter((el) => el.scrollHeight > el.clientHeight && el.clientHeight > 200);
      const jobsList = scrollables.find((el) => /result|job|vaga|scaffold/i.test(`${el.className || ""} ${el.textContent || ""}`)) || document.scrollingElement;
      jobsList?.scrollBy?.(0, Math.floor((jobsList.clientHeight || window.innerHeight) * 0.85));
    });
    await page.waitForTimeout(1200);
    scrolls++;
  }
}
```

Add the imports at the top of `src/cli.js`:

```js
import { normalizeJobCard } from "./job-card.js";
import { prefilterJob, FILTER_STAGES } from "./job-prefilter.js";
import { shouldStopScrolling } from "./job-scan-budget.js";
import { buildSearchUrls } from "./job-search-url.js";
import { matchesBlockedDomain } from "./apply-domain.js";
```

- [ ] **Step 5: Register the test file and verify**

Append ` src/job-scan-budget.test.js` to the `test` script in `package.json`.

Run: `node --check src/job-scan-budget.js && node --check src/cli.js && npm test`
Expected: PASS. `extractJobsFromPage` now returns `{jobs, stop_reason}`; `runJobsScan` is fixed up in Task 9, so a temporary type error there is expected until then — do not "fix" it by reverting this return shape.

- [ ] **Step 6: Commit**

```bash
rtk git add src/cli.js src/job-scan-budget.js src/job-scan-budget.test.js package.json && \
rtk git commit -m "$(cat <<'EOF'
Pare de rolar por rendimento e horizonte, não por cards coletados

O critério antigo contava cards, então uma página cheia de vagas que nunca
seriam enviadas ainda parecia progresso. Com sortBy=DD, cruzar o horizonte de
frescor é motivo válido de parada: tudo abaixo é mais antigo ainda.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Enrichment phase

Opens the job page for the survivors, reads the real description, work mode and posting date, and resolves the external application URL.

**Files:**
- Modify: `src/cli.js` (add `enrichJob` and `resolveExternalApplyUrl` next to `extractJobsFromPage`)
- Test: `src/job-enrichment.test.js` (create) — tests the pure parsing half against a fake page, the pattern `src/resume-selection.test.js` uses
- Create: `src/job-enrichment.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `parseWorkMode`, `parsePostedAt` (Task 2).
- Produces:
  - `parseJobDetail(detail: {body_text, work_mode_label, posted_datetime, posted_label, apply_url_json}, now: Date) => {work_mode, posted_at, description, external_apply_url}`
  - `enrichJob(page, job, config) => object` — the job with `description`, `work_mode`, `posted_at`, `external_apply_url`, `enrichment_error`

- [ ] **Step 1: Write the failing test**

Create `src/job-enrichment.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseJobDetail } from "./job-enrichment.js";

const NOW = new Date("2026-08-06T12:00:00.000Z");

test("the posting's own badge wins over the card's guess", () => {
  const detail = parseJobDetail({
    body_text: "Vaga híbrida em São Paulo. Comparecer 2x por semana.",
    work_mode_label: "Híbrido",
    posted_datetime: "2026-08-04T10:00:00.000Z",
    posted_label: "",
    apply_url_json: ""
  }, NOW);

  assert.equal(detail.work_mode, "hybrid");
  assert.equal(detail.posted_at, "2026-08-04T10:00:00.000Z");
});

test("falls back to the body text when there is no badge", () => {
  const detail = parseJobDetail({
    body_text: "Trabalho 100% remoto, horário flexível.",
    work_mode_label: "",
    posted_datetime: "",
    posted_label: "há 1 dia",
    apply_url_json: ""
  }, NOW);

  assert.equal(detail.work_mode, "remote");
  assert.equal(detail.posted_at, "2026-08-05T12:00:00.000Z");
});

test("extracts the external apply URL from the embedded JSON", () => {
  const detail = parseJobDetail({
    body_text: "Candidate-se pelo nosso site.",
    work_mode_label: "Remoto",
    posted_datetime: "",
    posted_label: "há 1 dia",
    apply_url_json: '{"applyMethod":{"companyApplyUrl":"https://jobs.example-website.ai/9?src=li"}}'
  }, NOW);

  assert.equal(detail.external_apply_url, "https://jobs.example-website.ai/9?src=li");
});

test("malformed embedded JSON yields no URL instead of throwing", () => {
  const detail = parseJobDetail({
    body_text: "x", work_mode_label: "Remoto", posted_datetime: "", posted_label: "há 1 dia",
    apply_url_json: "{not json"
  }, NOW);
  assert.equal(detail.external_apply_url, "");
});

test("the description is trimmed but keeps enough for the model to judge", () => {
  const long = "a".repeat(20000);
  const detail = parseJobDetail({
    body_text: long, work_mode_label: "Remoto", posted_datetime: "", posted_label: "há 1 dia", apply_url_json: ""
  }, NOW);

  assert.equal(detail.description.length, 8000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/job-enrichment.test.js`
Expected: FAIL — `Cannot find module './job-enrichment.js'`

- [ ] **Step 3: Write the parsing module**

Create `src/job-enrichment.js`:

```js
/**
 * Parsing of one job detail page.
 *
 * Kept apart from the Playwright navigation for the same reason
 * resume-selection.js is: the decision flow has to be testable against fixed
 * input, and a browser is not fixed input.
 */

import { parseWorkMode, parsePostedAt } from "./job-card.js";

/** Enough for the model to judge alignment without paying for a whole page of boilerplate. */
const MAX_DESCRIPTION_CHARS = 8000;

export function parseJobDetail(detail, now = new Date()) {
  const body = String(detail?.body_text || "").replace(/\s+/g, " ").trim();

  // The badge is the posting's own declaration; the body is the fallback. Both
  // beat the card, which is why enrichment exists.
  const workMode = detail?.work_mode_label
    ? parseWorkMode(detail.work_mode_label)
    : parseWorkMode(body);

  let externalApplyUrl = "";
  if (detail?.apply_url_json) {
    try {
      const parsed = JSON.parse(detail.apply_url_json);
      const candidate = parsed?.applyMethod?.companyApplyUrl || parsed?.companyApplyUrl || "";
      if (/^https?:\/\//i.test(candidate)) externalApplyUrl = candidate;
    } catch {
      // A page whose embedded JSON changed shape is not a failure: the click
      // strategy is the fallback, and no URL at all is a valid answer.
    }
  }

  return {
    work_mode: workMode,
    posted_at: parsePostedAt(detail?.posted_datetime, detail?.posted_label, now),
    description: body.slice(0, MAX_DESCRIPTION_CHARS),
    external_apply_url: externalApplyUrl
  };
}
```

- [ ] **Step 4: Add the navigation half to cli.js**

Add next to `extractJobsFromPage` in `src/cli.js`:

```js
/**
 * Opens the job page and replaces the card's guesses with the posting's own
 * data. Only survivors of the card prefilter get here, so the cost is a handful
 * of navigations per run rather than one per scraped card.
 *
 * A failure never discards the job: it keeps the card data and travels to the
 * digest with `enrichment_error`. The failure mode being fixed is a job
 * vanishing because a filter had no data to decide it — reintroducing that
 * through the enrichment path would defeat the whole change.
 */
async function enrichJob(page, job, config) {
  try {
    await page.goto(`https://www.linkedin.com/jobs/view/${job.external_id}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    if (new RegExp(config.linkedin.login_url_pattern, "i").test(page.url())) {
      markLinkedInDisconnected(config, "job_enrichment_needs_login");
      return { ...job, enrichment_error: "needs_login" };
    }

    await clickIfPresent(page.locator("button:has-text('Ver mais'), button:has-text('See more')"), 2000);

    const detail = await page.evaluate(() => {
      const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const time = document.querySelector("time");
      const badges = Array.from(document.querySelectorAll("[class*='job-details'] li, [class*='preferences'] span, [class*='workplace']"))
        .map((node) => clean(node.innerText || node.textContent || ""))
        .filter(Boolean);
      return {
        body_text: clean(document.querySelector("[class*='description__text'], article, main")?.innerText || ""),
        work_mode_label: badges.find((item) => /remoto|remote|presencial|h[íi]brido|hybrid|on-?site/i.test(item)) || "",
        posted_datetime: time?.getAttribute("datetime") || "",
        posted_label: clean(time?.innerText || ""),
        apply_url_json: Array.from(document.querySelectorAll("code"))
          .map((node) => node.textContent || "")
          .find((text) => text.includes("companyApplyUrl")) || ""
      };
    });

    const parsed = parseJobDetail(detail, new Date());
    const enriched = { ...job, ...parsed, enrichment_error: null };

    if (!enriched.external_apply_url && !job.easy_apply && config.jobs_watcher.resolve_external_apply_url) {
      enriched.external_apply_url = await resolveExternalApplyUrl(page);
    }
    return enriched;
  } catch (error) {
    return { ...job, enrichment_error: String(error?.message || error).slice(0, 300) };
  }
}

/**
 * Last resort for the external destination: click the apply button and read the
 * URL of the tab it opens, without touching anything inside it.
 *
 * The click registers an "apply click" in LinkedIn's telemetry, which is why it
 * is behind `resolve_external_apply_url` and off by default. The tab is always
 * closed: an orphan tab holds the Chromium profile, and the profile is exclusive.
 */
async function resolveExternalApplyUrl(page) {
  let popup = null;
  try {
    const [opened] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 8000 }),
      page.locator("button:has-text('Candidatar'), button:has-text('Apply')").first().click({ timeout: 5000 })
    ]);
    popup = opened;
    await popup.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => { });
    return popup.url() || "";
  } catch {
    return "";
  } finally {
    await popup?.close().catch(() => { });
  }
}
```

Add `import { parseJobDetail } from "./job-enrichment.js";` to the imports.

- [ ] **Step 5: Register the test file and verify**

Append ` src/job-enrichment.test.js` to the `test` script in `package.json`.

Run: `node --check src/job-enrichment.js && node --check src/cli.js && npm test`
Expected: PASS, 5 new tests.

- [ ] **Step 6: Commit**

```bash
rtk git add src/cli.js src/job-enrichment.js src/job-enrichment.test.js package.json && \
rtk git commit -m "$(cat <<'EOF'
Enriqueça as sobreviventes com a página real da vaga

Falha de enriquecimento nunca descarta a vaga: ela mantém o dado do card e
segue para o digest com enrichment_error. O modo de falha que estamos
consertando é a vaga sumir por um filtro sem dado para decidir, e reintroduzi-lo
por esta porta anularia a mudança inteira.

A aba do clique fecha em finally — aba órfã segura o perfil do Chromium, que é
exclusivo entre os dois processos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire the four phases into runJobsScan

The orchestration change, and the deletion of everything the layers replace.

**Files:**
- Modify: `src/cli.js:3805-4023` (`runJobsScan`), `:3521-3580` (`persistScannedJobRecords`), delete `:904-980` (`chooseResumeType`, `scoreJob`, `hasHardEasyApplyBlock`, `shouldAttemptEasyApply`, `explainEasyApplyDecision`)
- Modify: `src/cli.js:3334` (`attemptEasyApply` — it calls `chooseResumeType`)

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: `runJobsScan()` result gains `stop_reasons`, `enriched_count`, `filter_breakdown` (a `{code: count}` object), `over_cap_count`.

- [ ] **Step 1: Delete the replaced functions**

Remove `chooseResumeType` (line 904), `scoreJob` (911), `hasHardEasyApplyBlock` (935), `shouldAttemptEasyApply` (947) and `explainEasyApplyDecision` (952) from `src/cli.js`.

In `attemptEasyApply` (line 3336), replace `const resumeType = modelEvaluation?.resume_type || chooseResumeType(job);` with `const resumeType = modelEvaluation?.resume_type || "software_engineer";` — the model already returns `resume_type`, and the regex fallback was guessing the user's stack.

In `persistScannedJobRecords` (line 3540), delete `const decision = explainEasyApplyDecision(job, config, state);` and replace `context.score` / `context.decisionReasons` with values taken from the job's recorded filter outcome, which Task 9 Step 2 attaches as `job.filter_outcome`:

```js
    const context = {
      score: job.model_evaluation?.confidence ?? null,
      applicationResult: result,
      decisionReasons: job.filter_outcome?.code ? [job.filter_outcome.code] : [],
      filterStage: job.filter_outcome?.stage || "",
      blockedUntil: job.blocked_until || null,
      sendMethod: job.easy_apply ? "easy_apply" : "external"
    };
```

Also add the new fields to the record so Task 6's columns are populated: the job objects passed in now already carry `work_mode` and `posted_at`, which `normalizeJobRecord` reads directly.

- [ ] **Step 2: Rewrite the scan body**

In `runJobsScan`, replace the search loop and the apply loop. The shape:

```js
    const store = openAppStore(config);
    const quarantine = store.listQuarantine("jobs");
    const prefilterContext = { config, profile, state, quarantine, now: new Date() };
    const searches = buildSearchUrls(profile, config);
    const runStartedAt = Date.now();
    const runBudgetMs = (Number(config.jobs_watcher.run_budget_minutes) || 12) * 60 * 1000;

    const allJobs = [];
    const stopReasons = [];
    for (const search of searches) {
      const remainingBudgetMs = runBudgetMs - (Date.now() - runStartedAt);
      if (remainingBudgetMs <= 0) { stopReasons.push({ search: search.name, reason: "run_budget" }); break; }

      await page.goto(search.url, { waitUntil: "domcontentloaded" });
      if (new RegExp(config.linkedin.login_url_pattern, "i").test(page.url())) {
        const result = { run_at: nowIso(), status: "needs_login", job_count: 0 };
        markLinkedInDisconnected(config, "jobs_scan_needs_login");
        await notifyOperationalAlert("LinkedIn login required for jobs pipeline.", { command: "jobs:scan", status: "needs_login" });
        console.log(JSON.stringify(result, null, 2));
        return result;
      }

      const scan = await extractJobsFromPage(page, search.name, config, { remainingBudgetMs, prefilterContext });
      stopReasons.push({ search: search.name, reason: scan.stop_reason });
      allJobs.push(...scan.jobs);
      await page.waitForTimeout(1000);
    }

    // Layer 2. A rejection here is final and recorded; a pass is a promotion.
    const filterBreakdown = {};
    const promoted = [];
    for (const job of allJobs) {
      const outcome = prefilterJob(job, prefilterContext, { phase: "card" });
      job.filter_outcome = outcome;
      if (!outcome.pass) { filterBreakdown[outcome.code] = (filterBreakdown[outcome.code] || 0) + 1; continue; }
      promoted.push(job);
    }

    // Layer 3. Enrich, re-check with firm data, then let the model judge merit.
    const enriched = [];
    // Declared here, not inside the apply loop: the digest reads it afterwards,
    // and a job cut by a cap is the one case that used to disappear entirely.
    const overCapJobs = [];
    let workModeDisagreements = 0;
    for (const job of promoted) {
      if (Date.now() - runStartedAt > runBudgetMs) { job.filter_outcome = { pass: false, stage: FILTER_STAGES.ENRICHMENT, code: "run_budget", reason: "Orçamento da execução esgotado antes do enriquecimento." }; continue; }

      const detailed = await enrichJob(page, job, config);
      // Layer 1 promised remote when f_WT was set; a posting that says otherwise
      // is either a self-contradicting ad or a parameter that stopped working.
      if (job.work_mode === "remote" && detailed.work_mode !== "remote" && detailed.work_mode !== "unknown") workModeDisagreements++;

      const outcome = detailed.enrichment_error
        ? { pass: true, stage: FILTER_STAGES.ENRICHMENT, code: "enrichment_failed", reason: `Não foi possível ler o anúncio: ${detailed.enrichment_error}` }
        : prefilterJob(detailed, prefilterContext, { phase: "enriched" });
      detailed.filter_outcome = outcome;
      if (!outcome.pass) { filterBreakdown[outcome.code] = (filterBreakdown[outcome.code] || 0) + 1; continue; }
      enriched.push(detailed);
    }
```

Then the apply loop runs over `enriched.filter((job) => job.easy_apply && !job.enrichment_error)`, keeping the existing structure — `checkJobEligibility` (layer 4), `evaluateJobWithModel`, `attemptEasyApply` — with the daily/weekly/run caps read from config. A job cut by a cap must be marked, not dropped:

```js
      if (appliedThisRun >= config.jobs_watcher.max_easy_apply_per_run) {
        job.filter_outcome = { pass: false, stage: FILTER_STAGES.CAP, code: "over_run_cap", reason: "Excedeu o limite de candidaturas desta execução." };
        overCapJobs.push(job);
        continue;
      }
```

Use `continue`, **not** `break`: the previous code broke out of the loop, which is how jobs above the cap were neither sent nor reported. Apply the same treatment to the daily and weekly caps, with codes `over_daily_cap` and `over_weekly_cap` — `selectDigestJobs` already recognises all three.

The model evaluation must also be attached to the job, because `persistScannedJobRecords` now reads `job.model_evaluation` instead of digging it out of the application result:

```js
      job.model_evaluation = modelEvaluation;
```

Place it immediately after the successful `evaluateJobWithModel` call, before the confidence check, so a rejected job still carries the reasoning that rejected it. For the rejection branch also set:

```js
        job.filter_outcome = { pass: false, stage: FILTER_STAGES.MODEL, code: "model_rejected", reason: modelEvaluation.reason || "Modelo recusou a candidatura." };
```

and for the eligibility branch:

```js
        job.filter_outcome = { pass: false, stage: FILTER_STAGES.ELIGIBILITY, code: "not_eligible", reason: eligibility.reason };
```

- [ ] **Step 3: Prune the state blob**

Before `await writeAppState(state, config)`, add:

```js
    // processed_jobs is rewritten whole on every run, so it cannot grow forever.
    // Past the freshness horizon an entry decides nothing.
    const pruneBefore = Date.now() - (Number(config.jobs_watcher.freshness_days) || 7) * 2 * 86400000;
    for (const [id, entry] of Object.entries(state.jobs.processed_jobs)) {
      if (new Date(entry?.last_seen_at || 0).getTime() < pruneBefore) delete state.jobs.processed_jobs[id];
    }
```

- [ ] **Step 4: Set quarantine instead of a permanent tombstone**

Where the current code writes `state.jobs.needs_review[job.external_id] = {...}` for `needs_review`, `submission_unknown` and `needs_login`, also set on the job:

```js
      job.blocked_until = new Date(Date.now() + (Number(config.jobs_watcher.quarantine_hours) || 72) * 3600000).toISOString();
```

`persistScannedJobRecords` writes it to the `blocked_until` column, and `store.listQuarantine` reads it back on the next run. `state.jobs.needs_review` stays written for diagnostics but is no longer consulted by any filter.

- [ ] **Step 5: Extend the run result**

```js
    const result = {
      run_at: nowIso(),
      status: "scanned",
      job_count: allJobs.length,
      new_job_count: newJobs.length,
      promoted_count: promoted.length,
      enriched_count: enriched.length,
      over_cap_count: overCapJobs.length,
      filter_breakdown: filterBreakdown,
      stop_reasons: stopReasons,
      work_mode_disagreements: workModeDisagreements,
      application_results: applicationResults
    };
```

- [ ] **Step 6: Verify**

Run: `node --check src/cli.js && npm test`
Expected: PASS. Then a real read-only run:

Run: `LINKEDIN_JOBS_READ_ONLY=true npm run jobs:scan`
Expected: JSON result with a non-empty `filter_breakdown` and `stop_reasons`. Confirm from the output which LinkedIn parameters were honoured — if `f_WT` was ignored, `work_mode_disagreements` will be high, and that is the signal the spec calls for.

- [ ] **Step 7: Commit**

```bash
rtk git add src/cli.js && \
rtk git commit -m "$(cat <<'EOF'
Reorganize a varredura de vagas nas quatro camadas

scoreJob e chooseResumeType são deletados, não reescritos: eram heurísticas
chumbadas adivinhando a stack do usuário, e o avaliador já devolve resume_type.

A vaga cortada por teto usa continue, não break. O break era como as vagas
acima do limite não eram enviadas nem avisadas — simplesmente sumiam.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Job evaluator over the real description

The model now judges merit, so it needs the description and the criteria that left the deterministic layers.

**Files:**
- Modify: `src/cli.js:1028-1077` (`buildJobModelPayload`, `buildJobEvaluatorPrompt`)

**Interfaces:**
- Consumes: `job.description`, `job.work_mode`, `job.posted_at` from Task 8.
- Produces: unchanged `JOB_EVALUATION_SCHEMA` contract.

- [ ] **Step 1: Send the description instead of the card text**

In `buildJobModelPayload`, replace `compact_text: job.compact_text` with:

```js
      work_mode: job.work_mode,
      posted_at: job.posted_at,
      external_apply_url: job.external_apply_url || "",
      // The full posting, not 500 characters of list card. Judging alignment
      // from a card is what made the deterministic score necessary in the first
      // place, and that score was guessing.
      description: job.description || job.compact_text
```

- [ ] **Step 2: Add the criteria that left the deterministic layers**

In `buildJobEvaluatorPrompt`, add these lines to the array, after the existing "Preferences" line:

```js
    "MODALIDADE: se trusted_profile.work_eligibility.remote_only for verdadeiro e a descricao indicar trabalho presencial ou hibrido — mesmo que o anuncio esteja marcado como remoto — reprove com a risk flag \"modalidade_divergente\".",
    "SENIORIDADE DISFARCADA: um titulo de nivel pleno/senior cujo texto descreve gestao de pessoas, lideranca de time ou responsabilidade de arquitetura deve ser reprovado, ainda que o titulo nao diga manager/lead.",
    "VISTO: se a descricao declarar que nao ha patrocinio de visto e trusted_profile.work_eligibility.requires_visa_sponsorship for verdadeiro, reprove com a risk flag \"sem_patrocinio_visto\".",
    "STACK: avalie alinhamento contra a experiencia recente em trusted_profile. Nao existe lista fixa de tecnologias: julgue pelo perfil, nao por palavras-chave.",
```

- [ ] **Step 3: Verify**

Run: `node --check src/cli.js && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
rtk git add src/cli.js && \
rtk git commit -m "$(cat <<'EOF'
Dê ao avaliador a descrição real e os critérios que saíram do código

Modalidade divergente, senioridade disfarçada no título, recusa de visto e
alinhamento de stack passam a ser julgados pelo modelo sobre o anúncio inteiro.
É esta camada que escala: critério novo é uma frase no prompt, não um regex.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Actionable digest

**Files:**
- Modify: `src/email-template.js` (add `renderJobDigestEmail`)
- Modify: `src/cli.js:3975-4000` (digest block)
- Create: `src/job-digest.js`, `src/job-digest.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `FILTER_STAGES` (Task 4), `markRecordsDigested` (Task 6).
- Produces:
  - `selectDigestJobs(jobs: object[]) => Array<{job, category, reason}>` with categories `no_easy_apply`, `over_cap`, `quarantined`, `enrichment_failed`
  - `renderJobDigestEmail({entries, consoleUrl}) => {subject, text, html}`

- [ ] **Step 1: Write the failing test**

Create `src/job-digest.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { selectDigestJobs } from "./job-digest.js";
import { renderJobDigestEmail } from "./email-template.js";

function job(overrides) {
  return { external_id: "1", title: "Backend", company: "Acme", url: "https://x", easy_apply: true, ...overrides };
}

test("a job without Easy Apply is actionable", () => {
  const entries = selectDigestJobs([job({ easy_apply: false, external_apply_url: "https://acme.com/apply" })]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].category, "no_easy_apply");
});

test("a job cut by the run cap reaches the user instead of vanishing", () => {
  const entries = selectDigestJobs([job({ filter_outcome: { code: "over_run_cap", stage: "cap" } })]);
  assert.equal(entries[0].category, "over_cap");
});

test("a quarantined job is actionable", () => {
  const entries = selectDigestJobs([job({ blocked_until: "2099-01-01T00:00:00.000Z" })]);
  assert.equal(entries[0].category, "quarantined");
});

test("a decision is not a pending item and stays out of the email", () => {
  const decisions = [
    job({ filter_outcome: { code: "blocked_company", stage: "prefilter" } }),
    job({ filter_outcome: { code: "work_mode_not_remote", stage: "prefilter" } }),
    job({ filter_outcome: { code: "model_rejected", stage: "model" } }),
    job({ filter_outcome: { code: "not_eligible", stage: "eligibility" } })
  ];
  assert.deepEqual(selectDigestJobs(decisions), []);
});

test("a job appearing in two lists is listed once, richest copy first", () => {
  const card = job({ easy_apply: false, external_apply_url: "" });
  const enriched = job({ easy_apply: false, external_apply_url: "https://acme.com/apply" });
  const entries = selectDigestJobs([enriched, card]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].job.external_apply_url, "https://acme.com/apply");
});

test("an already sent job is not in the digest", () => {
  assert.deepEqual(selectDigestJobs([job({ applied: true })]), []);
});

test("a job already digested is not repeated", () => {
  assert.deepEqual(selectDigestJobs([job({ easy_apply: false, digested_at: "2026-08-05T00:00:00.000Z" })]), []);
});

test("the rendered email carries the direct apply link and escapes the title", () => {
  const rendered = renderJobDigestEmail({
    entries: [{
      job: job({ easy_apply: false, title: "Dev <script>", external_apply_url: "https://acme.com/apply" }),
      category: "no_easy_apply",
      reason: "Sem candidatura simplificada."
    }],
    consoleUrl: "http://127.0.0.1:4321"
  });

  assert.match(rendered.text, /https:\/\/acme\.com\/apply/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
});

test("an empty digest renders nothing to send", () => {
  assert.equal(renderJobDigestEmail({ entries: [] }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/job-digest.test.js`
Expected: FAIL — `Cannot find module './job-digest.js'`

- [ ] **Step 3: Write the selector**

Create `src/job-digest.js`:

```js
/**
 * What belongs in the digest email.
 *
 * The dividing line is whether the user can do something about it. A vacancy
 * the agent could not submit is a pending item; a vacancy it decided against —
 * a block list, an ineligible restricted posting, a model rejection — is a
 * decision, and mailing decisions is how the digest turned into noise. Those
 * stay in the table, with their reason in filter_stage.
 */

const CATEGORIES = {
  no_easy_apply: "Sem candidatura simplificada: candidate-se no site da empresa.",
  over_cap: "Excedeu o limite de candidaturas desta execução; continua disponível para envio manual.",
  quarantined: "Em quarentena após uma falha de envio; precisa de revisão.",
  enrichment_failed: "Não foi possível ler o anúncio completo."
};

export function selectDigestJobs(jobs, now = new Date()) {
  const entries = [];
  // The caller passes overlapping lists — a job promoted to enrichment appears
  // again as its enriched copy — so identity is the job id and the first entry
  // wins. Callers must therefore pass the richest list first; `enriched` before
  // `promoted`, or the digest would describe the job by its card data.
  const seen = new Set();
  for (const job of jobs || []) {
    if (job.applied || job.digested_at) continue;
    if (seen.has(job.external_id)) continue;
    seen.add(job.external_id);

    const code = job.filter_outcome?.code || "";
    let category = null;

    if (code === "over_run_cap" || code === "over_daily_cap" || code === "over_weekly_cap") category = "over_cap";
    else if (job.blocked_until && new Date(job.blocked_until).getTime() > now.getTime()) category = "quarantined";
    else if (code === "enrichment_failed") category = "enrichment_failed";
    else if (!job.easy_apply) category = "no_easy_apply";

    if (category) entries.push({ job, category, reason: CATEGORIES[category] });
  }
  return entries;
}

export { CATEGORIES as DIGEST_CATEGORIES };
```

- [ ] **Step 4: Write the renderer**

Add to `src/email-template.js`, reusing its `escapeHtml`. Every value comes from a scraped posting, so nothing is interpolated unescaped:

```js
const DIGEST_HEADINGS = {
  no_easy_apply: "Candidatura no site da empresa",
  over_cap: "Não coube nesta execução",
  quarantined: "Precisa de revisão",
  enrichment_failed: "Anúncio não pôde ser lido"
};

/**
 * The digest of what the pipeline could not send by itself.
 *
 * @returns {{subject: string, text: string, html: string}|null} null when there is nothing to send
 */
export function renderJobDigestEmail({ entries = [], consoleUrl = "http://127.0.0.1:4321" } = {}) {
  if (!entries.length) return null;

  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.category)) groups.set(entry.category, []);
    groups.get(entry.category).push(entry);
  }

  const date = new Date().toISOString().slice(0, 10);
  const subject = `[Hirable] ${entries.length} vaga(s) para você · ${date}`;

  const textBlocks = [];
  const htmlBlocks = [];
  for (const [category, items] of groups) {
    const heading = DIGEST_HEADINGS[category] || category;
    textBlocks.push(`## ${heading} (${items.length})`);
    htmlBlocks.push(`<h2 style="margin:24px 0 8px;font-size:15px;color:#0f172a">${escapeHtml(heading)} (${items.length})</h2>`);

    for (const { job, reason } of items) {
      const link = job.external_apply_url || job.url;
      textBlocks.push(`- ${job.title} — ${job.company}\n  ${link}\n  ${reason}`);
      htmlBlocks.push(`<p style="margin:0 0 12px;font-size:13px;line-height:1.5">
        <a href="${escapeHtml(link)}" style="color:#2563eb;font-weight:600;text-decoration:none">${escapeHtml(job.title)}</a>
        <span style="color:#64748b"> · ${escapeHtml(job.company)}</span><br>
        <span style="color:#94a3b8">${escapeHtml(reason)}</span>
      </p>`);
    }
    textBlocks.push("");
  }

  return {
    subject,
    text: [...textBlocks, consoleUrl].join("\n"),
    html: `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
    <tr><td style="padding:24px">
      <h1 style="margin:0 0 4px;font-size:18px;color:#0f172a">Vagas que o agente não pôde enviar</h1>
      <p style="margin:0 0 8px;font-size:13px;color:#64748b">Cada vaga traz o motivo de ter chegado até você.</p>
      ${htmlBlocks.join("\n")}
      <a href="${escapeHtml(consoleUrl)}" style="display:inline-block;margin-top:12px;padding:9px 16px;background:#0f172a;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Abrir o console</a>
    </td></tr>
  </table>
</body></html>`
  };
}
```

- [ ] **Step 5: Replace the digest block in cli.js**

Replace the `if (emailState.enabled && ... digestGate.ready)` block (line 3989) with:

```js
    if (emailState.enabled && emailState.settings?.job_digest_enabled && digestGate.ready) {
      const entries = selectDigestJobs([...enriched, ...overCapJobs, ...promoted]);
      const rendered = renderJobDigestEmail({ entries });
      if (rendered) {
        await sendGmail({
          to: emailState.settings.email_to,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          attachments: buildResumeAttachments(entries.map((entry) => entry.job), config)
        }).catch((error) => notifyError(error, { command: "gmail.job_alert" }));

        // Stamped only after the send, so a failed delivery is retried next run.
        store.markRecordsDigested(
          entries.map((entry) => buildRecordId("jobs", "job", entry.job.external_id)),
          nowIso()
        );
      }
    }
```

Add the imports: `import { selectDigestJobs } from "./job-digest.js";`, `renderJobDigestEmail` to the existing `email-template.js` import, and `buildRecordId` to the existing `agent-record.js` import.

- [ ] **Step 6: Register the test file and verify**

Append ` src/job-digest.test.js` to the `test` script in `package.json`.

Run: `node --check src/job-digest.js && node --check src/email-template.js && node --check src/cli.js && npm test`
Expected: PASS, 8 new tests.

- [ ] **Step 7: Commit**

```bash
rtk git add src/job-digest.js src/job-digest.test.js src/email-template.js src/cli.js package.json && \
rtk git commit -m "$(cat <<'EOF'
Torne o digest acionável e carimbe o envio

A linha divisória passa a ser se o usuário pode fazer algo: vaga que o agente
não conseguiu enviar é pendência; vaga que ele decidiu recusar é decisão, e
mandar decisões por e-mail foi como o digest virou ruído.

digested_at é carimbado só depois do envio, para que uma entrega que falhou
seja tentada de novo na próxima execução.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Parameter-drift alert

**Files:**
- Modify: `src/cli.js` (`runJobsScan`, after the enrichment loop)

**Interfaces:**
- Consumes: `workModeDisagreements` and `promoted.length` from Task 9; `notifyOperationalAlert` (existing, `cli.js:392`).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Add the check**

After the enrichment loop in `runJobsScan`:

```js
    // Layer 1 is an optimization, not a guarantee. A posting that contradicts
    // its own badge is normal; a whole run contradicting it means the parameter
    // stopped working, and every decision it was carrying is now unfiltered.
    const enrichedSample = promoted.length;
    if (enrichedSample >= 5 && workModeDisagreements / enrichedSample > 0.3) {
      await notifyOperationalAlert(
        `O filtro de modalidade do LinkedIn parece ter parado de funcionar: ${workModeDisagreements} de ${enrichedSample} vagas contradizem o parâmetro f_WT.`,
        { command: "jobs:scan", status: "search_parameter_drift" }
      );
    }
```

The threshold and the minimum sample exist together: a run of three jobs cannot say anything about a parameter, and alerting on it would train the user to ignore the alert. `alert-dedupe.js` already collapses repeats.

- [ ] **Step 2: Verify**

Run: `node --check src/cli.js && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
rtk git add src/cli.js && \
rtk git commit -m "$(cat <<'EOF'
Avise quando o parâmetro de busca do LinkedIn parar de funcionar

Anúncio que se contradiz é normal; uma execução inteira contradizendo o f_WT
significa que o parâmetro caiu, e toda decisão que ele carregava está passando
sem filtro. A amostra mínima existe junto com o limiar: três vagas não dizem
nada sobre um parâmetro, e alertar sobre isso ensina o usuário a ignorar o aviso.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Console surface

The new settings fields and the filter transparency in the jobs table.

**Files:**
- Modify: `web/src/lib/i18n.tsx`, `web/src/pages/JobsPage.tsx`, `web/src/components/GeneralSettingsCard.tsx`
- Modify: `src/web/server.js` if the settings endpoint enumerates field types (`string_list` must render)
- Modify: `src/integrations.test.js` (client-payload regression coverage)

**Interfaces:**
- Consumes: the record fields from Task 6 and the config paths from Task 5.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

In `src/integrations.test.js`, extend the client-facing payload scan so the new record fields are covered and no secret rides along. Add:

```js
test("os campos novos do registro chegam ao cliente sem segredo junto", () => {
  const record = normalizeJobRecord(
    { external_id: "1", title: "Backend", easy_apply: true, work_mode: "remote", posted_at: "2026-08-05T12:00:00.000Z" },
    null,
    { filterStage: "prefilter" }
  );
  for (const key of ["work_mode", "posted_at", "filter_stage", "blocked_until", "digested_at"]) {
    assert.ok(key in record, key);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/integrations.test.js`
Expected: FAIL if Task 6 was not applied; PASS if it was — in that case this step only confirms coverage, which is its purpose.

- [ ] **Step 3: Render `string_list` in settings**

In `web/src/components/GeneralSettingsCard.tsx`, add the type to the `wide` test at line 111:

```tsx
                const wide = field.type === "searches" || field.type === "known_answers"
                  || field.type === "string_map" || field.type === "string_list";
```

Add a case to `ConfigControl` (line 160), before `default`:

```tsx
    case "string_list":
      return <StringListControl field={field} value={Array.isArray(value) ? value : []} onChange={onChange} t={t} />;
```

And add the component next to `StringMapControl`:

```tsx
function StringListControl({
  field,
  value,
  onChange,
  t
}: {
  field: ConfigField;
  value: string[];
  onChange: (value: string[]) => void;
  t: Translate;
}) {
  const helpKey = field.path === "jobs_watcher.blocked_apply_domains"
    ? "settings.blockedDomains.help"
    : "settings.blockedCompanies.help";

  return (
    <div className="space-y-1.5">
      <Textarea
        id={field.path}
        rows={4}
        value={value.join("\n")}
        placeholder={field.path === "jobs_watcher.blocked_apply_domains" ? "example-website.ai" : "example-website"}
        // Split on save, join on load: the server coerces, deduplicates and
        // trims, so the textarea never has to be the one enforcing shape.
        onChange={(event) => onChange(event.target.value.split("\n"))}
      />
      <p className="text-xs text-muted-foreground">{t(helpKey)}</p>
    </div>
  );
}
```

`Textarea` is already exported from `@/components/ui/textarea`; add it to the imports if the file does not import it yet.

- [ ] **Step 4: Show the filter stage and freshness in the jobs table**

In `web/src/pages/JobsPage.tsx`, add a header cell after `jobs.location` (line 177):

```tsx
                <TableHead className="w-28">{t("jobs.column.postedAt")}</TableHead>
```

Bump the empty-state `colSpan={6}` at line 185 to `colSpan={7}`.

Add the matching body cell after the location cell:

```tsx
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {record.posted_at ? relativeAge(record.posted_at, locale) : "—"}
                    </TableCell>
```

In the badge row at line 203, add the work mode and the filter stage, so a discarded job says which layer discarded it right next to why:

```tsx
                        {record.work_mode && record.work_mode !== "unknown" ? (
                          <Badge variant="outline">{t(`jobs.workMode.${record.work_mode}`)}</Badge>
                        ) : null}
                        {record.filter_stage ? (
                          <Badge variant="secondary">{t(`jobs.filterStage.${record.filter_stage}`)}</Badge>
                        ) : null}
```

Add `relativeAge` to `web/src/lib/format.ts` if it has no equivalent:

```ts
export function relativeAge(iso: string, locale: "pt-BR" | "en"): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(days)) return "—";
  if (days <= 0) return locale === "pt-BR" ? "hoje" : "today";
  return locale === "pt-BR" ? `há ${days}d` : `${days}d ago`;
}
```

Add `posted_at`, `work_mode` and `filter_stage` to the record type in `web/src/lib/api.ts` so `tsc --noEmit` accepts the new fields.

- [ ] **Step 5: Add every new string to both i18n maps**

Add to **both** the `pt-BR` and the `en` map in `web/src/lib/i18n.tsx`. Portuguese with accents:

```
jobs.filterStage.search / prefilter / enrichment / model / eligibility / cap
jobs.column.postedAt        "Publicada"        / "Posted"
jobs.column.workMode        "Modalidade"       / "Work mode"
jobs.workMode.remote        "Remota"           / "Remote"
jobs.workMode.hybrid        "Híbrida"          / "Hybrid"
jobs.workMode.onsite        "Presencial"       / "On-site"
jobs.workMode.unknown       "Não informada"    / "Not stated"
settings.blockedCompanies.help   "Uma empresa por linha."      / "One company per line."
settings.blockedDomains.help     "Um domínio por linha."       / "One domain per line."
```

- [ ] **Step 6: Verify**

Run: `npm test && npx --prefix web tsc --noEmit && npm --prefix web run build`
Expected: PASS, including the test that asserts no unaccented Portuguese placeholders.

- [ ] **Step 7: Commit**

```bash
rtk git add web/src src/integrations.test.js src/web/server.js && \
rtk git commit -m "$(cat <<'EOF'
Mostre a camada que descartou a vaga e edite as listas de bloqueio

Sem filter_stage na interface o usuário só vê a vaga sumir, que é a opacidade
que motivou a mudança inteira. Modalidade e data de publicação passam a ser
colunas porque agora existem de verdade.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] `npm test` — every suite, including the eight new files registered in `package.json`
- [ ] `npx --prefix web tsc --noEmit`
- [ ] `npm --prefix web run build`
- [ ] `npm run validate`
- [ ] `LINKEDIN_JOBS_READ_ONLY=true npm run jobs:scan` — inspect `filter_breakdown`, `stop_reasons` and `work_mode_disagreements` to confirm empirically which LinkedIn parameters are still honoured
- [ ] Confirm the behaviour change the spec warns about: with `easy_apply_enabled=false`, the pipeline now applies to nothing. This is the fix, not a regression.
