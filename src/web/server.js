import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { AppStore, PIPELINES } from "../app-store.js";
import { PROVIDERS } from "../providers.js";
import { describeSchedule, isValidCron, nextRunForSchedule } from "../cron.js";
import { Scheduler } from "../scheduler.js";
import { nextRunOutsidePause, pauseStatus, validatePauseConfig } from "../pause.js";
import { PROFILE_SECTIONS, declaredDemographics, normalizeProfile, profileCompleteness } from "../profile-schema.js";
import { bootstrapDatabasePath, migratePauseConfigV1, migrateProviderRolesV1, resolveConfig } from "../config.js";
import { EDITABLE, coerceEditable, getPath, setPath } from "../config-defaults.js";
import { extractDocumentText } from "../document-text.js";
import { PROFILE_GATE_CODE, profileGateState, resetProfileGateCache } from "../profile-gate.js";
import { assertLaunchAllowed, sandboxEnv } from "../auto-fix-sandbox.js";
import { detectSupervisor } from "../service-restart.js";
import { RESUME_GATE_CODE, evaluateResumeGate } from "../resume-gate.js";
import { createTaskQueue } from "../task-queue.js";
import { isContextOverflowError } from "../model-error.js";
import { extractionChanged, hashResumeFile, hashResumeText } from "../extraction-source.js";
import { LINKEDIN_GATE_CODE, evaluateLinkedInGate } from "../linkedin-gate.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..", "..");
const DIST_DIR = path.join(ROOT, "web", "dist");
const HOST = process.env.WEB_HOST || "127.0.0.1";
const PORT = Number(process.env.WEB_PORT || 4321);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
};

/** Effective configuration, rebuilt whenever the user saves a change. */
function readConfig(store = null) {
  return resolveConfig({ overrides: store ? store.getConfigOverrides() : null });
}

