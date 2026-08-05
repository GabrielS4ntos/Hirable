#!/usr/bin/env node
/**
 * Fills a throwaway database with believable data, for screenshots and for
 * looking at the interface without waiting for real runs.
 *
 * It refuses to touch the real database on purpose: these rows are fiction, and
 * the screenshots they produce end up committed in the README, so nothing here
 * should ever mix with a real profile, real keys or real job searches.
 *
 *   node scripts/seed-demo.mjs /tmp/demo/app.sqlite
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppStore } from "../src/app-store.js";
import { normalizeDmRecord, normalizeInviteRecord, normalizeJobRecord } from "../src/agent-record.js";
import { sessionRecord } from "../src/linkedin-session.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];

if (!target) {
  console.error("Usage: node scripts/seed-demo.mjs <database-path>");
  process.exit(2);
}
if (path.resolve(target).startsWith(path.join(ROOT, "data"))) {
  console.error("Recusado: escolha um caminho fora de ./data — este script escreve dados fictícios.");
  process.exit(2);
}

const databasePath = path.resolve(target);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
fs.rmSync(databasePath, { force: true });
const store = new AppStore(databasePath);

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

/* ------------------------------------------------------------- user_profile */

store.saveUserProfile({
  resume_text: [
    "Alex Moreira — Engenheiro de Software Backend",
    "8 anos construindo APIs e sistemas distribuídos em Node.js, TypeScript e Go.",
    "Experiência com Postgres, Redis, Kafka, AWS e Kubernetes.",
    "alex.moreira@example.com · São Paulo, SP"
  ].join("\n"),
  profile: {
    identity: {
      full_name: "Alex Moreira",
      name_aliases: ["Alex M."],
      email: "alex.moreira@example.com",
      phone_country: "Brazil (+55)",
      phone: "11999990000",
      city: "São Paulo",
      country: "Brasil",
      postal_code: "01310100",
      linkedin_url: "https://www.linkedin.com/in/alex-moreira-demo/"
    },
    professional: {
      headline: "Engenheiro de Software Backend Sênior",
      target_roles: ["Backend Engineer", "Staff Engineer", "Tech Lead"],
      years_experience: 8,
      seniority: "senior",
      english_level: "Avançado",
      other_languages: ["Espanhol - B1"],
      salary_expectation_usd: 9000,
      salary_expectation_brl: 25000,
      top_technologies: ["Node.js", "TypeScript", "Go", "Postgres", "Kubernetes"],
      verifiable_facts: [
        "Reduziu a latência p99 de um serviço de pagamentos de 800ms para 120ms",
        "Liderou a migração de um monólito para 6 serviços sem downtime"
      ]
    },
    work_eligibility: {
      countries_authorized: ["Brasil"],
      needs_visa_sponsorship: "nao",
      willing_to_relocate: "nao",
      remote_only: "sim",
      notice_period_days: 30
    },
    demographics: {
      pcd: "nao_declarado",
      veterano: "nao_declarado",
      genero: "nao_declarado",
      identidade_de_genero: "nao_declarado",
      raca_etnia: "nao_declarado",
      orientacao_sexual: "nao_declarado"
    },
    years_by_technology: { "Node.js": 8, TypeScript: 6, Go: 3, Postgres: 7, Kubernetes: 4 },
    recent_experiences: [
      { company: "Fintech Aurora", role: "Engenheiro Backend Sênior", start: "2022-03", end: "atual",
        summary: "Plataforma de pagamentos: APIs em Go, filas Kafka, 4M de transações/dia." },
      { company: "Loja Nimbus", role: "Engenheiro Backend Pleno", start: "2019-01", end: "2022-02",
        summary: "Catálogo e checkout em Node.js, migração para Kubernetes." }
    ],
    education: [
      { institution: "Universidade de São Paulo", degree: "Bacharelado em Ciência da Computação", year: "2018" }
    ]
  },
  complete_onboarding: true
});

/* ------------------------------------------------------------- model_providers + api_keys */

store.createApiKey({ provider: "gemini", label: "Conta pessoal", secret: "AIzaSyDEMO0000000000000000000000demo1" });
store.createApiKey({ provider: "gemini", label: "Conta secundária", secret: "AIzaSyDEMO0000000000000000000000demo2" });
store.createApiKey({ provider: "openrouter", label: "Créditos pré-pagos", secret: "sk-or-v1-demo000000000000000000000000" });
store.settleProviderRoles("gemini", { makePrimary: true });
store.settleProviderRoles("openrouter");
store.setProviderModel("gemini", "gemini-3.5-flash-lite");
store.setProviderModel("openrouter", "google/gemini-3.5-flash-lite");

/* ------------------------------------------------------------- resume_documents */

