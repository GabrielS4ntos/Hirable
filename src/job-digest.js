/**
 * What belongs in the digest email.
 *
 * The dividing line is whether the user can do something about it. A vacancy
 * the agent could not submit is a pending item; a vacancy it decided against —
 * a block list, an ineligible restricted posting, a model rejection — is a
 * decision, and mailing decisions is how the digest turned into noise. Those
 * stay in the table, with their reason in filter_stage.
 */

export const DIGEST_CATEGORIES = {
  no_easy_apply: "Sem candidatura simplificada: candidate-se no site da empresa.",
  over_cap: "Excedeu o limite de candidaturas desta execução; continua disponível para envio manual.",
  quarantined: "Em quarentena após uma falha de envio; precisa de revisão.",
  enrichment_failed: "Não foi possível ler o anúncio completo."
};

const CAP_CODES = new Set(["over_run_cap", "over_daily_cap", "over_weekly_cap"]);

/**
 * @param {object[]} jobs  possibly overlapping lists; see the dedupe note below
 * @param {Date} now
 * @returns {Array<{job: object, category: string, reason: string}>}
 */
export function selectDigestJobs(jobs, now = new Date()) {
  const entries = [];
  // The caller passes overlapping lists — a job promoted to enrichment appears
  // again as its enriched copy — so identity is the job id and the first entry
  // wins. Callers must therefore pass the richest list first: `enriched` before
  // `promoted`, or the digest would describe the job by its card data.
  const seen = new Set();

  for (const job of jobs || []) {
    if (!job || job.applied || job.digested_at) continue;
    if (seen.has(job.external_id)) continue;
    seen.add(job.external_id);

    const code = job.filter_outcome?.code || "";
    let category = null;

    if (CAP_CODES.has(code)) category = "over_cap";
    else if (job.blocked_until && new Date(job.blocked_until).getTime() > now.getTime()) category = "quarantined";
    else if (code === "enrichment_failed") category = "enrichment_failed";
    else if (!job.easy_apply) category = "no_easy_apply";

    if (category) entries.push({ job, category, reason: DIGEST_CATEGORIES[category] });
  }
  return entries;
}
