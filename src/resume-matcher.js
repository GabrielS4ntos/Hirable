/**
 * Picks which résumé to send for a given job.
 *
 * Cost model, and why it is built this way:
 *
 *   Sending the full text of every résumé with every job evaluation is the
 *   obvious approach and the expensive one: N résumés × M jobs × thousands of
 *   tokens, repeated on every scan, for an answer that barely changes.
 *
 *   Instead each résumé is summarized ONCE when it is uploaded (one call per
 *   file, ever) into a compact index: headline, roles, technologies, seniority.
 *   Matching a job then costs nothing — it is keyword overlap against that index.
 *   The job evaluator, which already runs per job, additionally receives the
 *   one-line summaries (~30 tokens each) and may return a `resume_id`; when it
 *   does and the id is valid, it wins, because it saw the full job description.
 *
 * So: 1 model call per résumé upload, 0 extra calls per job, and the model still
 * gets a say through a call that was happening anyway.
 */

const STOP_WORDS = new Set([
  "and", "the", "for", "with", "our", "you", "your", "are", "will", "have", "has", "from", "que",
  "com", "para", "uma", "dos", "das", "por", "como", "mais", "sobre", "anos", "years", "experience",
  "experiencia", "team", "work", "role", "job", "vaga", "empresa", "company", "senior", "pleno"
]);

function tokenize(text) {
  return new Set(
    String(text || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .map((token) => token.replace(/^\.+|\.+$/g, ""))
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  );
}

function jobTokens(job) {
  return tokenize([job?.title, job?.company, job?.location, job?.compact_text].filter(Boolean).join(" "));
}

/**
 * Deterministic affinity between a job and one indexed résumé, 0..100.
 *
 * Technologies weigh most: they are the strongest signal that a résumé is the
 * right one, and the least ambiguous to match.
 */
export function scoreResumeForJob(job, resume) {
  const tokens = jobTokens(job);
  if (!tokens.size) return 0;

  const technologies = (resume?.technologies || []).map((item) => tokenize(item));
  const roles = (resume?.roles || []).map((item) => tokenize(item));
  const headline = tokenize(`${resume?.headline || ""} ${resume?.label || ""}`);

  const overlap = (sets) => sets.reduce((total, set) => total + ([...set].some((token) => tokens.has(token)) ? 1 : 0), 0);

  const technologyHits = overlap(technologies);
  const roleHits = overlap(roles);
  const headlineHits = [...headline].filter((token) => tokens.has(token)).length;

  const technologyScore = technologies.length ? (technologyHits / technologies.length) * 60 : 0;
  const roleScore = roles.length ? (roleHits / roles.length) * 30 : 0;
  const headlineScore = Math.min(10, headlineHits * 3);

  return Math.round(technologyScore + roleScore + headlineScore);
}

/**
 * Chooses a résumé for a job.
 *
 * @param {object} job
 * @param {object[]} resumes      indexed résumés from the store
 * @param {object} [options]
 * @param {string} [options.modelResumeId]  id the job evaluator returned, if any
 * @returns {{ resume: object|null, source: string, score: number, ranked: object[] }}
 */
export function pickResumeForJob(job, resumes, { modelResumeId = null } = {}) {
  const available = (resumes || []).filter(Boolean);
  if (!available.length) return { resume: null, source: "none", score: 0, ranked: [] };

  const ranked = available
    .map((resume) => ({ resume, score: scoreResumeForJob(job, resume) }))
    .sort((left, right) => right.score - left.score);

  // The evaluator read the full description, so its choice wins when it is real.
  if (modelResumeId) {
    const chosen = available.find((resume) => resume.id === modelResumeId);
    if (chosen) {
      return {
        resume: chosen,
        source: "model",
        score: ranked.find((item) => item.resume.id === chosen.id)?.score ?? 0,
        ranked
      };
    }
  }

  const best = ranked[0];
  const runnerUp = ranked[1];

  // A tie, or no signal at all, is not a decision: fall back to the default so
  // the choice is predictable instead of arbitrary.
  const decisive = best.score > 0 && (!runnerUp || best.score > runnerUp.score);
  if (decisive) return { resume: best.resume, source: "keywords", score: best.score, ranked };

  const fallback = available.find((resume) => resume.is_default) || available[0];
  return { resume: fallback, source: best.score > 0 ? "default_tie" : "default", score: 0, ranked };
}

/** Compact view sent to the job evaluator: a few dozen tokens per résumé. */
export function resumeCandidatesForModel(resumes) {
  return (resumes || []).slice(0, 8).map((resume) => ({
    resume_id: resume.id,
    label: resume.label,
    headline: resume.headline || "",
    roles: (resume.roles || []).slice(0, 4),
    technologies: (resume.technologies || []).slice(0, 12)
  }));
}