const resumes = [
  {
    label: "Currículo Backend",
    original_name: "alex-moreira-backend.pdf",
    index: {
      headline: "Engenheiro Backend Sênior · Node.js e Go",
      roles: ["Backend Engineer", "Staff Engineer"],
      technologies: ["Node.js", "TypeScript", "Go", "Postgres", "Kafka"],
      seniority: "senior",
      summary: "8 anos em APIs e sistemas distribuídos, foco em pagamentos e alta escala."
    }
  },
  {
    label: "Currículo Plataforma",
    original_name: "alex-moreira-plataforma.pdf",
    index: {
      headline: "Engenheiro de Plataforma · Kubernetes e observabilidade",
      roles: ["Platform Engineer", "SRE"],
      technologies: ["Kubernetes", "Terraform", "AWS", "Prometheus", "Go"],
      seniority: "senior",
      summary: "Infraestrutura, CI/CD e confiabilidade em times de produto."
    }
  }
];

const resumesDir = path.join(path.dirname(databasePath), "resumes");
fs.mkdirSync(resumesDir, { recursive: true });
for (const [index, resume] of resumes.entries()) {
  const storedName = `demo-${index + 1}.pdf`;
  fs.writeFileSync(path.join(resumesDir, storedName), "%PDF-1.4 demo\n");
  const id = store.createResume({
    label: resume.label,
    original_name: resume.original_name,
    stored_name: storedName,
    mime_type: "application/pdf",
    size_bytes: 184320 + index * 21000
  });
  store.setResumeIndex(id, resume.index);
  if (index === 0) store.updateResume(id, { is_default: true });
}

/* ------------------------------------------------------------- agent_records: vagas */

const jobs = [
  { external_id: "3901", title: "Senior Backend Engineer", company: "Nimbus Health", location: "Remoto · Brasil",
    easy_apply: true, score: 92, decision: "apply", send_state: "sent_auto", sentBy: "auto", minutes: 42,
    resume_type: "backend", confidence: 88,
    reason: "Stack casa com Node.js e Postgres; vaga remota para o Brasil e senioridade compatível." },
  { external_id: "3902", title: "Staff Engineer, Payments", company: "Aurora Pay", location: "Remoto · LATAM",
    easy_apply: true, score: 89, decision: "apply", send_state: "available", minutes: 96,
    resume_type: "backend", confidence: 84,
    reason: "Experiência direta em pagamentos e alta escala; exige Go, que o currículo cobre." },
  { external_id: "3903", title: "Platform Engineer (Kubernetes)", company: "Vega Cloud", location: "Remoto · Global",
    easy_apply: true, score: 85, decision: "apply", send_state: "sent_manual", sentBy: "manual", minutes: 210,
    resume_type: "plataforma", confidence: 79,
    reason: "Kubernetes e Terraform aparecem no currículo de plataforma; time distribuído." },
  { external_id: "3904", title: "Backend Engineer, Data Platform", company: "Corvo Analytics", location: "Híbrido · São Paulo",
    easy_apply: false, score: 74, decision: "apply", send_state: "unsupported", minutes: 260,
    resume_type: "backend", confidence: 66,
    reason: "Boa aderência técnica, mas a candidatura acontece no site da empresa." },
  { external_id: "3905", title: "Engenheiro de Software Sênior (PCD)", company: "Banco Meridiano", location: "Remoto · Brasil",
    easy_apply: true, score: 81, decision: "reject", send_state: "blocked", minutes: 300,
    reason: "Vaga exclusiva para pessoas com deficiência e o perfil não declara PCD.",
    risk_flags: ["vaga_exclusiva_pcd"] },
  { external_id: "3906", title: "Engineering Manager", company: "Orion Labs", location: "Remoto · Brasil",
    easy_apply: true, score: 58, decision: "reject", send_state: "available", minutes: 340,
    reason: "Posição de gestão; o perfil busca trilha técnica individual." },
  { external_id: "3907", title: "Node.js Developer", company: "Helix Commerce", location: "Remoto · Brasil",
    easy_apply: true, score: 77, decision: "apply", send_state: "failed", minutes: 380,
    resume_type: "backend", confidence: 71,
    reason: "Aderente ao perfil, mas o formulário pediu um campo que o agente não pode responder." },
  { external_id: "3908", title: "Golang Engineer", company: "Petra Logistics", location: "Remoto · LATAM",
    easy_apply: true, score: 83, decision: "apply", send_state: "available", minutes: 410,
    resume_type: "backend", confidence: 76,
    reason: "Go em produção há 3 anos; produto de logística com times remotos." }
];

