import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {}

export const PIPELINES = [
  {
    pipeline: "dm",
    label: "Mensagens diretas",
    command: "dm:check",
    description: "Lê a caixa de entrada, responde DMs novas e agenda entrevistas."
  },
  {
    pipeline: "network",
    label: "Convites de rede",
    command: "network:accept",
    description: "Aceita convites pendentes de conexão."
  },
  {
    pipeline: "jobs",
    label: "Vagas (scan + Easy Apply)",
    command: "jobs:scan",
    description: "Busca vagas, avalia com o modelo e aplica quando permitido."
  }
];

export const PIPELINE_IDS = PIPELINES.map((item) => item.pipeline);

const SCHEDULE_KINDS = ["cron", "interval", "daily_times"];
const MODES = ["auto", "manual", "off"];

function nowIso() {
  return new Date().toISOString();
}

function randomId() {
  return crypto.randomBytes(12).toString("hex");
}

/**
 * Removes anything that looks like a credential from text that will be shown in
 * the interface. Provider error messages are echoed back to the user, and they
 * are not guaranteed to keep the key out of the message.
 */
export function redactSecrets(text) {
  return String(text ?? "")
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, "AIza***")
    .replace(/sk-[0-9A-Za-z_\-]{10,}/g, "sk-***")
    .replace(/ya29\.[0-9A-Za-z_\-.]{10,}/g, "ya29.***")
    .replace(/\b1\/\/[0-9A-Za-z_\-]{10,}/g, "1//***")
    .replace(/\b[0-9A-Za-z_\-]{32,}\b/g, (match) => `${match.slice(0, 4)}***`);
}

export function maskSecret(secret) {
  const value = String(secret || "");
  if (value.length <= 8) return `${value.slice(0, 2)}${"*".repeat(Math.max(0, value.length - 2))}`;
  return `${value.slice(0, 4)}${"*".repeat(8)}${value.slice(-4)}`;
}

export function appStoreAvailable() {
  return typeof DatabaseSync === "function";
}

