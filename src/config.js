import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, EDITABLE, SAFETY, coerceEditable, getPath, setPath } from "./config-defaults.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const LEGACY_CONFIG_PATH = path.join(ROOT, "config.json");

/**
 * Effective configuration, resolved in this order (later wins):
 *
 *   1. DEFAULTS            in code, so a fresh install boots with no files
 *   2. config.json         legacy override, optional
 *   3. database overrides  what the user changed in the web console
 *   4. environment         deployment-level escape hatch
 *
 * SAFETY is applied last and cannot be overridden by any of them.
 */
export function resolveConfig({ overrides = null, legacy = undefined } = {}) {
  const config = deepClone(DEFAULTS);

  const legacyFile = legacy === undefined ? readLegacyConfig() : legacy;
  if (legacyFile) deepMerge(config, legacyFile);
  if (overrides) deepMerge(config, overrides);
  applyEnvironment(config);

  config.security = deepClone(SAFETY);
  config.jobs_watcher.blocked_question_patterns = [...SAFETY.blocked_question_patterns];

  // The semantic memory reads from the same database as everything else.
  config.jobs_watcher.semantic_memory.database_path = config.storage.database_path;
  return config;
}

export function readLegacyConfig(filePath = LEGACY_CONFIG_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function legacyConfigExists(filePath = LEGACY_CONFIG_PATH) {
  return fs.existsSync(filePath);
}

export { LEGACY_CONFIG_PATH };

/** Deployment-level overrides, useful for running more than one instance. */
function applyEnvironment(config) {
  const database = process.env.AGENT_DATABASE_PATH;
  if (database) config.storage.database_path = database;

  const profile = process.env.AGENT_PROFILE_PATH;
  if (profile) config.profile_path = profile;

  const browserDir = process.env.AGENT_BROWSER_PROFILE_DIR;
  if (browserDir) config.browser.user_data_dir = browserDir;

  if (process.env.LINKEDIN_HEADLESS) config.browser.headless = process.env.LINKEDIN_HEADLESS === "true";
  if (process.env.LINKEDIN_JOBS_READ_ONLY === "true") config.jobs_watcher.read_only = true;

  const port = Number(process.env.GOOGLE_REDIRECT_PORT);
  if (Number.isInteger(port) && port > 0) config.gmail.redirect_port = port;
  return config;
}

/**
 * Path used to open the database before any of it can be read. Deliberately does
 * not depend on the database, and works with no files present.
 */
export function bootstrapDatabasePath() {
  if (process.env.AGENT_DATABASE_PATH) return path.resolve(ROOT, process.env.AGENT_DATABASE_PATH);
  const legacy = readLegacyConfig();
  const configured = legacy?.storage?.database_path || DEFAULTS.storage.database_path;
  return path.resolve(ROOT, configured);
}

/**
 * Copies the editable values from a legacy `config.json` into the database once,
 * so an existing install keeps its settings and the file becomes optional.
 *
 * Values that fail validation are skipped individually — one bad entry never
 * discards the rest of the import.
 */
export function importLegacyConfig(store, { filePath = LEGACY_CONFIG_PATH } = {}) {
  if (store.getSetting("config_imported_at")) return { imported: false, reason: "ja_importado" };

  const legacy = readLegacyConfig(filePath);
  if (!legacy) {
    store.setSetting("config_imported_at", new Date().toISOString());
    return { imported: false, reason: "sem_config_json" };
  }

  const overrides = {};
  const skipped = [];
  let count = 0;

  for (const field of EDITABLE) {
    const value = getPath(legacy, field.path);
    if (value === undefined || value === null) continue;
    try {
      setPath(overrides, field.path, coerceEditable(field.path, value));
      count++;
    } catch (error) {
      skipped.push(`${field.path}: ${error.message}`);
    }
  }

  store.setConfigOverrides(overrides);
  store.setSetting("config_imported_at", new Date().toISOString());
  return { imported: true, count, skipped };
}

/**
 * Moves the former implicit 08:00-22:00 lock into an explicit global pause.
 * The marker, configuration and matching legacy schedule windows are committed
 * together so a crash cannot leave a half-migrated scheduler.
 */
export function migratePauseConfigV1(store, now = new Date()) {
  const marker = "pause_config_v1_migrated_at";
  if (store.getSetting(marker)) return { migrated: false, reason: "ja_migrado" };

  store.db.exec("BEGIN IMMEDIATE");
  try {
    const overrides = structuredClone(store.getConfigOverrides());
    overrides.pause = { ...structuredClone(DEFAULTS.pause), ...(overrides.pause || {}) };
    store.setConfigOverrides(overrides);
    const result = store.db.prepare(`
      UPDATE pipeline_schedules
      SET window_start = '', window_end = '', updated_at = ?
      WHERE pipeline IN ('network', 'dm', 'jobs') AND window_start = '08:00' AND window_end = '22:00'
    `).run(now.toISOString());
    store.setSetting(marker, now.toISOString());
    store.db.exec("COMMIT");
    return { migrated: true, cleared_windows: Number(result.changes || 0) };
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Gives roles to providers that already had keys before roles existed.
 *
 * Without this an upgraded install would have keys but no primary, and every
 * model call would fail. The legacy `model_gate` names decide the mapping when
 * they are present; otherwise the oldest configured provider becomes primary.
 */
export function migrateProviderRolesV1(store, config) {
  const marker = "provider_roles_v1_migrated_at";
  if (store.getSetting(marker)) return { migrated: false, reason: "ja_migrado" };

  const providers = store.listProviders();
  const configured = providers.filter((provider) => provider.configured);
  if (!configured.length) {
    // Nothing to migrate, but do not run this again on every boot.
    store.setSetting(marker, new Date().toISOString());
    return { migrated: false, reason: "sem_chaves" };
  }

  if (providers.some((provider) => provider.role !== "none")) {
    store.setSetting(marker, new Date().toISOString());
    return { migrated: false, reason: "papeis_ja_definidos" };
  }

  const legacyPrimary = configured.find((provider) => provider.id === config?.model_gate?.provider);
  const legacyFallback = configured.find((provider) => provider.id === config?.model_gate?.fallback_provider);
  const primary = legacyPrimary || configured[0];

  store.setProviderRole(primary.id, "primary");
  if (legacyFallback && legacyFallback.id !== primary.id) store.setProviderRole(legacyFallback.id, "fallback");

  // Carry over the models the legacy configuration was using.
  const legacyModels = {
    gemini: config?.model_gate?.job_model || config?.model_gate?.validator_model,
    openrouter: config?.model_gate?.openrouter_model
  };
  for (const provider of configured) {
    const model = legacyModels[provider.id];
    if (model) store.setProviderModel(provider.id, model);
  }

  store.setSetting(marker, new Date().toISOString());
  return { migrated: true, primary: primary.id, fallback: legacyFallback?.id || null };
}

function deepClone(value) {
  return structuredClone(value);
}

/** Merges plain objects recursively; arrays and scalars replace wholesale. */
function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(target[key])) deepMerge(target[key], value);
    else target[key] = isPlainObject(value) || Array.isArray(value) ? deepClone(value) : value;
  }
  return target;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
