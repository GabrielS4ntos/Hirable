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

/**
 * Accent- and case-insensitive, because the user types the block list by hand
 * and "Acme Tecnologia" must match a posting that spells it "Tecnología".
 */
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
 * @returns {{pass: boolean, stage: string, code: string, reason: string}}
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