for (const job of jobs) {
  const record = normalizeJobRecord(
    {
      external_id: job.external_id,
      title: job.title,
      company: job.company,
      location: job.location,
      url: `https://www.linkedin.com/jobs/view/${job.external_id}/`,
      apply_url: `https://www.linkedin.com/jobs/view/${job.external_id}/`,
      easy_apply: job.easy_apply,
      search_name: "backend_remoto",
      compact_text: `${job.title} · ${job.company} · ${job.location}`
    },
    { apply: job.decision === "apply", confidence: job.confidence, reason: job.reason, risk_flags: job.risk_flags || [], resume_type: job.resume_type },
    {
      score: job.score,
      decision: job.decision,
      sendState: job.send_state,
      sentBy: job.sentBy,
      sentAt: job.sentBy ? minutesAgo(job.minutes) : null,
      analyzedAt: minutesAgo(job.minutes + 4)
    }
  );
  record.send_state = job.send_state;
  if (job.send_state === "blocked") record.send_blocked_reason = "vaga exclusiva para um grupo que o perfil não declara";
  if (job.send_state === "failed") record.send_error = "campo obrigatório sem resposta confiável";
  if (job.send_state === "unsupported") record.send_blocked_reason = "sem Easy Apply: candidatura no site da empresa";
  store.upsertAgentRecord(record);
}

/* ------------------------------------------------------------- agent_records: DMs e convites */

const dms = [
  { participant: "Marina Alves", headline: "Tech Recruiter · Nimbus Health", intent: "interview_scheduling",
    reason: "Recrutadora propôs conversa inicial; agenda sugerida para quinta às 15h.", state: "sent_auto", minutes: 65, confidence: 82 },
  { participant: "Rafael Duarte", headline: "Head of Engineering · Aurora Pay", intent: "role_details",
    reason: "Pediu detalhes de senioridade e pretensão; resposta preparada para revisão.", state: "available", minutes: 120, confidence: 74 },
  { participant: "Consultoria Talent+", headline: "Vaga presencial em Campinas", intent: "decline",
    reason: "Vaga presencial fora da preferência remota declarada no perfil.", state: "available", minutes: 190, confidence: 68 }
];
for (const dm of dms) {
  const record = normalizeDmRecord(
    { thread_id: `t-${dm.participant}`, participant: dm.participant, headline: dm.headline,
      url: "https://www.linkedin.com/messaging/", time_label: "hoje" },
    { intent: dm.intent, confidence: dm.confidence, reason: dm.reason, risk_flags: [] },
    { decision: dm.state.startsWith("sent") ? "apply" : "pending", sendState: dm.state,
      sentBy: dm.state === "sent_auto" ? "auto" : null,
      sentAt: dm.state.startsWith("sent") ? minutesAgo(dm.minutes) : null, analyzedAt: minutesAgo(dm.minutes + 3) }
  );
  record.send_state = dm.state;
  store.upsertAgentRecord(record);
}

const invites = [
  { name: "Camila Freitas", headline: "Engineering Manager · Vega Cloud", accepted: true, minutes: 55 },
  { name: "Bruno Tavares", headline: "Staff Engineer · Petra Logistics", accepted: true, minutes: 150 },
  { name: "Growth Agency BR", headline: "Marketing de afiliados", accepted: false, minutes: 240 }
];
for (const invite of invites) {
  const record = normalizeInviteRecord(
    { name: invite.name, headline: invite.headline, url: "https://www.linkedin.com/mynetwork/grow/" },
    { accepted: invite.accepted, decision: invite.accepted ? "accept" : "reject",
      sendState: invite.accepted ? "sent_auto" : "blocked",
      reason: invite.accepted ? "Perfil compatível com a área de atuação." : "Conta promocional sem relação com a área.",
      sentAt: invite.accepted ? minutesAgo(invite.minutes) : null, analyzedAt: minutesAgo(invite.minutes + 2) }
  );
  record.send_state = invite.accepted ? "sent_auto" : "blocked";
  if (!invite.accepted) record.send_blocked_reason = "convite recusado pela política do agente";
  store.upsertAgentRecord(record);
}

/* ------------------------------------------------------------- pipeline_schedules + runs */

store.updateSchedule("jobs", {
  mode: "auto", schedule_kind: "cron", cron: "*/20 8-22 * * *",
  weekdays: [1, 2, 3, 4, 5], window_start: "08:00", window_end: "22:00", jitter_seconds: 90
});
store.updateSchedule("dm", {
  mode: "auto", schedule_kind: "daily_times", daily_times: ["09:05", "13:05", "17:05"],
  weekdays: [1, 2, 3, 4, 5], jitter_seconds: 60
});
store.updateSchedule("network", {
  mode: "auto", schedule_kind: "daily_times", daily_times: ["09:00", "13:00", "17:00"],
  weekdays: [1, 2, 3, 4, 5], jitter_seconds: 45
});

