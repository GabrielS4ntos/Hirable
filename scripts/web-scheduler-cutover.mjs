import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppStore } from "../src/app-store.js";
import { nextRunForSchedule } from "../src/cron.js";
import { nextInboxPair } from "../src/scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const resolveOverride = (name, fallback) => path.resolve(process.env[name] || fallback);
const configPath = resolveOverride("CUTOVER_CONFIG_PATH", path.join(ROOT, "config.json"));
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const databasePath = resolveOverride(
  "CUTOVER_DATABASE_PATH",
  path.resolve(ROOT, config.storage?.database_path || config.jobs_watcher?.semantic_memory?.database_path)
);
const recoveryPath = resolveOverride(
  "CUTOVER_RECOVERY_PATH",
  path.join(ROOT, "data", "web-scheduler-cutover-recovery.json")
);
const envPath = resolveOverride("CUTOVER_ENV_PATH", path.join(ROOT, "secrets", ".env"));
const oauthClientPath = resolveOverride(
  "CUTOVER_OAUTH_CLIENT_PATH",
  path.resolve(ROOT, config.gmail.credentials_path)
);
const oauthTokenPath = resolveOverride(
  "CUTOVER_OAUTH_TOKEN_PATH",
  path.resolve(ROOT, config.gmail.token_path)
);
const command = process.argv[2];

