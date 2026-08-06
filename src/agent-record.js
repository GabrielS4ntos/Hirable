import crypto from "node:crypto";

/**
 * Canonical shape produced by every pipeline agent.
 *
 * All pipelines (jobs, dm, network) normalize their agent output into this
 * single record so the web UI can render them in one consistent table.
 *
 * kind         what the record represents: job | dm | invite
 * decision     what the agent decided: apply | reject | review | reply | accept | pending
 * status       lifecycle: analyzed | sent | needs_review | skipped | failed
 * send_method  how it can be delivered: easy_apply | external | dm_reply | invite_accept | none
 * send_state   what the UI button must do (see SEND_STATES)
 */

export const RECORD_KINDS = ["job", "dm", "invite"];
export const DECISIONS = ["apply", "reject", "review", "reply", "accept", "pending"];
export const RECORD_STATUSES = ["analyzed", "sent", "needs_review", "skipped", "failed"];
export const SEND_METHODS = ["easy_apply", "external", "dm_reply", "invite_accept", "none"];

/**
 * available   -> button enabled, manual send possible
 * failed      -> button enabled, retry
 * in_progress -> button disabled, a send is running right now
 * sent_auto   -> button disabled, already sent by the automatic pipeline
 * sent_manual -> button disabled, already sent from this UI
 * unsupported -> button disabled, no automatic send method for this item
 * blocked     -> button disabled, agent or safety rules refuse the send
 */
export const SEND_STATES = [
  "available",
  "failed",
  "in_progress",
  "sent_auto",
  "sent_manual",
  "unsupported",
  "blocked"
];

export const SENDABLE_STATES = ["available", "failed"];

export function isSendable(record) {
  return SENDABLE_STATES.includes(record?.send_state);
}