const runs = [
  { pipeline: "jobs", trigger: "auto", status: "success", minutes: 18, seconds: 214, summary: { status: "scanned", job_count: 24, new_job_count: 8, application_count: 2 } },
  { pipeline: "dm", trigger: "auto", status: "success", minutes: 47, seconds: 96, summary: { status: "dm_candidate_found", thread_count: 12, changed_count: 3 } },
  { pipeline: "network", trigger: "auto", status: "success", minutes: 62, seconds: 41, summary: { status: "accepted", accepted_count: 2 } },
  { pipeline: "jobs", trigger: "manual", status: "success", minutes: 210, seconds: 73, summary: { status: "applied", job_id: "3903" } },
  { pipeline: "jobs", trigger: "auto", status: "skipped", minutes: 320, seconds: 1, summary: { status: "skipped", code: "pause_active" } },
  { pipeline: "dm", trigger: "auto", status: "success", minutes: 395, seconds: 88, summary: { status: "no_change", thread_count: 11 } }
];

// Written straight to the table: startRun/finishRun stamp "now", which would make
// every demo run look like it took zero milliseconds.
for (const run of runs) {
  const startedAt = minutesAgo(run.minutes);
  const finishedAt = new Date(Date.parse(startedAt) + run.seconds * 1000).toISOString();
  const id = store.startRun({ pipeline: run.pipeline, trigger: run.trigger });
  store.finishRun(id, { status: run.status, exit_code: 0, summary: run.summary });
  store.db.prepare("UPDATE pipeline_runs SET started_at = ?, finished_at = ?, duration_ms = ? WHERE id = ?")
    .run(startedAt, finishedAt, run.seconds * 1000, id);
}

// The cards show when each pipeline last ran and when it fires next. Both are
// written here because a demo server runs with the scheduler disabled, and an
// idle scheduler would otherwise leave every "next run" blank.
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
store.setScheduleRuntime("jobs", { last_run_at: minutesAgo(18), next_run_at: inMinutes(12), last_status: "success: scanned" });
store.setScheduleRuntime("dm", { last_run_at: minutesAgo(47), next_run_at: inMinutes(73), last_status: "success: dm_candidate_found" });
store.setScheduleRuntime("network", { last_run_at: minutesAgo(62), next_run_at: inMinutes(68), last_status: "success: accepted" });

/* ------------------------------------------------------------- integrações e alertas */

store.saveOAuthClient("google", {
  installed: { client_id: "demo-000000.apps.googleusercontent.com", client_secret: "demo-client-secret" }
});
store.saveOAuthToken("google", {
  token: { access_token: "demo-access", refresh_token: "demo-refresh", scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events" },
  scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar.events"],
  account_email: "alex.moreira@example.com"
});
store.setNotificationSettings({
  email_to: "alex.moreira@example.com", email_enabled: true, alert_on_error: true,
  job_digest_enabled: true, calendar_enabled: true, alert_dedupe_minutes: 120
});

store.saveCliAgent("claude", { enabled: true, make_primary: true });
store.saveCliAgent("codex", { enabled: true });
store.setNotificationSettings({ auto_fix_enabled: true });
store.recordCliAgentRun("claude", { status: "success" });

store.recordAlert(
  { level: "error", command: "jobs:scan", status: "failed", message: "TypeError: cannot read property 'title' of undefined" },
  { windowMinutes: 120, now: new Date(Date.now() - 90 * 60_000) }
);
for (let i = 0; i < 6; i++) {
  store.recordAlert(
    { level: "error", command: "jobs:scan", status: "failed", message: `TypeError: cannot read property 'title' of undefined (${i})` },
    { windowMinutes: 120, now: new Date(Date.now() - (80 - i * 10) * 60_000) }
  );
}
store.recordAlert(
  { level: "warning", command: "dm:check", status: "attention_required", message: "Rate limit do provider atingido; usando fallback." },
  { windowMinutes: 120, now: new Date(Date.now() - 25 * 60_000) }
);

/* ------------------------------------------------------------- sessão e configuração */

store.setSetting("linkedin_session", sessionRecord({ state: "connected", account_name: "Alex Moreira" }));
store.setSetting("profile_extract_last", { source: "file", hash: "demo0000hash", resume_id: null, at: minutesAgo(600) });
store.setConfigOverrides({
  jobs_watcher: {
    searches: [
      { name: "backend_remoto", url: "https://www.linkedin.com/jobs/search/?keywords=backend%20engineer&f_WT=2" },
      { name: "golang_latam", url: "https://www.linkedin.com/jobs/search/?keywords=golang&location=Brazil" }
    ],
    max_easy_apply_per_day: 12
  }
});

// A rate-limit row, so the table is not empty either.
store.consumeRateLimit("profile_extract", { capacity: 3, refillPerSecond: 1 / 30 });

const counts = {
  vagas: store.agentRecordCounts("job"),
  dms: store.agentRecordCounts("dm"),
  convites: store.agentRecordCounts("invite")
};
store.close();

console.log(JSON.stringify({ database: databasePath, counts }, null, 2));