function readEnv(filePath) {
  const result = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key) result[key] = value;
  }
  return result;
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function writeRecovery(value) {
  fs.mkdirSync(path.dirname(recoveryPath), { recursive: true });
  fs.writeFileSync(recoveryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(recoveryPath, 0o600);
}

function readRecovery() {
  const value = JSON.parse(fs.readFileSync(recoveryPath, "utf8"));
  if (!value || value.version !== 1) throw new Error("invalid cutover recovery file");
  return value;
}

function setPhase(phase, extra = {}) {
  const recovery = readRecovery();
  recovery.phase = phase;
  recovery.updated_at = new Date().toISOString();
  Object.assign(recovery, extra);
  writeRecovery(recovery);
  return recovery;
}

function dailyTimes(offsetMinutes) {
  const result = [];
  for (let minutes = 8 * 60 + offsetMinutes; minutes < 22 * 60; minutes += 27) {
    if (offsetMinutes === 0 && minutes + 5 >= 22 * 60) break;
    result.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  }
  return result;
}

function rawScheduleRows(store) {
  return store.db.prepare("SELECT * FROM pipeline_schedules ORDER BY pipeline").all();
}

function rawOAuthRow(store) {
  return store.db.prepare("SELECT * FROM oauth_credentials WHERE provider = 'google'").get() || null;
}

function rawNotificationRow(store) {
  return store.db.prepare("SELECT * FROM notification_settings WHERE id = 1").get() || null;
}

function fileMode(filePath) {
  try { return fs.statSync(filePath).mode & 0o777; } catch { return null; }
}

function safeStatus(store) {
  const schedules = store.listSchedules().map((item) => ({
    pipeline: item.pipeline,
    mode: item.mode,
    schedule_kind: item.schedule_kind,
    daily_times: item.daily_times,
    weekdays: item.weekdays,
    window_start: item.window_start,
    window_end: item.window_end,
    jitter_seconds: item.jitter_seconds,
    timezone: item.timezone,
    next_run_at: item.next_run_at,
    last_status: item.last_status
  }));
  return {
    schedules,
    key_counts: {
      gemini: store.activeApiKeys("gemini").length,
      openrouter: store.activeApiKeys("openrouter").length
    },
    google_oauth: store.oauthStatus("google"),
    notifications: store.getNotificationSettings(),
    email_delivery: (() => {
      const { ready, enabled, reason } = store.emailDeliveryState();
      return { ready, enabled, reason };
    })(),
    pipeline_run_count: Number(store.db.prepare("SELECT COUNT(*) AS count FROM pipeline_runs").get().count),
    file_modes: {
      database: fileMode(databasePath),
      wal: fileMode(`${databasePath}-wal`),
      shm: fileMode(`${databasePath}-shm`),
      recovery: fileMode(recoveryPath)
    }
  };
}

function prepare() {
  if (fs.existsSync(recoveryPath)) {
    const previous = readRecovery();
    if (previous.phase !== "complete" && previous.phase !== "rolled_back") {
      throw new Error(`unfinished cutover recovery exists at phase ${previous.phase}`);
    }
  }
  const store = new AppStore(databasePath);
  const recovery = {
    version: 1,
    phase: "snapshot_created",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    database_path: databasePath,
    schedules: rawScheduleRows(store),
    oauth_google: rawOAuthRow(store),
    notification_settings: rawNotificationRow(store),
    pipeline_run_count: Number(store.db.prepare("SELECT COUNT(*) AS count FROM pipeline_runs").get().count),
    existing_key_metadata: store.listApiKeys().map(({ id, provider, label, enabled, priority }) => ({ id, provider, label, enabled, priority })),
    inserted_key_ids: [],
    old_agents: ["com.gabriel.linkedin-inbox-cycle", "com.gabriel.linkedin-jobs-scan"],
    old_plists: [],
    new_plist: null
  };
  writeRecovery(recovery);

  const env = readEnv(envPath);
  const gemini = String(env.GEMINI_API_KEYS || env.GEMINI_API_KEY || "").split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
  const openrouter = String(env.OPENROUTER_API_KEY || "").trim();
  const candidates = [
    ...gemini.map((secret, index) => ({ provider: "gemini", label: `migrada ${index + 1}`, secret, priority: index })),
    ...(openrouter ? [{ provider: "openrouter", label: "fallback migrado", secret: openrouter, priority: 0 }] : [])
  ];
  const existingDigests = new Set(store.listApiKeys({ reveal: true }).map((item) => `${item.provider}:${digest(item.secret)}`));
  const oauthClient = JSON.parse(fs.readFileSync(oauthClientPath, "utf8"));
  const oauthToken = JSON.parse(fs.readFileSync(oauthTokenPath, "utf8"));
  const scopes = String(oauthToken.scope || "").split(/\s+/).filter(Boolean);
  const insertedKeyIds = [];

  store.db.exec("BEGIN IMMEDIATE");
  try {
    for (const candidate of candidates) {
      const keyDigest = `${candidate.provider}:${digest(candidate.secret)}`;
      if (existingDigests.has(keyDigest)) continue;
      const id = store.createApiKey(candidate);
      insertedKeyIds.push(id);
      existingDigests.add(keyDigest);
    }
    store.saveOAuthClient("google", oauthClient);
    store.saveOAuthToken("google", {
      token: oauthToken,
      scopes: scopes.length ? scopes : (config.gmail.scopes || []),
      account_email: config.gmail.from || config.alerts?.email_to || ""
    });
    store.setNotificationSettings({
      email_enabled: Boolean(config.alerts?.email_enabled),
      email_to: config.alerts?.email_to || config.gmail?.from || "",
      email_from: config.gmail?.from || "",
      alert_on_error: config.alerts?.notify_on_error !== false,
      macos_notification: config.alerts?.macos_notification !== false,
      job_digest_enabled: Boolean(config.alerts?.email_enabled && config.jobs_watcher?.external_enabled),
      calendar_enabled: Boolean(config.calendar?.enabled),
      calendar_id: config.calendar?.calendar_id || "primary"
    });

    const common = {
      mode: "manual",
      schedule_kind: "daily_times",
      weekdays: [1, 2, 3, 4, 5, 6],
      window_start: "08:00",
      window_end: "22:00"
    };
    store.updateSchedule("network", { ...common, daily_times: dailyTimes(0), jitter_seconds: 45 });
    store.updateSchedule("dm", { ...common, daily_times: dailyTimes(5), jitter_seconds: 30 });
    store.updateSchedule("jobs", { ...common, daily_times: ["09:00", "12:00", "16:00"], jitter_seconds: 90 });
    store.db.prepare("UPDATE pipeline_schedules SET timezone = ?, next_run_at = NULL, last_status = NULL WHERE pipeline IN ('network','dm','jobs')")
      .run("America/Sao_Paulo");
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    store.close();
    throw error;
  }
  recovery.inserted_key_ids = insertedKeyIds;
  recovery.phase = "database_prepared_manual";
  recovery.updated_at = new Date().toISOString();
  writeRecovery(recovery);
  const status = safeStatus(store);
  store.close();
  return status;
}

function activate() {
  const recovery = readRecovery();
  if (recovery.phase !== "service_healthy_manual") throw new Error(`cannot activate from phase ${recovery.phase}`);
  const store = new AppStore(databasePath);
  const runCountBefore = Number(store.db.prepare("SELECT COUNT(*) AS count FROM pipeline_runs").get().count);
  if (runCountBefore !== recovery.pipeline_run_count) throw new Error("pipeline run count changed during cutover");
  store.db.exec("BEGIN IMMEDIATE");
  try {
    for (const pipeline of ["network", "dm", "jobs"]) store.updateSchedule(pipeline, { mode: "auto" });
    const now = new Date();
    const pair = nextInboxPair(store.getSchedule("network"), store.getSchedule("dm"), now);
    if (pair.error || !pair.network || !pair.dm) throw new Error(pair.error || "failed to resolve inbox pair");
    const jobsResult = nextRunForSchedule(store.getSchedule("jobs"), now);
    if (!jobsResult.next_run_at) throw new Error(jobsResult.error || "failed to resolve jobs schedule");
    store.setScheduleRuntime("network", { next_run_at: pair.network, last_status: "cutover_activated" });
    store.setScheduleRuntime("dm", { next_run_at: pair.dm, last_status: "cutover_activated" });
    store.setScheduleRuntime("jobs", { next_run_at: jobsResult.next_run_at, last_status: "cutover_activated" });
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    store.close();
    throw error;
  }
  setPhase("activated");
  const status = safeStatus(store);
  store.close();
  return status;
}

function verify() {
  const store = new AppStore(databasePath);
  const status = safeStatus(store);
  const recovery = readRecovery();
  const byPipeline = Object.fromEntries(status.schedules.map((item) => [item.pipeline, item]));
  const failures = [];
  if (status.pipeline_run_count !== recovery.pipeline_run_count) failures.push("pipeline_run_count_changed");
  if (!status.google_oauth.client_configured || !status.google_oauth.connected || !status.google_oauth.has_refresh_token) failures.push("google_oauth_incomplete");
  if (status.key_counts.gemini < 1) failures.push("gemini_key_missing");
  if (status.key_counts.openrouter < 1) failures.push("openrouter_key_missing");
  if (!status.email_delivery.ready || !status.email_delivery.enabled) failures.push(`email_delivery_${status.email_delivery.reason || "disabled"}`);
  if (!status.notifications.job_digest_enabled) failures.push("job_digest_disabled");
  if (!status.notifications.calendar_enabled) failures.push("calendar_disabled");
  if ([byPipeline.network, byPipeline.dm, byPipeline.jobs].some((item) => item?.mode !== "auto")) failures.push("schedule_not_automatic");
  if (!byPipeline.network?.next_run_at || !byPipeline.dm?.next_run_at) failures.push("inbox_marker_missing");
  else if (new Date(byPipeline.dm.next_run_at) - new Date(byPipeline.network.next_run_at) !== 5 * 60_000) failures.push("inbox_phase_invalid");
  for (const [name, mode] of Object.entries(status.file_modes)) {
    if (mode !== null && mode !== 0o600) failures.push(`${name}_mode_${mode.toString(8)}`);
  }
  store.close();
  return { ok: failures.length === 0, failures, ...status };
}

function rollback() {
  const recovery = readRecovery();
  const store = new AppStore(databasePath);
  store.db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of recovery.schedules) {
      const columns = Object.keys(row);
      const assignments = columns.map((column) => `${column} = excluded.${column}`).join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      store.db.prepare(`INSERT INTO pipeline_schedules (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(pipeline) DO UPDATE SET ${assignments}`)
        .run(...columns.map((column) => row[column]));
    }
    for (const id of recovery.inserted_key_ids || []) store.deleteApiKey(id);
    if (recovery.oauth_google) {
      const row = recovery.oauth_google;
      const columns = Object.keys(row);
      const assignments = columns.map((column) => `${column} = excluded.${column}`).join(", ");
      store.db.prepare(`INSERT INTO oauth_credentials (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT(provider) DO UPDATE SET ${assignments}`)
        .run(...columns.map((column) => row[column]));
    } else {
      store.db.prepare("DELETE FROM oauth_credentials WHERE provider = 'google'").run();
    }
    if (recovery.notification_settings) {
      const row = recovery.notification_settings;
      const columns = Object.keys(row);
      const assignments = columns.map((column) => `${column} = excluded.${column}`).join(", ");
      store.db.prepare(`INSERT INTO notification_settings (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT(id) DO UPDATE SET ${assignments}`)
        .run(...columns.map((column) => row[column]));
    } else if (Object.hasOwn(recovery, "notification_settings")) {
      store.db.prepare("DELETE FROM notification_settings WHERE id = 1").run();
    }
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    store.close();
    throw error;
  }
  setPhase("rolled_back");
  const status = safeStatus(store);
  store.close();
  return status;
}

let result;
if (command === "prepare") result = prepare();
else if (command === "activate") result = activate();
else if (command === "verify") result = verify();
else if (command === "rollback") result = rollback();
else if (command === "phase") result = setPhase(process.argv[3], process.argv[4] ? JSON.parse(process.argv[4]) : {});
else throw new Error("usage: web-scheduler-cutover.mjs <prepare|activate|verify|rollback|phase>");

console.log(JSON.stringify(result, null, 2));