export function buildRecordId(pipeline, kind, externalId) {
  return crypto.createHash("sha256")
    .update(`${pipeline}|${kind}|${externalId}`)
    .digest("hex")
    .slice(0, 32);
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function cleanText(value, limit = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function baseRecord({ pipeline, kind, externalId }) {
  return {
    record_id: buildRecordId(pipeline, kind, externalId),
    pipeline,
    kind,
    external_id: String(externalId),
    title: "",
    subtitle: "",
    location: "",
    url: "",
    action_url: "",
    source: "",
    score: null,
    decision: "pending",
    confidence: null,
    risk_flags: [],
    reason: "",
    variant: "",
    status: "analyzed",
    send_method: "none",
    send_state: "unsupported",
    send_blocked_reason: "",
    sent_at: null,
    sent_by: null,
    analyzed_at: new Date().toISOString(),
    work_mode: "unknown",
    posted_at: null,
    filter_stage: "",
    blocked_until: null,
    digested_at: null,
    raw: {}
  };
}

/**
 * Normalizes one scanned/evaluated LinkedIn job into the canonical record.
 *
 * @param {object} job              raw job extracted from the jobs pipeline
 * @param {object|null} evaluation  model evaluation ({apply, resume_type, confidence, risk_flags, reason})
 * @param {object} context          { score, decision, status, sendState, blockedReason, sentBy, sentAt, applicationResult }
 */
export function normalizeJobRecord(job, evaluation = null, context = {}) {
  const record = baseRecord({ pipeline: "jobs", kind: "job", externalId: job.external_id });

  record.title = cleanText(job.title) || `Vaga ${job.external_id}`;
  record.subtitle = cleanText(job.company);
  record.location = cleanText(job.location, 160);
  // "unknown" rather than an empty string: the prefilter treats not-knowing as a
  // decision of its own, and an empty string would read as a known blank.
  record.work_mode = ["remote", "hybrid", "onsite", "unknown"].includes(job.work_mode) ? job.work_mode : "unknown";
  record.posted_at = job.posted_at || null;
  record.filter_stage = cleanText(context.filterStage, 40);
  record.blocked_until = context.blockedUntil || null;
  record.url = cleanText(job.url, 2000);
  record.action_url = cleanText(job.apply_url || job.url, 2000);
  record.source = cleanText(job.search_name, 120);
  record.score = clampNumber(context.score ?? job.score, 0, 100);
  record.variant = cleanText(evaluation?.resume_type || context.resume_type, 60);
  record.confidence = evaluation ? clampNumber(evaluation.confidence, 0, 100) : null;
  record.risk_flags = normalizeFlags(evaluation?.risk_flags, job);
  record.reason = cleanText(evaluation?.reason || context.reason, 4000);

  if (context.decision) {
    record.decision = DECISIONS.includes(context.decision) ? context.decision : "pending";
  } else if (evaluation) {
    record.decision = evaluation.apply ? "apply" : "reject";
  } else {
    record.decision = "pending";
  }

  const resolved = resolveJobSendState(job, evaluation, context);
  record.send_method = resolved.send_method;
  record.send_state = resolved.send_state;
  record.send_blocked_reason = resolved.reason;
  record.status = context.status && RECORD_STATUSES.includes(context.status)
    ? context.status
    : resolved.status;
  record.sent_at = context.sentAt || null;
  record.sent_by = context.sentBy || null;
  record.analyzed_at = context.analyzedAt || record.analyzed_at;
  record.raw = {
    job: {
      external_id: job.external_id,
      search_name: job.search_name,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      apply_url: job.apply_url,
      easy_apply: Boolean(job.easy_apply),
      work_mode: record.work_mode,
      posted_at: record.posted_at,
      external_apply_url: job.external_apply_url || "",
      sponsored: Boolean(job.sponsored),
      applied: Boolean(job.applied),
      compact_text: cleanText(job.compact_text, 1200)
    },
    model_evaluation: evaluation || null,
    application_result: context.applicationResult || null,
    decision_reasons: context.decisionReasons || []
  };

  return record;
}

function normalizeFlags(flags, job) {
  const list = Array.isArray(flags) ? flags.map((flag) => cleanText(flag, 80)).filter(Boolean) : [];
  if (job?.sponsored && !list.some((flag) => /sponsor|promot|patrocin/i.test(flag))) list.push("sponsored");
  return Array.from(new Set(list)).slice(0, 12);
}

function resolveJobSendState(job, evaluation, context) {
  if (context.sendState && SEND_STATES.includes(context.sendState)) {
    return {
      send_method: context.sendMethod || (job.easy_apply ? "easy_apply" : "external"),
      send_state: context.sendState,
      reason: cleanText(context.blockedReason, 300),
      status: context.sendState.startsWith("sent") ? "sent" : "analyzed"
    };
  }

  if (!job.easy_apply) {
    return {
      send_method: "external",
      send_state: "unsupported",
      reason: "Vaga sem Candidatura Simplificada: candidatura precisa ser feita no site da empresa.",
      status: "skipped"
    };
  }

  if (job.applied) {
    return {
      send_method: "easy_apply",
      send_state: "sent_auto",
      reason: "LinkedIn já marca esta vaga como candidatada.",
      status: "sent"
    };
  }

  if (evaluation && evaluation.apply === false) {
    return {
      send_method: "easy_apply",
      send_state: "blocked",
      reason: cleanText(evaluation.reason || "Modelo recusou a candidatura.", 300),
      status: "skipped"
    };
  }

  return {
    send_method: "easy_apply",
    send_state: "available",
    reason: "",
    status: "analyzed"
  };
}

/**
 * Normalizes a DM thread handled by the messaging agent.
 */
export function normalizeDmRecord(thread, draft = null, context = {}) {
  const externalId = thread.thread_id || thread.key || thread.participant || thread.url || "unknown";
  const record = baseRecord({ pipeline: "dm", kind: "dm", externalId });

  record.title = cleanText(thread.participant || thread.title) || "Conversa";
  record.subtitle = cleanText(thread.headline || thread.last_message_preview, 240);
  record.location = "";
  record.url = cleanText(thread.url, 2000);
  record.action_url = record.url;
  record.source = cleanText(thread.time_label || "linkedin_messaging", 120);
  record.score = clampNumber(context.score, 0, 100);
  record.confidence = draft ? clampNumber(draft.confidence ?? context.confidence, 0, 100) : null;
  record.risk_flags = normalizeFlags(draft?.risk_flags || context.riskFlags, null);
  record.reason = cleanText(draft?.reason || context.reason, 4000);
  record.variant = cleanText(draft?.intent || context.variant, 60);
  record.decision = context.decision && DECISIONS.includes(context.decision)
    ? context.decision
    : (draft ? "reply" : "pending");

  const sent = Boolean(context.sentAt);
  record.send_method = "dm_reply";
  record.send_state = context.sendState && SEND_STATES.includes(context.sendState)
    ? context.sendState
    : (sent ? "sent_auto" : (draft ? "available" : "blocked"));
  record.send_blocked_reason = record.send_state === "blocked"
    ? cleanText(context.blockedReason || "Nenhuma resposta aprovada pelo validador.", 300)
    : "";
  record.status = record.send_state.startsWith("sent") ? "sent" : "analyzed";
  record.sent_at = context.sentAt || null;
  record.sent_by = context.sentBy || (sent ? "auto" : null);
  record.analyzed_at = context.analyzedAt || record.analyzed_at;
  record.raw = { thread, draft: draft || null, extra: context.extra || null };

  return record;
}

/**
 * Normalizes a network invitation handled by the invites pipeline.
 */
export function normalizeInviteRecord(invite, context = {}) {
  const externalId = invite.invitation_id || invite.name || invite.url || "unknown";
  const record = baseRecord({ pipeline: "network", kind: "invite", externalId });

  record.title = cleanText(invite.name) || "Convite";
  record.subtitle = cleanText(invite.headline, 240);
  record.url = cleanText(invite.url, 2000);
  record.action_url = record.url;
  record.source = "linkedin_network";
  record.decision = context.decision && DECISIONS.includes(context.decision) ? context.decision : "accept";
  record.reason = cleanText(context.reason, 2000);
  record.send_method = "invite_accept";
  record.send_state = context.sendState && SEND_STATES.includes(context.sendState)
    ? context.sendState
    : (context.accepted ? "sent_auto" : "available");
  record.status = record.send_state.startsWith("sent") ? "sent" : "analyzed";
  record.sent_at = context.sentAt || null;
  record.sent_by = context.sentBy || (context.accepted ? "auto" : null);
  record.analyzed_at = context.analyzedAt || record.analyzed_at;
  record.raw = { invite };

  return record;
}

export function describeSendState(record) {
  switch (record?.send_state) {
    case "available":
      return "Pronta para envio manual";
    case "failed":
      return record.send_error ? `Falhou: ${record.send_error}` : "Falhou, tente novamente";
    case "in_progress":
      return "Envio em andamento";
    case "sent_auto":
      return "Enviada pelo processo automático";
    case "sent_manual":
      return "Enviada manualmente por você";
    case "unsupported":
      return record.send_blocked_reason || "Sem método de envio automático";
    case "blocked":
      return record.send_blocked_reason || "Bloqueada pelas regras do agente";
    default:
      return "Estado desconhecido";
  }
}