class HttpError extends Error {
  constructor(status, message, code = "request_failed", params = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

async function readBody(req, limitBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, "corpo da requisição muito grande");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

export function createApp({ store, scheduler, getConfig, refreshConfig = () => getConfig() }) {
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  const profileGate = () => profileGateState(store, getConfig());
  const resumeGate = () => evaluateResumeGate(store.listResumes());
  const linkedInSession = () => store.getSetting("linkedin_session", null);
  const linkedInGate = () => evaluateLinkedInGate(linkedInSession());

  /** Refuses anything that drives LinkedIn without a live session. */
  const requireLinkedIn = () => {
    const gate = linkedInGate();
    if (!gate.ready) throw new HttpError(409, gate.reason, LINKEDIN_GATE_CODE);
    return gate;
  };

  /** Refuses anything that would submit an application without a résumé to attach. */
  const requireResume = () => {
    const gate = resumeGate();
    if (!gate.ready) throw new HttpError(409, gate.reason, RESUME_GATE_CODE);
    return gate;
  };

  /** Refuses anything that would start or arm a pipeline with an unfilled profile. */
  const requireProfile = () => {
    const gate = profileGate();
    if (!gate.ready) throw new HttpError(409, gate.reason, PROFILE_GATE_CODE, { missing: gate.missing });
    return gate;
  };

  /* ------------------------------------------------------------------ status */

  route("GET", /^\/api\/status$/, () => {
    const config = getConfig();
    const schedules = store.listSchedules().map((schedule) => ({
      ...schedule,
      summary: describeSchedule(schedule),
      next_run_preview: nextRunOutsidePause(schedule, config).next_run_at
    }));
    const geminiKeys = store.activeApiKeys("gemini").length;
    const openrouterKeys = store.activeApiKeys("openrouter").length;
    // Served from the store's in-memory cache, so the poll never hits SQLite.
    const onboardingComplete = store.isOnboardingComplete();
    return {
      now: new Date().toISOString(),
      timezone: config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      pause: pauseStatus(config),
      onboarding: { complete: onboardingComplete },
      profile_gate: profileGate(),
      resume_gate: resumeGate(),
      linkedin_gate: linkedInGate(),
      scheduler: scheduler.status(),
      schedules,
      counts: {
        // Keyed by record kind, matching RECORD_KINDS.
        job: store.agentRecordCounts("job"),
        dm: store.agentRecordCounts("dm"),
        invite: store.agentRecordCounts("invite")
      },
      keys: { gemini: geminiKeys, openrouter: openrouterKeys },
      // Roles drive routing; the interface uses this to gate model-backed actions.
      providers: store.listProviders().map((provider) => ({
        id: provider.id,
        label: provider.label,
        role: provider.role,
        model: provider.model,
        configured: provider.configured
      })),
      model_gate: {
        provider: getConfig().model_gate?.provider || null,
        job_model: getConfig().model_gate?.job_model || null,
        writer_model: getConfig().model_gate?.writer_model || null,
        fallback_provider: getConfig().model_gate?.fallback_provider || null,
        openrouter_model: getConfig().model_gate?.openrouter_model || null
      }
    };
  });

  /* --------------------------------------------------- profile & onboarding */

  route("GET", /^\/api\/profile$/, () => {
    const stored = store.getUserProfile();
    const profile = normalizeProfile(stored.profile);
    return {
      resume_text: stored.resume_text,
      profile,
      onboarding_complete: stored.onboarding_complete,
      onboarding_completed_at: stored.onboarding_completed_at,
      updated_at: stored.updated_at,
      completeness: profileCompleteness(profile),
      declared_demographics: declaredDemographics(profile),
      // Lets the interface keep "Preencher" disabled until the source changes.
      last_extraction: store.getSetting("profile_extract_last", null),
      sections: PROFILE_SECTIONS
    };
  });

  route("PUT", /^\/api\/profile$/, async (req) => {
    const body = await readBody(req, 4_000_000);
    // normalizeProfile coerces field by field: a bad value falls back to its
    // default without discarding the valid siblings.
    const profile = normalizeProfile(body.profile || {});
    const completeness = profileCompleteness(profile);

    // Everything sent is always persisted. Missing required fields only withhold
    // the onboarding-complete flag, so a partial save is never lost.
    const canComplete = Boolean(body.complete_onboarding) && completeness.complete;
    store.saveUserProfile({
      resume_text: body.resume_text,
      profile,
      complete_onboarding: canComplete
    });

    if (Array.isArray(profile.professional?.target_roles) && profile.professional.target_roles.length > 0) {
      const overrides = structuredClone(store.getConfigOverrides());
      const currentSearches = overrides?.jobs_watcher?.searches || [];
      if (currentSearches.length === 0) {
        try {
          const coercedSearches = coerceEditable("jobs_watcher.searches", profile.professional.target_roles);
          overrides.jobs_watcher ||= {};
          overrides.jobs_watcher.searches = coercedSearches;
          store.setConfigOverrides(overrides);
          refreshConfig();
        } catch {
          // Ignore coercion failure during profile sync
        }
      }
    }

    // The gate changed with this write: re-arm (or park) the schedules now
    // instead of waiting for the next tick.
    resetProfileGateCache();
    scheduler.refreshAllNextRuns();

    const stored = store.getUserProfile();
    return {
      profile,
      resume_text: stored.resume_text,
      onboarding_complete: stored.onboarding_complete,
      saved: true,
      profile_gate: profileGate(),
      completeness,
      declared_demographics: declaredDemographics(profile)
    };
  });

  /**
   * Runs the extraction agent and returns the draft fields. It deliberately does
   * NOT persist anything: the user reviews and edits the form, and only an
   * explicit save writes to the database.
   *
   * Each call costs a model request, so it is rate limited by a bucket stored in
   * SQLite: 3 immediate attempts, then one more every 30 seconds.
   */
  route("POST", /^\/api\/profile\/extract$/, async (req) => {
    const body = await readBody(req, 4_000_000);

    // Two sources, one agent: pasted text, or uploaded files read here so the
    // documents never have to make a round trip through the browser.
    let resumeText = String(body.resume_text || "").trim();
    let marker = { source: "text", hash: hashResumeText(resumeText), resume_id: null, resume_ids: [] };

    // `resume_id` is the single-file shape the form used before; both are read
    // the same way so an older client keeps working.
    const requestedIds = (Array.isArray(body.resume_ids) ? body.resume_ids : [body.resume_id])
      .map((id) => String(id || "").trim())
      .filter(Boolean);

    if (requestedIds.length) {
      const parts = [];
      const contents = [];
      const usedIds = [];

      for (const id of requestedIds) {
        const resume = store.getResume(id);
        if (!resume) throw new HttpError(404, `currículo não encontrado: ${id}`);

        const content = await fsp.readFile(path.join(resumesDir(), resume.stored_name)).catch(() => null);
        if (!content) throw new HttpError(410, `o arquivo não está mais no disco: ${resume.label}`);

        const extracted = extractDocumentText(content, resume.original_name);
        if (!extracted.extracted) {
          // A PDF is stored and attached fine, but its text cannot be read without
          // a dependency this project does not carry — say so instead of guessing.
          throw new HttpError(422, `${resume.label}: ${extracted.reason}`, "resume_not_readable");
        }

        const text = String(extracted.text || "").trim();
        if (!text) continue;
        // Each document is labelled so the agent reads them as separate résumés
        // of one person, not as a single document that contradicts itself.
        parts.push(requestedIds.length > 1 ? `### Currículo: ${resume.label}\n\n${text}` : text);
        contents.push(content);
        usedIds.push(resume.id);
      }

      resumeText = parts.join("\n\n---\n\n");
      marker = {
        source: "file",
        hash: hashResumeFile(Buffer.concat(contents)),
        resume_id: usedIds[0] ?? null,
        resume_ids: usedIds
      };
    }

    if (resumeText.length < 40) throw new HttpError(400, "Cole o texto do currículo antes de preencher");

    const limit = store.consumeRateLimit("profile_extract", { capacity: 3, refillPerSecond: 1 / 30 });
    if (!limit.allowed) {
      throw new HttpError(429, `Aguarde ${limit.retry_after_seconds}s antes de preencher novamente`);
    }

    try {
      const documents = Math.max(1, marker.resume_ids.length);
      const result = await runCliJson("profile:extract", ["--documents", String(documents)], {
        input: resumeText,
        timeoutMs: 120_000
      });
      const profile = normalizeProfile(result?.profile || {});
      // Recorded only on success: a failed run must not disable the button that
      // would let the user try again.
      const lastExtraction = { ...marker, at: new Date().toISOString() };
      store.setSetting("profile_extract_last", lastExtraction);

      return {
        profile,
        resume_text: marker.source === "file" ? resumeText : undefined,
        warnings: result?.warnings || [],
        declared_demographics: declaredDemographics(profile),
        completeness: profileCompleteness(profile),
        last_extraction: lastExtraction,
        rate_limit: { remaining: limit.remaining }
      };
    } catch (error) {
      // Concatenating several résumés is the one thing here that can outgrow the
      // model, and neither retrying nor another key helps — the user has to pick
      // a roomier model or send fewer documents, so say exactly that.
      if (isContextOverflowError(error)) {
        throw new HttpError(
          413,
          "Os currículos somados passam da janela de contexto do modelo. Escolha um modelo com janela maior em Configurações, ou remova alguns currículos antes de preencher.",
          "context_overflow",
          { resume_count: marker.resume_ids.length, characters: resumeText.length }
        );
      }
      throw new HttpError(502, `Falha ao analisar o currículo: ${error.message}`);
    }
  });

  /**
   * Marks the onboarding as done, once the pipeline step has been seen.
   *
   * Saving the profile no longer flips this flag: the first-run flow continues
   * past the profile into scheduling, and only finishing that hands the user to
   * the full console. The completeness rule still applies — the flag can never
   * claim more than the data supports.
   */
  route("POST", /^\/api\/profile\/complete-onboarding$/, () => {
    const stored = store.getUserProfile();
    const profile = normalizeProfile(stored.profile);
    const completeness = profileCompleteness(profile);
    if (!completeness.complete) {
      throw new HttpError(409, "Complete os campos obrigatórios do perfil antes de concluir", "profile_incomplete", {
        missing: completeness.missing
      });
    }
    store.saveUserProfile({ profile, complete_onboarding: true });
    resetProfileGateCache();
    scheduler.refreshAllNextRuns();
    return { onboarding_complete: true, completeness };
  });

  route("POST", /^\/api\/profile\/reset-onboarding$/, () => {
    store.resetOnboarding();
    return { onboarding_complete: false };
  });

  /* ----------------------------------------------------------- integrations */

  const googleOAuth = new GoogleOAuthFlow({ store, getConfig });

  route("GET", /^\/api\/integrations$/, () => ({
    google: store.oauthStatus("google"),
    notifications: store.getNotificationSettings(),
    email_delivery: (() => {
      const { ready, enabled, reason } = store.emailDeliveryState();
      return { ready, enabled, reason };
    })(),
    required_scopes: getConfig().gmail?.scopes || [],
    redirect_uri: `http://127.0.0.1:${getConfig().gmail?.redirect_port || 45819}/oauth2callback`,
    pending_authorization: googleOAuth.pending()
  }));

  route("POST", /^\/api\/integrations\/google\/client$/, async (req) => {
    const body = await readBody(req);
    try {
      return { google: store.saveOAuthClient("google", body.client_json ?? body) };
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  });

  route("POST", /^\/api\/integrations\/google\/connect$/, async () => {
    try {
      return await googleOAuth.start();
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  });

  route("POST", /^\/api\/integrations\/google\/disconnect$/, () => ({
    google: store.disconnectOAuth("google"),
    notifications: store.getNotificationSettings()
  }));

  route("POST", /^\/api\/integrations\/google\/test-email$/, async (req) => {
    const body = await readBody(req);
    const settings = store.getNotificationSettings();
    const to = String(body.to || settings.email_to || "").trim();
    if (!to) throw new HttpError(400, "defina um e-mail de destino antes de testar");
    if (!store.oauthStatus("google").connected) throw new HttpError(409, "conecte uma conta Google antes de testar");

    const limit = store.consumeRateLimit("email_test", { capacity: 3, refillPerSecond: 1 / 60 });
    if (!limit.allowed) throw new HttpError(429, `Aguarde ${limit.retry_after_seconds}s antes de testar novamente`);

    try {
      // `force` bypasses the enabled flag so the user can validate the setup
      // before switching delivery on.
      const result = await runCliJson("gmail:test", [to], { timeoutMs: 60_000 });
      return { status: result?.status || "sent", to };
    } catch (error) {
      store.setOAuthError("google", error.message);
      throw new HttpError(502, `Falha ao enviar: ${error.message}`);
    }
  });

  route("PUT", /^\/api\/integrations\/notifications$/, async (req) => {
    const body = await readBody(req);
    try {
      const { settings, refused } = store.setNotificationSettings(body);
      return {
        notifications: settings,
        refused,
        email_delivery: (() => {
          const { ready, enabled, reason } = store.emailDeliveryState();
          return { ready, enabled, reason };
        })()
      };
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  });

  /* ------------------------------------------------------------- linkedin */

  /**
   * The LinkedIn session, driven from the interface.
   *
   * Connecting runs as a queued CLI command rather than inside this process:
   * the Chromium profile is exclusive, so the login window has to take the same
   * turn a pipeline would, and the queue already guarantees that.
   */
  route("GET", /^\/api\/linkedin$/, () => {
    const session = linkedInSession();
    const running = scheduler.status();
    return {
      session: session || { state: "disconnected", account_name: "", connected_at: null, checked_at: null, last_reason: "" },
      gate: linkedInGate(),
      // A login window is open exactly while that command holds the queue.
      pending: running.running?.pipeline === "linkedin" || running.queued.some((item) => item.pipeline === "linkedin"),
      channel: getConfig().browser?.channel || "",
      channels: ["", "chrome", "msedge"]
    };
  });

  route("POST", /^\/api\/linkedin\/(connect|logout)$/, (req, res, [action]) => {
    const command = action === "connect" ? "linkedin:login" : "linkedin:logout";
    let runId;
    try {
      runId = scheduler.enqueueCommand("linkedin", command, [], "manual");
    } catch (error) {
      if (error.code === "pause_active") throw new HttpError(409, "Pausa global ativa", "pause_active");
      if (error.code === PROFILE_GATE_CODE) throw new HttpError(409, error.message, PROFILE_GATE_CODE);
      throw error;
    }
    return { run_id: runId, session: linkedInSession(), scheduler: scheduler.status() };
  });

  route("POST", /^\/api\/linkedin\/verify$/, async () => {
    const limit = store.consumeRateLimit("linkedin_verify", { capacity: 3, refillPerSecond: 1 / 30 });
    if (!limit.allowed) throw new HttpError(429, `Aguarde ${limit.retry_after_seconds}s antes de verificar novamente`, "rate_limited");

    try {
      await runCliJson("linkedin:status", [], { timeoutMs: 90_000 });
    } catch (error) {
      throw new HttpError(502, `Falha ao verificar a sessão: ${error.message}`);
    }
    return { session: linkedInSession(), gate: linkedInGate() };
  });

  /* -------------------------------------------------------------- resumes */

  const resumesDir = () => path.resolve(ROOT, path.dirname(bootstrapDatabasePath()), "resumes");

  // Indexing is fire-and-forget, so nothing upstream throttles it: dropping ten
  // files in would start ten subprocesses and ten provider calls at once.
  const indexQueue = createTaskQueue({ limit: 2 });

  route("GET", /^\/api\/resumes$/, () => ({ items: store.listResumes() }));

  /**
   * Uploads a résumé. The file is written to disk untouched — that is the copy
   * attached to emails — and only the extracted text is sent to the indexing
   * agent, once, so job matching later costs no model call at all.
   */
  route("POST", /^\/api\/resumes$/, async (req) => {
    const body = await readBody(req, 20_000_000);
    const originalName = String(body.filename || "").trim().replace(/[/\\]/g, "").slice(0, 200);
    if (!originalName) throw new HttpError(400, "informe o nome do arquivo");
    if (!body.content_base64) throw new HttpError(400, "arquivo vazio");

    const content = Buffer.from(String(body.content_base64), "base64");
    if (!content.length) throw new HttpError(400, "arquivo vazio");
    if (content.length > 10 * 1024 * 1024) throw new HttpError(413, "o arquivo passa de 10 MB");

    const extension = originalName.includes(".") ? originalName.split(".").pop().toLowerCase() : "bin";
    const storedName = `${crypto.randomBytes(12).toString("hex")}.${extension}`;
    await fsp.mkdir(resumesDir(), { recursive: true });
    await fsp.writeFile(path.join(resumesDir(), storedName), content, { mode: 0o600 });

    const id = store.createResume({
      label: body.label || originalName.replace(/\.[^.]+$/, ""),
      original_name: originalName,
      stored_name: storedName,
      mime_type: String(body.mime_type || "").slice(0, 120),
      size_bytes: content.length
    });

    // Index in the background: the upload must not wait on a model call.
    const extracted = extractDocumentText(content, originalName);
    if (!extracted.extracted) {
      store.setResumeIndex(id, { error: extracted.reason });
    } else {
      indexQueue
        .run(() => runCliJson("resume:index", [id], { input: extracted.text, timeoutMs: 120_000 }))
        .catch(() => {
          // The CLI already wrote a readable reason before it exited. Only fill
          // one in when it did not get that far — otherwise this overwrites the
          // real message with the tail of a stack trace.
          if (!store.getResume(id)?.index_error) {
            store.setResumeIndex(id, { error: "a indexação do currículo não pôde ser concluída" });
          }
        });
    }

    return { id, items: store.listResumes(), extraction: { kind: extracted.kind, extracted: extracted.extracted, reason: extracted.reason } };
  });

  route("PATCH", /^\/api\/resumes\/([\w-]+)$/, async (req, res, [id]) => {
    const body = await readBody(req);
    try {
      store.updateResume(id, body);
    } catch (error) {
      throw new HttpError(404, error.message);
    }
    return { items: store.listResumes() };
  });

  route("DELETE", /^\/api\/resumes\/([\w-]+)$/, async (req, res, [id]) => {
    const removed = store.deleteResume(id);
    if (!removed) throw new HttpError(404, "currículo não encontrado");
    await fsp.rm(path.join(resumesDir(), removed.stored_name), { force: true }).catch(() => {});
    return { items: store.listResumes() };
  });

  /** Re-runs the indexing agent for a résumé already on disk. */
  route("POST", /^\/api\/resumes\/([\w-]+)\/reindex$/, async (req, res, [id]) => {
    const resume = store.getResume(id);
    if (!resume) throw new HttpError(404, "currículo não encontrado");

    const limit = store.consumeRateLimit("resume_index", { capacity: 5, refillPerSecond: 1 / 30 });
    if (!limit.allowed) throw new HttpError(429, `Aguarde ${limit.retry_after_seconds}s antes de reindexar`);

    const content = await fsp.readFile(path.join(resumesDir(), resume.stored_name)).catch(() => null);
    if (!content) throw new HttpError(410, "o arquivo não está mais no disco");

    const extracted = extractDocumentText(content, resume.original_name);
    if (!extracted.extracted) {
      store.setResumeIndex(id, { error: extracted.reason });
      throw new HttpError(422, extracted.reason);
    }

    try {
      await runCliJson("resume:index", [id], { input: extracted.text, timeoutMs: 120_000 });
    } catch (error) {
      throw new HttpError(502, `Falha ao indexar: ${error.message}`);
    }
    return { items: store.listResumes() };
  });

  /* ------------------------------------------------------------- providers */

  route("GET", /^\/api\/providers$/, () => ({
    items: store.listProviders(),
    catalog: PROVIDERS
  }));

  route("PUT", /^\/api\/providers\/([\w-]+)$/, async (req, res, [provider]) => {
    const body = await readBody(req);
    try {
      if (body.model !== undefined) store.setProviderModel(provider, body.model);
      if (body.role !== undefined) store.setProviderRole(provider, body.role);
      return { items: store.listProviders() };
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  });

  /* -------------------------------------------------------------- api keys */

  route("GET", /^\/api\/keys$/, () => ({ items: store.listApiKeys() }));

  route("POST", /^\/api\/keys$/, async (req) => {
    const body = await readBody(req);
    let id;
    try {
      id = store.createApiKey({
        provider: body.provider,
        label: body.label,
        secret: body.secret,
        enabled: body.enabled !== false,
        priority: body.priority
      });
    } catch (error) {
      throw new HttpError(400, error.message);
    }

    if (body.model) store.setProviderModel(body.provider, body.model);
    // The first provider configured becomes primary; the second, the fallback.
    store.settleProviderRoles(body.provider, { makePrimary: Boolean(body.make_primary) });

    return { id, items: store.listApiKeys(), providers: store.listProviders() };
  });

  route("PATCH", /^\/api\/keys\/([\w-]+)$/, async (req, res, [id]) => {
    const body = await readBody(req);
    store.updateApiKey(id, body);
    return { items: store.listApiKeys() };
  });

  route("DELETE", /^\/api\/keys\/([\w-]+)$/, (req, res, [id]) => {
    const removed = store.deleteApiKey(id);
    if (!removed) throw new HttpError(404, "chave não encontrada");
    return { items: store.listApiKeys() };
  });

  /* ------------------------------------------------------------- pipelines */

  route("GET", /^\/api\/pipelines$/, () => ({
    items: store.listSchedules().map((schedule) => ({
      ...schedule,
      summary: describeSchedule(schedule),
      next_run_preview: nextRunOutsidePause(schedule, getConfig()).next_run_at,
      schedule_error: nextRunOutsidePause(schedule, getConfig()).error
    })),
    available: PIPELINES,
    profile_gate: profileGate(),
    resume_gate: resumeGate(),
    linkedin_gate: linkedInGate()
  }));

  route("PUT", /^\/api\/pipelines\/([\w-]+)$/, async (req, res, [pipeline]) => {
    const body = await readBody(req);
    // Switching a pipeline on is arming an agent: it needs a filled profile.
    if (body.mode === "auto") requireProfile();
    if (body.mode === "auto" && body.schedule_kind === "cron" && !isValidCron(body.cron)) {
      throw new HttpError(400, "expressão cron inválida");
    }
    let updated;
    try {
      updated = store.updateSchedule(pipeline, body);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    const next = scheduler.refreshNextRun(pipeline);
    return { item: { ...store.getSchedule(pipeline), summary: describeSchedule(updated), next_run_preview: next } };
  });

  route("POST", /^\/api\/pipelines\/([\w-]+)\/run$/, (req, res, [pipeline]) => {
    requireProfile();
    requireLinkedIn();
    let runId;
    try {
      runId = scheduler.enqueue(pipeline, "force");
    } catch (error) {
      if (error.code === "pause_active") throw new HttpError(409, "Pausa global ativa", "pause_active");
      if (error.code === PROFILE_GATE_CODE) throw new HttpError(409, error.message, PROFILE_GATE_CODE);
      throw error;
    }
    if (!runId) throw new HttpError(409, "este pipeline já está na fila ou em execução");
    return { run_id: runId, scheduler: scheduler.status() };
  });

  route("POST", /^\/api\/cron\/validate$/, async (req) => {
    const body = await readBody(req);
    const valid = isValidCron(body.cron);
    const preview = valid
      ? collectNextRuns({ mode: "auto", schedule_kind: "cron", cron: body.cron, weekdays: body.weekdays, window_start: body.window_start, window_end: body.window_end }, 5, getConfig())
      : [];
    return { valid, preview };
  });

  /* --------------------------------------------------------------- records */

  route("GET", /^\/api\/records$/, (req, res, params, url) => {
    const result = store.listAgentRecords({
      kind: url.searchParams.get("kind"),
      sendState: url.searchParams.get("send_state"),
      decision: url.searchParams.get("decision"),
      search: url.searchParams.get("q"),
      limit: url.searchParams.get("limit") || 200,
      offset: url.searchParams.get("offset") || 0
    });
    return { ...result, counts: store.agentRecordCounts(url.searchParams.get("kind")) };
  });

  route("GET", /^\/api\/records\/([\w-]+)$/, (req, res, [id]) => {
    const record = store.getAgentRecord(id);
    if (!record) throw new HttpError(404, "registro não encontrado");
    return { item: record };
  });

  route("POST", /^\/api\/records\/([\w-]+)\/send$/, (req, res, [id]) => {
    requireProfile();
    requireResume();
    requireLinkedIn();
    const record = store.getAgentRecord(id);
    if (!record) throw new HttpError(404, "registro não encontrado");
    if (!["available", "failed"].includes(record.send_state)) {
      throw new HttpError(409, record.send_blocked_reason || "este item não pode ser enviado");
    }
    if (record.kind !== "job") throw new HttpError(400, "envio manual disponível apenas para vagas");

    let runId;
    try {
      runId = scheduler.enqueueCommand("jobs", "jobs:apply-one", [record.record_id], "manual");
    } catch (error) {
      if (error.code === "pause_active") throw new HttpError(409, "Pausa global ativa", "pause_active");
      if (error.code === PROFILE_GATE_CODE) throw new HttpError(409, error.message, PROFILE_GATE_CODE);
      throw error;
    }
    store.setSendState(record.record_id, { send_state: "in_progress", sent_by: "manual" });
    return { run_id: runId, item: store.getAgentRecord(id) };
  });

  /* ------------------------------------------------------------------ runs */

  route("GET", /^\/api\/runs$/, (req, res, params, url) => ({
    ...store.listRuns({
      pipeline: url.searchParams.get("pipeline"),
      limit: url.searchParams.get("limit") || 50,
      offset: url.searchParams.get("offset") || 0
    })
  }));

  /* --------------------------------------------------------- configuration */

  /**
   * The whole editable surface, described by the server so the interface renders
   * it generically and cannot invent a field that is not allowed to change.
   */
  route("GET", /^\/api\/config$/, () => {
    const config = getConfig();
    return {
      fields: EDITABLE.map((field) => ({
        path: field.path,
        label: field.label,
        type: field.type,
        min: field.min,
        max: field.max,
        value: getPath(config, field.path)
      }))
    };
  });

  route("PUT", /^\/api\/config$/, async (req) => {
    const body = await readBody(req, 2_000_000);
    const patch = body?.values;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new HttpError(400, "envie { values: { caminho: valor } }");

    const overrides = structuredClone(store.getConfigOverrides());
    const applied = [];
    const rejected = [];

    const pauseEntries = Object.entries(patch).filter(([path]) => path.startsWith("pause."));
    const regularEntries = Object.entries(patch).filter(([path]) => !path.startsWith("pause."));

    // Each non-pause field is validated on its own: one bad value never discards the rest.
    for (const [path, value] of regularEntries) {
      try {
        setPath(overrides, path, coerceEditable(path, value));
        applied.push(path);
      } catch (error) {
        rejected.push({ path, error: error.message });
      }
    }

    // Pause fields form one invariant and are therefore applied atomically.
    if (pauseEntries.length) {
      const candidate = { ...getConfig().pause };
      const coerced = [];
      try {
        for (const [path, value] of pauseEntries) {
          const next = coerceEditable(path, value);
          candidate[path.slice("pause.".length)] = next;
          coerced.push([path, next]);
        }
        const validation = validatePauseConfig(candidate);
        if (!validation.valid) throw new HttpError(400, validation.code, validation.code);
        for (const [path, value] of coerced) {
          setPath(overrides, path, value);
          applied.push(path);
        }
      } catch (error) {
        const code = error.code || "pause_invalid";
        for (const [path] of pauseEntries) rejected.push({ path, error: error.message, code });
      }
    }

    store.setConfigOverrides(overrides);
    const config = refreshConfig();
    scheduler.refreshAllNextRuns();
    return {
      applied,
      rejected,
      fields: EDITABLE.map((field) => ({
        path: field.path,
        label: field.label,
        type: field.type,
        min: field.min,
        max: field.max,
        value: getPath(config, field.path)
      }))
    };
  });

  /* -------------------------------------------------------------- settings */

  route("GET", /^\/api\/settings$/, () => ({
    settings: store.allSettings(),
    config: {
      timezone: getConfig().timezone,
      jobs_watcher: {
        enabled: getConfig().jobs_watcher?.enabled,
        easy_apply_enabled: getConfig().jobs_watcher?.easy_apply_enabled,
        read_only: getConfig().jobs_watcher?.read_only,
        max_easy_apply_per_run: getConfig().jobs_watcher?.max_easy_apply_per_run,
        max_easy_apply_per_day: getConfig().jobs_watcher?.max_easy_apply_per_day,
        max_easy_apply_per_week: getConfig().jobs_watcher?.max_easy_apply_per_week,
        searches: (getConfig().jobs_watcher?.searches || []).map((item) => item.name)
      },
      dm_watcher: {
        read_only: getConfig().dm_watcher?.read_only,
        max_threads_to_scan: getConfig().dm_watcher?.max_threads_to_scan
      },
      network_invites: {
        enabled: getConfig().network_invites?.enabled,
        max_accepts_per_run: getConfig().network_invites?.max_accepts_per_run
      }
    }
  }));

  route("PUT", /^\/api\/settings$/, async (req) => {
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "corpo inválido");
    for (const [key, value] of Object.entries(body)) store.setSetting(key, value);
    return { settings: store.allSettings() };
  });

  /* ------------------------------------------------------------- cli agents */

  route("GET", /^\/api\/cli-agents$/, () => ({
    items: store.listCliAgents(),
    auto_fix: autoFixState()
  }));

  route("PUT", /^\/api\/cli-agents\/([\w-]+)$/, async (req, res, [agent]) => {
    const body = await readBody(req);
    try {
      const items = body.role !== undefined && Object.keys(body).length === 1
        ? store.setCliAgentRole(agent, body.role)
        : store.saveCliAgent(agent, body);
      return { items, auto_fix: autoFixState() };
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  });

  /**
   * Checks that the configured binary actually exists and answers, without ever
   * asking it to change anything: `--version` is the whole interaction.
   */
  route("POST", /^\/api\/cli-agents\/([\w-]+)\/probe$/, async (req, res, [agent]) => {
    const target = store.listCliAgents().find((item) => item.id === agent);
    if (!target) throw new HttpError(404, "agente desconhecido");

    const limit = store.consumeRateLimit("cli_agent_probe", { capacity: 6, refillPerSecond: 1 / 10 });
    if (!limit.allowed) throw new HttpError(429, `Aguarde ${limit.retry_after_seconds}s antes de testar novamente`);

    try {
      assertLaunchAllowed({ command: target.command, args: target.args_template, cwd: ROOT, root: ROOT });
    } catch (error) {
      throw new HttpError(400, error.message, error.code || "request_failed");
    }

    return await new Promise((resolve) => {
      const child = spawn(target.command, ["--version"], { cwd: ROOT, env: sandboxEnv(), stdio: ["ignore", "pipe", "pipe"], shell: false });
      let output = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ available: false, detail: "sem resposta em 10s" }); }, 10_000);
      timer.unref?.();
      child.stdout.on("data", (chunk) => { output = (output + chunk).slice(0, 400); });
      child.stderr.on("data", (chunk) => { output = (output + chunk).slice(0, 400); });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ available: false, detail: error.code === "ENOENT" ? `comando não encontrado: ${target.command}` : error.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ available: code === 0, detail: output.trim().split("\n")[0] || `exit code ${code}` });
      });
    });
  });

  /**
   * Restarts the service so a fix takes effect.
   *
   * Only reachable from loopback (the server binds there) and only meaningful
   * under a supervisor, which is checked before agreeing to exit — otherwise
   * "restart" would mean "stop".
   */
  route("POST", /^\/api\/service\/restart$/, () => {
    const supervisor = detectSupervisor();
    if (!supervisor.supervised) {
      throw new HttpError(409, supervisor.reason, "no_supervisor");
    }

    const limit = store.consumeRateLimit("service_restart", { capacity: 3, refillPerSecond: 1 / 120 });
    if (!limit.allowed) throw new HttpError(429, `Aguarde ${limit.retry_after_seconds}s antes de reiniciar novamente`, "rate_limited");

    // Exit after the response is on the wire, so the caller learns the outcome.
    setTimeout(() => {
      console.log("[web] reiniciando a pedido do auto-fix");
      scheduler.stop();
      process.exit(0);
    }, 250).unref?.();

    return { status: "restarting", supervisor: supervisor.kind, detail: "o processo será encerrado e o supervisor o reiniciará" };
  });

  /* ----------------------------------------------------------------- alerts */

  route("GET", /^\/api\/alerts$/, (req, res, params, url) => ({
    items: store.listAlerts({ limit: url.searchParams.get("limit") || 50 }),
    dedupe_minutes: store.getNotificationSettings().alert_dedupe_minutes
  }));

  /** Why auto-fix is or is not available, mirroring the email-delivery state. */
  function autoFixState() {
    const settings = store.getNotificationSettings();
    const primary = store.listCliAgents().find((agent) => agent.role === "primary");
    if (!primary) return { ready: false, enabled: false, reason: "nenhum_agente_principal" };
    if (!settings.auto_fix_enabled) return { ready: true, enabled: false, reason: "desativado_pelo_usuario" };
    return { ready: true, enabled: true, reason: "", agent: primary.id };
  }

  return { routes };
}

