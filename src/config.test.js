import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppStore } from "./app-store.js";
import { DEFAULTS, EDITABLE_BY_PATH, HARD_LIMITS, SAFETY, coerceEditable, getPath, setPath } from "./config-defaults.js";
import { importLegacyConfig, resolveConfig } from "./config.js";

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
  const store = new AppStore(path.join(dir, "test.sqlite"));
  return { store, dir, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function writeLegacy(dir, config) {
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify(config));
  return file;
}

test("a fresh install resolves a usable config with no files", () => {
  const config = resolveConfig({ legacy: null });
  assert.equal(typeof config.storage.database_path, "string");
  assert.equal(config.jobs_watcher.easy_apply_enabled, true);
  assert.equal(config.model_gate.provider, "gemini");
  assert.ok(config.timezone);
});

test("database overrides win over the defaults", () => {
  const config = resolveConfig({
    legacy: null,
    overrides: { jobs_watcher: { max_easy_apply_per_day: 7 }, browser: { headless: false } }
  });
  assert.equal(config.jobs_watcher.max_easy_apply_per_day, 7);
  assert.equal(config.browser.headless, false);
  // Untouched siblings keep their default.
  assert.equal(config.jobs_watcher.max_easy_apply_per_run, DEFAULTS.jobs_watcher.max_easy_apply_per_run);
});

test("database overrides win over config.json", () => {
  const config = resolveConfig({
    legacy: { jobs_watcher: { max_easy_apply_per_day: 5 } },
    overrides: { jobs_watcher: { max_easy_apply_per_day: 9 } }
  });
  assert.equal(config.jobs_watcher.max_easy_apply_per_day, 9);
});

test("config.json still applies when the database has no override", () => {
  const config = resolveConfig({ legacy: { timezone: "Europe/Lisbon" }, overrides: {} });
  assert.equal(config.timezone, "Europe/Lisbon");
});

test("safety rails cannot be overridden by config.json or by the database", () => {
  const attack = {
    security: { stop_on_captcha: false },
    jobs_watcher: { blocked_question_patterns: [] }
  };
  for (const source of [{ legacy: attack, overrides: null }, { legacy: null, overrides: attack }]) {
    const config = resolveConfig(source);
    assert.equal(config.security.stop_on_captcha, true);
    assert.deepEqual(config.jobs_watcher.blocked_question_patterns, [...SAFETY.blocked_question_patterns]);
    assert.ok(config.jobs_watcher.blocked_question_patterns.includes("disability"));
  }
});

test("the semantic memory always points at the configured database", () => {
  const config = resolveConfig({ legacy: null, overrides: { storage: { database_path: "./outro.sqlite" } } });
  assert.equal(config.jobs_watcher.semantic_memory.database_path, "./outro.sqlite");
});

test("arrays replace instead of merging element by element", () => {
  const config = resolveConfig({
    legacy: null,
    overrides: { jobs_watcher: { searches: [{ name: "a", url: "https://www.linkedin.com/jobs/x" }] } }
  });
  assert.equal(config.jobs_watcher.searches.length, 1);
});

test("only whitelisted paths are editable", () => {
  assert.throws(() => coerceEditable("storage.database_path", "/etc/passwd"), /n[aã]o edit[aá]vel/);
  assert.throws(() => coerceEditable("security.stop_on_captcha", false), /n[aã]o edit[aá]vel/);
  assert.throws(() => coerceEditable("jobs_watcher.blocked_question_patterns", []), /n[aã]o edit[aá]vel/);
  assert.ok(EDITABLE_BY_PATH.has("jobs_watcher.max_easy_apply_per_day"));
});

test("numeric settings are clamped to the hard ceiling", () => {
  assert.equal(coerceEditable("jobs_watcher.max_easy_apply_per_day", 10), 10);
  assert.throws(() => coerceEditable("jobs_watcher.max_easy_apply_per_day", HARD_LIMITS.max_easy_apply_per_day + 1), /entre/);
  assert.throws(() => coerceEditable("jobs_watcher.max_easy_apply_per_day", -1), /entre/);
  assert.throws(() => coerceEditable("jobs_watcher.max_easy_apply_per_day", "abc"), /num[eé]rico/);
});

test("job searches must be LinkedIn job URLs", () => {
  const valid = coerceEditable("jobs_watcher.searches", [
    { name: "ai", url: "https://www.linkedin.com/jobs/search-results/?keywords=AI" }
  ]);
  assert.equal(valid[0].name, "ai");

  for (const url of ["https://evil.example.com/jobs/", "https://www.linkedin.com/feed/", "javascript:alert(1)", ""]) {
    assert.throws(() => coerceEditable("jobs_watcher.searches", [{ name: "x", url }]), /LinkedIn/, url);
  }
});