export class AppStore {
  constructor(databasePath) {
    if (!appStoreAvailable()) throw new Error("node:sqlite is unavailable; Node.js 22.5 or newer is required");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.databasePath = databasePath;
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('gemini', 'openrouter')),
        label TEXT NOT NULL,
        secret TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider, enabled, priority);

      CREATE TABLE IF NOT EXISTS pipeline_schedules (
        pipeline TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        command TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('auto', 'manual', 'off')),
        schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('cron', 'interval', 'daily_times')),
        cron TEXT,
        interval_minutes INTEGER,
        daily_times_json TEXT NOT NULL DEFAULT '[]',
        weekdays_json TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
        window_start TEXT,
        window_end TEXT,
        jitter_seconds INTEGER NOT NULL DEFAULT 0,
        timezone TEXT,
        next_run_at TEXT,
        last_run_at TEXT,
        last_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        pipeline TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        exit_code INTEGER,
        summary_json TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_recent ON pipeline_runs(pipeline, started_at DESC);

      CREATE TABLE IF NOT EXISTS agent_records (
        record_id TEXT PRIMARY KEY,
        pipeline TEXT NOT NULL,
        kind TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        subtitle TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        action_url TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        score INTEGER,
        decision TEXT NOT NULL DEFAULT 'pending',
        confidence INTEGER,
        risk_flags_json TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL DEFAULT '',
        variant TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'analyzed',
        send_method TEXT NOT NULL DEFAULT 'none',
        send_state TEXT NOT NULL DEFAULT 'unsupported',
        send_blocked_reason TEXT NOT NULL DEFAULT '',
        sent_at TEXT,
        sent_by TEXT,
        send_error TEXT,
        analyzed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        raw_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_agent_records_listing ON agent_records(kind, send_state, analyzed_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_records_identity ON agent_records(pipeline, kind, external_id);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_credentials (
        provider TEXT PRIMARY KEY,
        client_json TEXT,
        token_json TEXT,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        account_email TEXT,
        connected_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        email_enabled INTEGER NOT NULL DEFAULT 0,
        email_to TEXT NOT NULL DEFAULT '',
        email_from TEXT NOT NULL DEFAULT '',
        alert_on_error INTEGER NOT NULL DEFAULT 1,
        macos_notification INTEGER NOT NULL DEFAULT 1,
        job_digest_enabled INTEGER NOT NULL DEFAULT 0,
        calendar_enabled INTEGER NOT NULL DEFAULT 0,
        calendar_id TEXT NOT NULL DEFAULT 'primary',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        resume_text TEXT NOT NULL DEFAULT '',
        profile_json TEXT NOT NULL DEFAULT '{}',
        onboarding_completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    try { fs.chmodSync(databasePath, 0o600); } catch {}
    this.ensureDefaultSchedules();
  }

  close() {
    this.db.close();
  }

  /* ---------------------------------------------------------------- api keys */

  listApiKeys({ reveal = false } = {}) {
    const rows = this.db.prepare(`
      SELECT id, provider, label, secret, enabled, priority, use_count, last_used_at, last_error, created_at, updated_at
      FROM api_keys ORDER BY provider ASC, priority ASC, created_at ASC
    `).all();
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      label: row.label,
      secret: reveal ? row.secret : undefined,
      masked: maskSecret(row.secret),
      enabled: Boolean(row.enabled),
      priority: Number(row.priority),
      use_count: Number(row.use_count),
      last_used_at: row.last_used_at,
      last_error: row.last_error,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  activeApiKeys(provider) {
    return this.db.prepare(`
      SELECT id, label, secret FROM api_keys
      WHERE provider = ? AND enabled = 1
      ORDER BY priority ASC, created_at ASC
    `).all(String(provider));
  }

  createApiKey({ provider, label, secret, enabled = true, priority = 0 }) {
    const cleanProvider = String(provider || "").trim();
    if (!["gemini", "openrouter"].includes(cleanProvider)) throw new Error("provider must be gemini or openrouter");
    const cleanSecret = String(secret || "").trim();
    if (cleanSecret.length < 8) throw new Error("secret is too short");
    const cleanLabel = String(label || "").trim().slice(0, 80) || `${cleanProvider} key`;
    const timestamp = nowIso();
    const id = randomId();
    this.db.prepare(`
      INSERT INTO api_keys (id, provider, label, secret, enabled, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, cleanProvider, cleanLabel, cleanSecret, enabled ? 1 : 0, Number(priority) || 0, timestamp, timestamp);
    return id;
  }

  updateApiKey(id, patch = {}) {
    const current = this.db.prepare("SELECT * FROM api_keys WHERE id = ?").get(String(id));
    if (!current) throw new Error("api key not found");
    const label = patch.label === undefined ? current.label : String(patch.label).trim().slice(0, 80);
    const enabled = patch.enabled === undefined ? current.enabled : (patch.enabled ? 1 : 0);
    const priority = patch.priority === undefined ? current.priority : (Number(patch.priority) || 0);
    let secret = current.secret;
    if (patch.secret !== undefined && String(patch.secret).trim()) {
      secret = String(patch.secret).trim();
      if (secret.length < 8) throw new Error("secret is too short");
    }
    this.db.prepare(`
      UPDATE api_keys SET label = ?, secret = ?, enabled = ?, priority = ?, updated_at = ? WHERE id = ?
    `).run(label, secret, enabled, priority, nowIso(), String(id));
    return true;
  }

  deleteApiKey(id) {
    return Number(this.db.prepare("DELETE FROM api_keys WHERE id = ?").run(String(id)).changes || 0);
  }

  markApiKeyUsed(id, error = null) {
    this.db.prepare(`
      UPDATE api_keys SET use_count = use_count + 1, last_used_at = ?, last_error = ?, updated_at = ? WHERE id = ?
    `).run(nowIso(), error ? redactSecrets(error).slice(0, 300) : null, nowIso(), String(id));
  }

  /* -------------------------------------------------------------- schedules */

  ensureDefaultSchedules() {
    const timestamp = nowIso();
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO pipeline_schedules (
        pipeline, label, command, mode, schedule_kind, cron, interval_minutes,
        daily_times_json, weekdays_json, window_start, window_end, jitter_seconds,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'manual', 'cron', ?, 60, '[]', '[0,1,2,3,4,5,6]', '08:00', '22:00', ?, ?, ?)
    `);
    const defaults = {
      dm: { cron: "*/20 8-22 * * *", jitter: 30 },
      network: { cron: "15 9,14,19 * * *", jitter: 45 },
      jobs: { cron: "7 9,12,16 * * 1-5", jitter: 90 }
    };
    for (const item of PIPELINES) {
      const preset = defaults[item.pipeline] || { cron: "0 * * * *", jitter: 0 };
      insert.run(item.pipeline, item.label, item.command, preset.cron, preset.jitter, timestamp, timestamp);
    }
    // Keep label/command in sync with code without touching user preferences.
    const sync = this.db.prepare("UPDATE pipeline_schedules SET label = ?, command = ? WHERE pipeline = ?");
    for (const item of PIPELINES) sync.run(item.label, item.command, item.pipeline);
  }

  listSchedules() {
    const rows = this.db.prepare("SELECT * FROM pipeline_schedules ORDER BY pipeline ASC").all();
    return rows.map((row) => this.#mapSchedule(row));
  }

  getSchedule(pipeline) {
    const row = this.db.prepare("SELECT * FROM pipeline_schedules WHERE pipeline = ?").get(String(pipeline));
    return row ? this.#mapSchedule(row) : null;
  }

  #mapSchedule(row) {
    const meta = PIPELINES.find((item) => item.pipeline === row.pipeline);
    return {
      pipeline: row.pipeline,
      label: row.label,
      command: row.command,
      description: meta?.description || "",
      mode: row.mode,
      schedule_kind: row.schedule_kind,
      cron: row.cron || "",
      interval_minutes: row.interval_minutes === null ? null : Number(row.interval_minutes),
      daily_times: JSON.parse(row.daily_times_json || "[]"),
      weekdays: JSON.parse(row.weekdays_json || "[0,1,2,3,4,5,6]"),
      window_start: row.window_start || "",
      window_end: row.window_end || "",
      jitter_seconds: Number(row.jitter_seconds || 0),
      timezone: row.timezone || null,
      next_run_at: row.next_run_at,
      last_run_at: row.last_run_at,
      last_status: row.last_status,
      updated_at: row.updated_at
    };
  }

  updateSchedule(pipeline, patch = {}) {
    const current = this.getSchedule(pipeline);
    if (!current) throw new Error(`unknown pipeline: ${pipeline}`);

    const mode = patch.mode === undefined ? current.mode : String(patch.mode);
    if (!MODES.includes(mode)) throw new Error("mode must be auto, manual or off");

    const scheduleKind = patch.schedule_kind === undefined ? current.schedule_kind : String(patch.schedule_kind);
    if (!SCHEDULE_KINDS.includes(scheduleKind)) throw new Error("schedule_kind must be cron, interval or daily_times");

    const cron = patch.cron === undefined ? current.cron : String(patch.cron || "").trim();
    const intervalMinutes = patch.interval_minutes === undefined
      ? current.interval_minutes
      : Math.max(1, Math.min(1440, Number(patch.interval_minutes) || 1));
    const dailyTimes = patch.daily_times === undefined
      ? current.daily_times
      : normalizeDailyTimes(patch.daily_times);
    const weekdays = patch.weekdays === undefined ? current.weekdays : normalizeWeekdays(patch.weekdays);
    const windowStart = patch.window_start === undefined ? current.window_start : normalizeClock(patch.window_start);
    const windowEnd = patch.window_end === undefined ? current.window_end : normalizeClock(patch.window_end);
    const jitter = patch.jitter_seconds === undefined
      ? current.jitter_seconds
      : Math.max(0, Math.min(3600, Number(patch.jitter_seconds) || 0));

    if (mode === "auto") {
      if (scheduleKind === "cron" && !cron) throw new Error("no modo automático a expressão cron é obrigatória");
      if (scheduleKind === "daily_times" && dailyTimes.length === 0) {
        throw new Error("informe ao menos um horário no formato HH:MM");
      }
    }

    this.db.prepare(`
      UPDATE pipeline_schedules SET
        mode = ?, schedule_kind = ?, cron = ?, interval_minutes = ?, daily_times_json = ?,
        weekdays_json = ?, window_start = ?, window_end = ?, jitter_seconds = ?, updated_at = ?
      WHERE pipeline = ?
    `).run(
      mode, scheduleKind, cron, intervalMinutes, JSON.stringify(dailyTimes),
      JSON.stringify(weekdays), windowStart, windowEnd, jitter, nowIso(), String(pipeline)
    );
    return this.getSchedule(pipeline);
  }

  setScheduleRuntime(pipeline, { next_run_at, last_run_at, last_status } = {}) {
    const current = this.getSchedule(pipeline);
    if (!current) return null;
    this.db.prepare(`
      UPDATE pipeline_schedules SET next_run_at = ?, last_run_at = ?, last_status = ?, updated_at = ? WHERE pipeline = ?
    `).run(
      next_run_at === undefined ? current.next_run_at : next_run_at,
      last_run_at === undefined ? current.last_run_at : last_run_at,
      last_status === undefined ? current.last_status : last_status,
      nowIso(),
      String(pipeline)
    );
    return this.getSchedule(pipeline);
  }

  /* ------------------------------------------------------------------- runs */

  startRun({ pipeline, trigger = "manual" }) {
    const id = randomId();
    this.db.prepare(`
      INSERT INTO pipeline_runs (id, pipeline, trigger, status, started_at) VALUES (?, ?, ?, 'running', ?)
    `).run(id, String(pipeline), String(trigger), nowIso());
    return id;
  }

  finishRun(id, { status, exit_code = null, summary = null, error = null }) {
    const row = this.db.prepare("SELECT started_at FROM pipeline_runs WHERE id = ?").get(String(id));
    const finishedAt = nowIso();
    const durationMs = row?.started_at ? Date.parse(finishedAt) - Date.parse(row.started_at) : null;
    this.db.prepare(`
      UPDATE pipeline_runs SET status = ?, finished_at = ?, duration_ms = ?, exit_code = ?, summary_json = ?, error = ?
      WHERE id = ?
    `).run(
      String(status), finishedAt, durationMs, exit_code === null ? null : Number(exit_code),
      summary ? JSON.stringify(summary).slice(0, 20000) : null,
      error ? String(error).slice(0, 4000) : null,
      String(id)
    );
    this.db.exec(`
      DELETE FROM pipeline_runs WHERE id IN (
        SELECT id FROM pipeline_runs ORDER BY started_at DESC LIMIT -1 OFFSET 500
      )
    `);
  }

  listRuns({ pipeline = null, limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const rows = pipeline
      ? this.db.prepare("SELECT * FROM pipeline_runs WHERE pipeline = ? ORDER BY started_at DESC LIMIT ?").all(String(pipeline), safeLimit)
      : this.db.prepare("SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT ?").all(safeLimit);
    return rows.map((row) => ({
      id: row.id,
      pipeline: row.pipeline,
      trigger: row.trigger,
      status: row.status,
      started_at: row.started_at,
      finished_at: row.finished_at,
      duration_ms: row.duration_ms,
      exit_code: row.exit_code,
      summary: row.summary_json ? safeParse(row.summary_json) : null,
      error: row.error
    }));
  }

  runningRun(pipeline) {
    return this.db.prepare("SELECT * FROM pipeline_runs WHERE pipeline = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1")
      .get(String(pipeline)) || null;
  }

  releaseStaleRuns(maxAgeMs = 45 * 60 * 1000) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    return Number(this.db.prepare(`
      UPDATE pipeline_runs SET status = 'stale', finished_at = ?, error = 'run exceeded max age'
      WHERE status = 'running' AND started_at < ?
    `).run(nowIso(), cutoff).changes || 0);
  }

  /* --------------------------------------------------------- agent records */

  upsertAgentRecord(record) {
    const timestamp = nowIso();
    const existing = this.db.prepare(
      "SELECT record_id, send_state, sent_at, sent_by, send_error, analyzed_at FROM agent_records WHERE record_id = ?"
    ).get(record.record_id);

    // Never downgrade a terminal send state discovered by an earlier run: a later
    // rescan must not make an already sent application look sendable again.
    const terminal = ["sent_auto", "sent_manual"];
    const keepTerminal = Boolean(existing && terminal.includes(existing.send_state));
    const sendState = keepTerminal ? existing.send_state : record.send_state;
    const sentAt = keepTerminal ? existing.sent_at : record.sent_at || null;
    const sentBy = keepTerminal ? existing.sent_by : record.sent_by || null;
    const status = keepTerminal ? "sent" : (record.status || "analyzed");

    this.db.prepare(`
      INSERT INTO agent_records (
        record_id, pipeline, kind, external_id, title, subtitle, location, url, action_url,
        source, score, decision, confidence, risk_flags_json, reason, variant, status,
        send_method, send_state, send_blocked_reason, sent_at, sent_by, send_error,
        analyzed_at, updated_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        title = excluded.title,
        subtitle = excluded.subtitle,
        location = excluded.location,
        url = excluded.url,
        action_url = excluded.action_url,
        source = excluded.source,
        score = excluded.score,
        decision = excluded.decision,
        confidence = excluded.confidence,
        risk_flags_json = excluded.risk_flags_json,
        reason = excluded.reason,
        variant = excluded.variant,
        status = excluded.status,
        send_method = excluded.send_method,
        send_state = excluded.send_state,
        send_blocked_reason = excluded.send_blocked_reason,
        sent_at = excluded.sent_at,
        sent_by = excluded.sent_by,
        analyzed_at = excluded.analyzed_at,
        updated_at = excluded.updated_at,
        raw_json = excluded.raw_json
    `).run(
      record.record_id, record.pipeline, record.kind, record.external_id,
      record.title || "", record.subtitle || "", record.location || "",
      record.url || "", record.action_url || "", record.source || "",
      record.score === null || record.score === undefined ? null : Math.round(Number(record.score)),
      record.decision || "pending",
      record.confidence === null || record.confidence === undefined ? null : Math.round(Number(record.confidence)),
      JSON.stringify(record.risk_flags || []),
      String(record.reason || "").slice(0, 4000),
      record.variant || "",
      status,
      record.send_method || "none",
      sendState,
      String(record.send_blocked_reason || "").slice(0, 300),
      sentAt, sentBy,
      existing ? existing.send_error : null,
      record.analyzed_at || timestamp,
      timestamp,
      JSON.stringify(record.raw || {}).slice(0, 200000)
    );
    return record.record_id;
  }

  getAgentRecord(recordId) {
    const row = this.db.prepare("SELECT * FROM agent_records WHERE record_id = ?").get(String(recordId));
    return row ? mapAgentRecordRow(row) : null;
  }

  listAgentRecords({ kind = null, sendState = null, decision = null, search = null, limit = 200, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (kind) { clauses.push("kind = ?"); params.push(String(kind)); }
    if (sendState) { clauses.push("send_state = ?"); params.push(String(sendState)); }
    if (decision) { clauses.push("decision = ?"); params.push(String(decision)); }
    if (search) {
      clauses.push("(LOWER(title) LIKE ? OR LOWER(subtitle) LIKE ? OR LOWER(location) LIKE ?)");
      const needle = `%${String(search).toLowerCase()}%`;
      params.push(needle, needle, needle);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const rows = this.db.prepare(
      `SELECT * FROM agent_records ${where} ORDER BY analyzed_at DESC LIMIT ? OFFSET ?`
    ).all(...params, safeLimit, safeOffset);
    const total = this.db.prepare(`SELECT COUNT(*) AS total FROM agent_records ${where}`).get(...params);
    return { items: rows.map(mapAgentRecordRow), total: Number(total?.total || 0) };
  }

  agentRecordCounts(kind = null) {
    const where = kind ? "WHERE kind = ?" : "";
    const params = kind ? [String(kind)] : [];
    const rows = this.db.prepare(
      `SELECT send_state, COUNT(*) AS count FROM agent_records ${where} GROUP BY send_state`
    ).all(...params);
    const counts = {};
    for (const row of rows) counts[row.send_state] = Number(row.count);
    return counts;
  }

  setSendState(recordId, { send_state, sent_by = null, send_error = null, send_blocked_reason = null }) {
    const timestamp = nowIso();
    const terminal = ["sent_auto", "sent_manual"];
    this.db.prepare(`
      UPDATE agent_records SET
        send_state = ?,
        sent_by = COALESCE(?, sent_by),
        sent_at = CASE WHEN ? IN ('sent_auto', 'sent_manual') THEN ? ELSE sent_at END,
        send_error = ?,
        send_blocked_reason = COALESCE(?, send_blocked_reason),
        status = CASE WHEN ? IN ('sent_auto', 'sent_manual') THEN 'sent' ELSE status END,
        updated_at = ?
      WHERE record_id = ?
    `).run(
      String(send_state), sent_by, String(send_state), timestamp,
      send_error ? String(send_error).slice(0, 2000) : null,
      send_blocked_reason,
      String(send_state), timestamp, String(recordId)
    );
    void terminal;
    return this.getAgentRecord(recordId);
  }

  /**
   * Frees records left in `in_progress` by a crashed or killed send, so the
   * "Enviar" button never stays permanently disabled after a hard restart.
   */
  releaseStuckSends(maxAgeMs = 45 * 60 * 1000) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    return Number(this.db.prepare(`
      UPDATE agent_records
      SET send_state = 'failed', send_error = 'envio interrompido antes de concluir', updated_at = ?
      WHERE send_state = 'in_progress' AND updated_at < ?
    `).run(nowIso(), cutoff).changes || 0);
  }

  /* --------------------------------------------------------- configuration */

  /**
   * User configuration overrides, stored as one JSON document and cached in
   * memory: every pipeline run and API call resolves the config, so this must
   * not be a query each time.
   */
  getConfigOverrides() {
    if (this.#configCache) return this.#configCache;
    this.#configCache = this.getSetting("config_overrides", {}) || {};
    return this.#configCache;
  }

  setConfigOverrides(overrides) {
    this.setSetting("config_overrides", overrides || {});
    this.#configCache = null;
    return this.getConfigOverrides();
  }

  #configCache = null;

  /* ------------------------------------------------- google oauth & alerts */

  /** Full credentials including secrets. Internal use only — never sent to the UI. */
  getOAuthCredentials(provider = "google") {
    const row = this.db.prepare("SELECT * FROM oauth_credentials WHERE provider = ?").get(String(provider));
    if (!row) return null;
    return {
      provider: row.provider,
      client: safeParse(row.client_json) || null,
      token: safeParse(row.token_json) || null,
      scopes: safeParse(row.scopes_json) || [],
      account_email: row.account_email,
      connected_at: row.connected_at,
      last_error: row.last_error
    };
  }

  /** Safe projection for the interface: presence and metadata, never the secrets. */
  oauthStatus(provider = "google") {
    const credentials = this.getOAuthCredentials(provider);
    const clientId = credentials?.client?.client_id || "";
    return {
      provider,
      client_configured: Boolean(credentials?.client?.client_id && credentials?.client?.client_secret),
      client_id_hint: clientId ? `${clientId.slice(0, 12)}…` : "",
      connected: Boolean(credentials?.token?.refresh_token || credentials?.token?.access_token),
      has_refresh_token: Boolean(credentials?.token?.refresh_token),
      scopes: credentials?.scopes || [],
      account_email: credentials?.account_email || "",
      connected_at: credentials?.connected_at || null,
      last_error: credentials?.last_error || null
    };
  }

  /**
   * Stores the OAuth client downloaded from Google Cloud. Accepts the raw file
   * contents, which wrap the fields under `installed` or `web`.
   */
  saveOAuthClient(provider, clientJson) {
    const parsed = typeof clientJson === "string" ? safeParse(clientJson) : clientJson;
    const installed = parsed?.installed || parsed?.web || parsed;
    if (!installed?.client_id || !installed?.client_secret) {
      throw new Error("JSON inválido: é preciso um client OAuth de aplicativo para Desktop com client_id e client_secret");
    }
    const timestamp = nowIso();
    const client = { client_id: installed.client_id, client_secret: installed.client_secret };
    this.db.prepare(`
      INSERT INTO oauth_credentials (provider, client_json, scopes_json, created_at, updated_at)
      VALUES (?, ?, '[]', ?, ?)
      ON CONFLICT(provider) DO UPDATE SET client_json = excluded.client_json, updated_at = excluded.updated_at
    `).run(String(provider), JSON.stringify(client), timestamp, timestamp);
    return this.oauthStatus(provider);
  }

  saveOAuthToken(provider, { token, scopes = [], account_email = "" } = {}) {
    const current = this.getOAuthCredentials(provider);
    if (!current?.client) throw new Error("configure o client OAuth antes de conectar");
    // Google omits refresh_token on re-consent; keep the one already stored.
    const merged = { ...(current.token || {}), ...(token || {}) };
    if (!merged.refresh_token && current.token?.refresh_token) merged.refresh_token = current.token.refresh_token;

    const timestamp = nowIso();
    this.db.prepare(`
      UPDATE oauth_credentials
      SET token_json = ?, scopes_json = ?, account_email = ?, connected_at = ?, last_error = NULL, updated_at = ?
      WHERE provider = ?
    `).run(
      JSON.stringify(merged),
      JSON.stringify(scopes),
      String(account_email || current.account_email || ""),
      timestamp,
      timestamp,
      String(provider)
    );
    return this.oauthStatus(provider);
  }

  setOAuthError(provider, message) {
    this.db.prepare("UPDATE oauth_credentials SET last_error = ?, updated_at = ? WHERE provider = ?")
      .run(message ? redactSecrets(message).slice(0, 500) : null, nowIso(), String(provider));
  }

  /** Disconnects the account. Email sending is switched off with it. */
  disconnectOAuth(provider = "google") {
    this.db.prepare(`
      UPDATE oauth_credentials SET token_json = NULL, scopes_json = '[]', account_email = NULL,
      connected_at = NULL, updated_at = ? WHERE provider = ?
    `).run(nowIso(), String(provider));
    this.db.prepare("UPDATE notification_settings SET email_enabled = 0, calendar_enabled = 0, updated_at = ? WHERE id = 1")
      .run(nowIso());
    return this.oauthStatus(provider);
  }

  getNotificationSettings() {
    const row = this.db.prepare("SELECT * FROM notification_settings WHERE id = 1").get();
    if (!row) {
      return {
        email_enabled: false,
        email_to: "",
        email_from: "",
        alert_on_error: true,
        macos_notification: true,
        job_digest_enabled: false,
        calendar_enabled: false,
        calendar_id: "primary",
        updated_at: null
      };
    }
    return {
      email_enabled: Boolean(row.email_enabled),
      email_to: row.email_to,
      email_from: row.email_from,
      alert_on_error: Boolean(row.alert_on_error),
      macos_notification: Boolean(row.macos_notification),
      job_digest_enabled: Boolean(row.job_digest_enabled),
      calendar_enabled: Boolean(row.calendar_enabled),
      calendar_id: row.calendar_id || "primary",
      updated_at: row.updated_at
    };
  }

  /**
   * Why email delivery is or is not available.
   *
   * Sending stays off until the user has connected an account AND saved a
   * recipient AND explicitly enabled it, so a fresh install never emails anyone.
   */
  emailDeliveryState() {
    const settings = this.getNotificationSettings();
    const oauth = this.oauthStatus("google");
    if (!oauth.client_configured) return { ready: false, enabled: false, reason: "client_oauth_nao_configurado", settings, oauth };
    if (!oauth.connected) return { ready: false, enabled: false, reason: "conta_google_nao_conectada", settings, oauth };
    if (!settings.email_to) return { ready: false, enabled: false, reason: "destinatario_nao_definido", settings, oauth };
    if (!settings.email_enabled) return { ready: true, enabled: false, reason: "envio_desativado_pelo_usuario", settings, oauth };
    return { ready: true, enabled: true, reason: "", settings, oauth };
  }

  /**
   * Persists notification preferences. Enabling email or calendar requires the
   * prerequisites to be in place; otherwise the flag is refused while every other
   * field is still saved.
   */
  setNotificationSettings(patch = {}) {
    const current = this.getNotificationSettings();
    const oauth = this.oauthStatus("google");

    const emailTo = patch.email_to === undefined ? current.email_to : String(patch.email_to || "").trim().slice(0, 200);
    const emailFrom = patch.email_from === undefined ? current.email_from : String(patch.email_from || "").trim().slice(0, 200);
    if (emailTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailTo)) throw new Error("e-mail de destino inválido");

    const wantsEmail = patch.email_enabled === undefined ? current.email_enabled : Boolean(patch.email_enabled);
    const wantsCalendar = patch.calendar_enabled === undefined ? current.calendar_enabled : Boolean(patch.calendar_enabled);

    const refused = [];
    let emailEnabled = wantsEmail;
    if (wantsEmail && !oauth.connected) { emailEnabled = false; refused.push("conecte uma conta Google antes de ativar o envio de e-mail"); }
    else if (wantsEmail && !emailTo) { emailEnabled = false; refused.push("defina o e-mail de destino antes de ativar o envio"); }

    let calendarEnabled = wantsCalendar;
    if (wantsCalendar && !oauth.connected) { calendarEnabled = false; refused.push("conecte uma conta Google antes de ativar a agenda"); }

    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO notification_settings (
        id, email_enabled, email_to, email_from, alert_on_error, macos_notification,
        job_digest_enabled, calendar_enabled, calendar_id, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email_enabled = excluded.email_enabled,
        email_to = excluded.email_to,
        email_from = excluded.email_from,
        alert_on_error = excluded.alert_on_error,
        macos_notification = excluded.macos_notification,
        job_digest_enabled = excluded.job_digest_enabled,
        calendar_enabled = excluded.calendar_enabled,
        calendar_id = excluded.calendar_id,
        updated_at = excluded.updated_at
    `).run(
      emailEnabled ? 1 : 0,
      emailTo,
      emailFrom,
      (patch.alert_on_error === undefined ? current.alert_on_error : Boolean(patch.alert_on_error)) ? 1 : 0,
      (patch.macos_notification === undefined ? current.macos_notification : Boolean(patch.macos_notification)) ? 1 : 0,
      (patch.job_digest_enabled === undefined ? current.job_digest_enabled : Boolean(patch.job_digest_enabled)) ? 1 : 0,
      calendarEnabled ? 1 : 0,
      String(patch.calendar_id === undefined ? current.calendar_id : (patch.calendar_id || "primary")).slice(0, 200),
      timestamp
    );

    return { settings: this.getNotificationSettings(), refused };
  }

  /* ------------------------------------------------------------ rate limit */

  /**
   * Token bucket persisted in SQLite, so the limit survives a server restart and
   * cannot be reset by simply reloading the page.
   *
   * Tokens refill continuously at `refillPerSecond` up to `capacity`, which allows
   * a small burst while still capping the sustained rate.
   *
   * @returns {{ allowed: boolean, remaining: number, retry_after_seconds: number }}
   */
  consumeRateLimit(key, { capacity = 5, refillPerSecond = 1 / 60, cost = 1, now = Date.now() } = {}) {
    const id = String(key);
    const row = this.db.prepare("SELECT tokens, updated_at FROM rate_limits WHERE key = ?").get(id);

    const previousTokens = row ? Number(row.tokens) : capacity;
    const previousAt = row?.updated_at ? Date.parse(row.updated_at) : now;
    const elapsedSeconds = Math.max(0, (now - previousAt) / 1000);
    const tokens = Math.min(capacity, previousTokens + elapsedSeconds * refillPerSecond);

    const allowed = tokens >= cost;
    const remaining = allowed ? tokens - cost : tokens;
    const timestamp = new Date(now).toISOString();

    this.db.prepare(`
      INSERT INTO rate_limits (key, tokens, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at
    `).run(id, remaining, timestamp);

    return {
      allowed,
      remaining: Math.floor(remaining),
      retry_after_seconds: allowed ? 0 : Math.ceil((cost - tokens) / refillPerSecond)
    };
  }

  /* ---------------------------------------------------------- user profile */

  /**
   * The profile is read on every pipeline run and on most API calls, so it is
   * cached in memory and only re-read from SQLite after a write.
   */
  getUserProfile() {
    if (this.#profileCache) return this.#profileCache;
    const row = this.db.prepare("SELECT * FROM user_profile WHERE id = 1").get();
    this.#profileCache = row
      ? {
          resume_text: row.resume_text || "",
          profile: safeParse(row.profile_json) || {},
          onboarding_completed_at: row.onboarding_completed_at,
          onboarding_complete: Boolean(row.onboarding_completed_at),
          updated_at: row.updated_at
        }
      : {
          resume_text: "",
          profile: {},
          onboarding_completed_at: null,
          onboarding_complete: false,
          updated_at: null
        };
    return this.#profileCache;
  }

  /** Cheap check used by the status endpoint; never hits SQLite after the first call. */
  isOnboardingComplete() {
    return this.getUserProfile().onboarding_complete;
  }

  saveUserProfile({ resume_text, profile, complete_onboarding = false } = {}) {
    const current = this.getUserProfile();
    const timestamp = nowIso();
    const nextResume = resume_text === undefined ? current.resume_text : String(resume_text || "").slice(0, 200000);
    const nextProfile = profile === undefined ? current.profile : profile;
    const completedAt = complete_onboarding
      ? current.onboarding_completed_at || timestamp
      : current.onboarding_completed_at;

    this.db.prepare(`
      INSERT INTO user_profile (id, resume_text, profile_json, onboarding_completed_at, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        resume_text = excluded.resume_text,
        profile_json = excluded.profile_json,
        onboarding_completed_at = excluded.onboarding_completed_at,
        updated_at = excluded.updated_at
    `).run(nextResume, JSON.stringify(nextProfile), completedAt, timestamp, timestamp);

    this.#profileCache = null;
    return this.getUserProfile();
  }

  resetOnboarding() {
    this.db.prepare("UPDATE user_profile SET onboarding_completed_at = NULL, updated_at = ? WHERE id = 1").run(nowIso());
    this.#profileCache = null;
    return this.getUserProfile();
  }

  #profileCache = null;

  /* --------------------------------------------------------------- settings */

  getSetting(key, fallback = null) {
    const row = this.db.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(String(key));
    if (!row) return fallback;
    const parsed = safeParse(row.value_json);
    return parsed === undefined ? fallback : parsed;
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(String(key), JSON.stringify(value ?? null), nowIso());
    return value;
  }

  allSettings() {
    const rows = this.db.prepare("SELECT key, value_json FROM app_settings").all();
    const settings = {};
    for (const row of rows) settings[row.key] = safeParse(row.value_json);
    return settings;
  }
}

function mapAgentRecordRow(row) {
  return {
    record_id: row.record_id,
    pipeline: row.pipeline,
    kind: row.kind,
    external_id: row.external_id,
    title: row.title,
    subtitle: row.subtitle,
    location: row.location,
    url: row.url,
    action_url: row.action_url,
    source: row.source,
    score: row.score === null ? null : Number(row.score),
    decision: row.decision,
    confidence: row.confidence === null ? null : Number(row.confidence),
    risk_flags: safeParse(row.risk_flags_json) || [],
    reason: row.reason,
    variant: row.variant,
    status: row.status,
    send_method: row.send_method,
    send_state: row.send_state,
    send_blocked_reason: row.send_blocked_reason,
    sent_at: row.sent_at,
    sent_by: row.sent_by,
    send_error: row.send_error,
    analyzed_at: row.analyzed_at,
    updated_at: row.updated_at,
    raw: safeParse(row.raw_json) || {}
  };
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function normalizeClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeDailyTimes(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  const clean = list.map(normalizeClock).filter(Boolean);
  // Sub-hour cadences can legitimately need more than 24 entries in one day
  // (08:00-22:00 every 27 minutes needs 31). Keep a bounded list without
  // truncating supported schedules.
  return Array.from(new Set(clean)).sort().slice(0, 64);
}

export function normalizeWeekdays(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  const clean = list
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
  const unique = Array.from(new Set(clean)).sort();
  return unique.length ? unique : [0, 1, 2, 3, 4, 5, 6];
}