/**
 * Google OAuth, driven from the interface.
 *
 * The user only pastes the client JSON downloaded from Google Cloud and clicks
 * connect: this opens a one-shot loopback listener on the redirect port, hands
 * back the consent URL, and stores the resulting token in SQLite when Google
 * redirects back. No manual copying of authorization codes.
 */
class GoogleOAuthFlow {
  constructor({ store, getConfig }) {
    this.store = store;
    this.getConfig = getConfig;
    this.server = null;
    this.startedAt = null;
    this.state = null;
  }

  pending() {
    return this.server ? { active: true, started_at: this.startedAt } : { active: false, started_at: null };
  }

  async start() {
    const credentials = this.store.getOAuthCredentials("google");
    if (!credentials?.client?.client_id) throw new Error("configure o client OAuth do Google antes de conectar");

    this.stop();

    const port = Number(this.config.gmail?.redirect_port || 45819);
    const scopes = this.config.gmail?.scopes || [];
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
    const client = new google.auth.OAuth2(credentials.client.client_id, credentials.client.client_secret, redirectUri);

    this.state = crypto.randomBytes(16).toString("hex");
    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      state: this.state
    });

    await new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.#handleCallback(req, res, client, scopes, port));
      this.server.once("error", (error) => {
        this.server = null;
        reject(new Error(`não foi possível abrir a porta ${port}: ${error.message}`));
      });
      this.server.listen(port, "127.0.0.1", resolve);
    });

    this.startedAt = new Date().toISOString();
    // Never leave the loopback listener running unattended.
    this.timeout = setTimeout(() => this.stop(), 5 * 60 * 1000);
    this.timeout.unref?.();

    return { auth_url: authUrl, redirect_uri: redirectUri, expires_in_seconds: 300 };
  }

  async #handleCallback(req, res, client, scopes, port) {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname !== "/oauth2callback") {
      res.writeHead(404).end("Not found");
      return;
    }

    const reply = (status, message) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>LinkedIn Local Agent</title>
        <body style="font-family:system-ui;padding:3rem;max-width:32rem;margin:auto">
        <h2>${message}</h2><p>Pode fechar esta aba e voltar para o console.</p></body>`);
    };

    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (state !== this.state) {
      reply(400, "Requisição de autorização inválida.");
      this.stop();
      return;
    }
    if (error || !code) {
      this.store.setOAuthError("google", error || "código de autorização ausente");
      reply(400, "Autorização cancelada.");
      this.stop();
      return;
    }

    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Record which account was connected, so the interface can show it.
      let email = "";
      try {
        const profile = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
        email = profile.data?.email || "";
      } catch {
        try {
          const gmail = await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
          email = gmail.data?.emailAddress || "";
        } catch {}
      }

      const grantedScopes = String(tokens.scope || "").split(/\s+/).filter(Boolean);
      this.store.saveOAuthToken("google", { token: tokens, scopes: grantedScopes.length ? grantedScopes : scopes, account_email: email });
      reply(200, "Conta Google conectada.");
    } catch (caught) {
      this.store.setOAuthError("google", caught.message);
      reply(500, "Falha ao concluir a autorização.");
    } finally {
      this.stop();
    }
  }

  stop() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.startedAt = null;
  }
}

/**
 * Runs a CLI command that prints a JSON result and resolves with it.
 *
 * Used for short model-only commands (profile extraction) that must not go
 * through the scheduler queue, since they never open the browser.
 */
function runCliJson(command, args = [], { input = null, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "src", "cli.js"), command, ...args], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-2_000_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-20_000); });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("tempo limite excedido"));
    }, timeoutMs);
    timer.unref?.();

    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const message = stderr.trim().split("\n").filter(Boolean).pop() || `código de saída ${code}`;
        reject(new Error(message.slice(0, 400)));
        return;
      }
      const opening = stdout.indexOf("{");
      if (opening === -1) {
        reject(new Error("a saída do comando não continha JSON"));
        return;
      }
      try {
        resolve(JSON.parse(stdout.slice(opening)));
      } catch (error) {
        reject(new Error(`resposta inválida do agente: ${error.message}`));
      }
    });

    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function collectNextRuns(schedule, count = 5, config = null) {
  const runs = [];
  let cursor = new Date();
  for (let index = 0; index < count; index++) {
    const resolver = config ? nextRunOutsidePause : nextRunForSchedule;
    const { next_run_at } = config
      ? resolver({ ...schedule, last_run_at: cursor.toISOString() }, config, cursor)
      : resolver({ ...schedule, last_run_at: cursor.toISOString() }, cursor);
    if (!next_run_at) break;
    runs.push(next_run_at);
    cursor = new Date(next_run_at);
  }
  return runs;
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(DIST_DIR, relative);
  if (!target.startsWith(DIST_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  let filePath = target;
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat || stat.isDirectory()) {
    // Single page app fallback.
    filePath = path.join(DIST_DIR, "index.html");
    if (!fs.existsSync(filePath)) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Interface ainda não compilada. Rode: npm run web:build (ou npm run web:dev para desenvolvimento).");
      return;
    }
  }

  const extension = path.extname(filePath);
  const isHtml = extension === ".html";
  res.writeHead(200, {
    "Content-Type": MIME[extension] || "application/octet-stream",
    "Cache-Control": isHtml ? "no-store" : "public, max-age=3600"
  });
  fs.createReadStream(filePath).pipe(res);
}

export function startServer({ port = PORT, host = HOST } = {}) {
  const store = new AppStore(bootstrapDatabasePath());

  const pauseMigration = migratePauseConfigV1(store);
  if (pauseMigration.migrated) console.log(`[web] pausa global inicializada; ${pauseMigration.cleared_windows} janela(s) legada(s) removida(s)`);

  let config = readConfig(store);

  // Installs that had keys before roles existed get a primary (and fallback).
  const roles = migrateProviderRolesV1(store, config);
  if (roles.migrated) {
    console.log(`[web] providers migrados: principal=${roles.primary}${roles.fallback ? `, fallback=${roles.fallback}` : ""}`);
  }

  const getConfig = () => config;
  const refreshConfig = () => { config = readConfig(store); return config; };

  const scheduler = new Scheduler(store, { getConfig });
  const { routes } = createApp({ store, scheduler, getConfig, refreshConfig });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    // Local-only tool: reject cross-origin browser callers outright.
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      sendJson(res, 403, { error: "origem não permitida" });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      for (const item of routes) {
        if (item.method !== req.method) continue;
        const match = item.pattern.exec(url.pathname);
        if (!match) continue;
        try {
          const body = await item.handler(req, res, match.slice(1), url);
          if (!res.writableEnded) sendJson(res, 200, body ?? {});
        } catch (error) {
          const status = error instanceof HttpError ? error.status : 500;
          if (status === 500) console.error("[web]", error);
          sendJson(res, status, {
            error: error.message || "erro interno",
            code: error.code || (status === 500 ? "internal_error" : "request_failed"),
            params: error.params || {}
          });
        }
        return;
      }
      sendJson(res, 404, { error: "rota não encontrada" });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end("Method Not Allowed");
      return;
    }

    await serveStatic(req, res, url.pathname).catch((error) => {
      console.error("[web] static", error);
      if (!res.headersSent) res.writeHead(500);
      res.end("Erro ao servir arquivo");
    });
  });

  server.listen(port, host, () => {
    console.log(`[web] interface em http://${host}:${port}`);
    // Serves the console without ever acting: nothing is scheduled, nothing
    // opens a browser. Used for screenshots and for inspecting a database
    // safely, where a pipeline firing on its own would be a surprise.
    if (process.env.AGENT_DISABLE_SCHEDULER === "1") {
      console.log("[web] scheduler desativado (AGENT_DISABLE_SCHEDULER=1)");
      return;
    }
    scheduler.start();
  });

  const shutdown = () => {
    console.log("\n[web] encerrando...");
    scheduler.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { server, store, scheduler };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