test("known answers reject an invalid regular expression", () => {
  assert.deepEqual(
    coerceEditable("jobs_watcher.known_answers", [{ pattern: "react", value: "Yes" }]),
    [{ pattern: "react", value: "Yes" }]
  );
  assert.throws(() => coerceEditable("jobs_watcher.known_answers", [{ pattern: "[unclosed", value: "x" }]), /inv[aá]lida/);
  assert.throws(() => coerceEditable("jobs_watcher.known_answers", [{ pattern: "ok", value: "" }]), /obrigat[oó]rios/);
});

test("importing config.json copies the editable values into the database", () => {
  const { store, dir, cleanup } = freshStore();
  try {
    const file = writeLegacy(dir, {
      timezone: "America/Sao_Paulo",
      jobs_watcher: {
        max_easy_apply_per_day: 12,
        searches: [{ name: "ai", url: "https://www.linkedin.com/jobs/search-results/?keywords=AI" }]
      },
      storage: { database_path: "/nao/deve/ser/importado.sqlite" }
    });

    const result = importLegacyConfig(store, { filePath: file });
    assert.equal(result.imported, true);
    assert.ok(result.count >= 3);

    const overrides = store.getConfigOverrides();
    assert.equal(overrides.jobs_watcher.max_easy_apply_per_day, 12);
    assert.equal(overrides.jobs_watcher.searches.length, 1);
    // Not on the editable list, so it is never imported.
    assert.equal(overrides.storage, undefined);
  } finally {
    cleanup();
  }
});

test("a bad value in config.json is skipped without losing the rest", () => {
  const { store, dir, cleanup } = freshStore();
  try {
    const file = writeLegacy(dir, {
      jobs_watcher: {
        max_easy_apply_per_day: 999999,
        searches: [{ name: "ok", url: "https://www.linkedin.com/jobs/search-results/?keywords=AI" }]
      }
    });

    const result = importLegacyConfig(store, { filePath: file });
    assert.equal(result.imported, true);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /max_easy_apply_per_day/);

    const overrides = store.getConfigOverrides();
    assert.equal(overrides.jobs_watcher.max_easy_apply_per_day, undefined);
    assert.equal(overrides.jobs_watcher.searches.length, 1);
  } finally {
    cleanup();
  }
});

test("the import runs only once", () => {
  const { store, dir, cleanup } = freshStore();
  try {
    const file = writeLegacy(dir, { jobs_watcher: { max_easy_apply_per_day: 4 } });
    assert.equal(importLegacyConfig(store, { filePath: file }).imported, true);

    // A later edit must not be undone by a second import on the next boot.
    store.setConfigOverrides({ jobs_watcher: { max_easy_apply_per_day: 8 } });
    assert.equal(importLegacyConfig(store, { filePath: file }).imported, false);
    assert.equal(store.getConfigOverrides().jobs_watcher.max_easy_apply_per_day, 8);
  } finally {
    cleanup();
  }
});

test("importing works when there is no config.json at all", () => {
  const { store, dir, cleanup } = freshStore();
  try {
    const result = importLegacyConfig(store, { filePath: path.join(dir, "nao-existe.json") });
    assert.equal(result.imported, false);
    assert.equal(result.reason, "sem_config_json");
    assert.deepEqual(store.getConfigOverrides(), {});
  } finally {
    cleanup();
  }
});

test("config overrides survive a restart and are cached", () => {
  const { store, cleanup } = freshStore();
  try {
    store.setConfigOverrides({ timezone: "Europe/Madrid" });
    assert.equal(store.getConfigOverrides().timezone, "Europe/Madrid");
    // Second read comes from the cache and must be identical.
    assert.equal(store.getConfigOverrides().timezone, "Europe/Madrid");

    store.setConfigOverrides({ timezone: "Europe/Lisbon" });
    assert.equal(store.getConfigOverrides().timezone, "Europe/Lisbon");
  } finally {
    cleanup();
  }
});

test("path helpers handle nested creation and missing branches", () => {
  const target = {};
  setPath(target, "a.b.c", 1);
  assert.equal(getPath(target, "a.b.c"), 1);
  assert.equal(getPath(target, "a.x.y"), undefined);
  assert.equal(getPath({}, "nada"), undefined);
});
