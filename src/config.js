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
