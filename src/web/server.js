import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { AppStore, PIPELINES } from "../app-store.js";
import { describeSchedule, isValidCron, nextRunForSchedule } from "../cron.js";
import { Scheduler } from "../scheduler.js";
import { PROFILE_SECTIONS, declaredDemographics, normalizeProfile, profileCompleteness } from "../profile-schema.js";
import { bootstrapDatabasePath, importLegacyConfig, legacyConfigExists, resolveConfig } from "../config.js";
import { EDITABLE, coerceEditable, getPath, setPath } from "../config-defaults.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..", "..");
const CONFIG_PATH = path.join(ROOT, "config.json");
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
  constructor(status, message) {
    super(message);
    this.status = status;
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

  /* ------------------------------------------------------------------ status */

  route("GET", /^\/api\/status$/, () => {
    const schedules = store.listSchedules().map((schedule) => ({
      ...schedule,
      summary: describeSchedule(schedule),
      next_run_preview: nextRunForSchedule(schedule).next_run_at
    }));
    const geminiKeys = store.activeApiKeys("gemini").length;
    const openrouterKeys = store.activeApiKeys("openrouter").length;
    // Served from the store's in-memory cache, so the poll never hits SQLite.
    const onboardingComplete = store.isOnboardingComplete();
    return {
      now: new Date().toISOString(),
      timezone: getConfig().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      onboarding: { complete: onboardingComplete },
      scheduler: scheduler.status(),
      schedules,
      counts: {
        jobs: store.agentRecordCounts("job"),
        dm: store.agentRecordCounts("dm"),
        invite: store.agentRecordCounts("invite")
      },
      keys: { gemini: geminiKeys, openrouter: openrouterKeys },
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

    const stored = store.getUserProfile();
    return {
      profile,
      resume_text: stored.resume_text,
      onboarding_complete: stored.onboarding_complete,
      saved: true,
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
    const resumeText = String(body.resume_text || "").trim();
    if (resumeText.length < 40) throw new HttpError(400, "Cole o texto do currículo antes de preencher");

    const limit = store.consumeRateLimit("profile_extract", { capacity: 3, refillPerSecond: 1 / 30 });
    if (!limit.allowed) {
      throw new HttpError(429, `Aguarde ${limit.retry_after_seconds}s antes de preencher novamente`);
    }

    try {
      const result = await runCliJson("profile:extract", [], { input: resumeText, timeoutMs: 120_000 });
      const profile = normalizeProfile(result?.profile || {});
      return {
        profile,
        warnings: result?.warnings || [],
        declared_demographics: declaredDemographics(profile),
        completeness: profileCompleteness(profile),
        rate_limit: { remaining: limit.remaining }
      };
    } catch (error) {
      throw new HttpError(502, `Falha ao analisar o currículo: ${error.message}`);
    }
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

  /* -------------------------------------------------------------- api keys */

  route("GET", /^\/api\/keys$/, () => ({ items: store.listApiKeys() }));

  route("POST", /^\/api\/keys$/, async (req) => {
    const body = await readBody(req);
    const id = store.createApiKey({
      provider: body.provider,
      label: body.label,
      secret: body.secret,
      enabled: body.enabled !== false,
      priority: body.priority
    });
    return { id, items: store.listApiKeys() };
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
      next_run_preview: nextRunForSchedule(schedule).next_run_at,
      schedule_error: nextRunForSchedule(schedule).error
    })),
    available: PIPELINES
  }));

  route("PUT", /^\/api\/pipelines\/([\w-]+)$/, async (req, res, [pipeline]) => {
    const body = await readBody(req);
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
    const runId = scheduler.enqueue(pipeline, "force");
    if (!runId) throw new HttpError(409, "este pipeline já está na fila ou em execução");
    return { run_id: runId, scheduler: scheduler.status() };
  });

  route("POST", /^\/api\/cron\/validate$/, async (req) => {
    const body = await readBody(req);
    const valid = isValidCron(body.cron);
    const preview = valid
      ? collectNextRuns({ mode: "auto", schedule_kind: "cron", cron: body.cron, weekdays: body.weekdays, window_start: body.window_start, window_end: body.window_end }, 5)
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
    const record = store.getAgentRecord(id);
    if (!record) throw new HttpError(404, "registro não encontrado");
    if (!["available", "failed"].includes(record.send_state)) {
      throw new HttpError(409, record.send_blocked_reason || "este item não pode ser enviado");
    }
    if (record.kind !== "job") throw new HttpError(400, "envio manual disponível apenas para vagas");

    const runId = scheduler.enqueueCommand("jobs", "jobs:apply-one", [record.record_id], "manual");
    store.setSendState(record.record_id, { send_state: "in_progress", sent_by: "manual" });
    return { run_id: runId, item: store.getAgentRecord(id) };
  });

  /* ------------------------------------------------------------------ runs */

  route("GET", /^\/api\/runs$/, (req, res, params, url) => ({
    items: store.listRuns({ pipeline: url.searchParams.get("pipeline"), limit: url.searchParams.get("limit") || 50 })
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
      })),
      legacy_config_file: legacyConfigExists(),
      imported_at: store.getSetting("config_imported_at", null)
    };
  });

  route("PUT", /^\/api\/config$/, async (req) => {
    const body = await readBody(req, 2_000_000);
    const patch = body?.values;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new HttpError(400, "envie { values: { caminho: valor } }");

    const overrides = structuredClone(store.getConfigOverrides());
    const applied = [];
    const rejected = [];

    // Each field is validated on its own: one bad value never discards the rest.
    for (const [path, value] of Object.entries(patch)) {
      try {
        setPath(overrides, path, coerceEditable(path, value));
        applied.push(path);
      } catch (error) {
        rejected.push({ path, error: error.message });
      }
    }

    store.setConfigOverrides(overrides);
    const config = refreshConfig();
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

function collectNextRuns(schedule, count = 5) {
  const runs = [];
  let cursor = new Date();
  for (let index = 0; index < count; index++) {
    const { next_run_at } = nextRunForSchedule({ ...schedule, last_run_at: cursor.toISOString() }, cursor);
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

  // Existing installs keep their settings: config.json is copied into the
  // database once, after which the file is optional.
  const imported = importLegacyConfig(store);
  if (imported.imported) {
    console.log(`[web] config.json importado para o banco (${imported.count} campos)`);
    for (const problem of imported.skipped) console.warn(`[web] ignorado -> ${problem}`);
  }

  let config = readConfig(store);
  const getConfig = () => config;
  const refreshConfig = () => { config = readConfig(store); return config; };

  const scheduler = new Scheduler(store);
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
          sendJson(res, status, { error: error.message || "erro interno" });
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
