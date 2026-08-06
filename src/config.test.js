import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppStore } from "./app-store.js";
import { DEFAULTS, EDITABLE, EDITABLE_BY_PATH, SAFETY, coerceEditable, getPath, setPath } from "./config-defaults.js";
import { migratePauseConfigV1, resolveConfig } from "./config.js";

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
  const store = new AppStore(path.join(dir, "test.sqlite"));
  return { store, dir, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("a fresh install resolves a usable config with no files", () => {
  const config = resolveConfig();
  assert.equal(typeof config.storage.database_path, "string");
  assert.equal(config.jobs_watcher.easy_apply_enabled, true);
  assert.equal(config.model_gate.provider, "gemini");
  assert.ok(config.timezone);
  assert.deepEqual(config.pause, DEFAULTS.pause);
});

test("pause settings are editable clocks with strict syntax", () => {
  assert.equal(coerceEditable("pause.start", "22:00"), "22:00");
  assert.throws(() => coerceEditable("pause.start", "8:00"), /HH:MM/);
  assert.throws(() => coerceEditable("pause.end", "24:00"), /HH:MM/);
  assert.equal(coerceEditable("pause.allow_manual_runs", false), false);
});

test("database overrides win over the defaults", () => {
  const config = resolveConfig({
    overrides: { jobs_watcher: { max_easy_apply_per_day: 7 }, browser: { headless: false } }
  });
  assert.equal(config.jobs_watcher.max_easy_apply_per_day, 7);
  assert.equal(config.browser.headless, false);
  // Untouched siblings keep their default.
  assert.equal(config.jobs_watcher.max_easy_apply_per_run, DEFAULTS.jobs_watcher.max_easy_apply_per_run);
});

test("safety rails cannot be overridden by the database", () => {
  const attack = {
    security: { stop_on_captcha: false },
    jobs_watcher: { blocked_question_patterns: [] }
  };
  const config = resolveConfig({ overrides: attack });
  assert.equal(config.security.stop_on_captcha, true);
  assert.deepEqual(config.jobs_watcher.blocked_question_patterns, [...SAFETY.blocked_question_patterns]);
  assert.ok(config.jobs_watcher.blocked_question_patterns.includes("disability"));
});

test("the semantic memory always points at the configured database", () => {
  const config = resolveConfig({ overrides: { storage: { database_path: "./outro.sqlite" } } });
  assert.equal(config.jobs_watcher.semantic_memory.database_path, "./outro.sqlite");
});

test("arrays replace instead of merging element by element", () => {
  const config = resolveConfig({
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

test("numeric settings are clamped to the sanity ceiling", () => {
  // Volume is the user's decision, so the ceiling here catches a slipped digit
  // rather than enforcing a policy; the real guard rails live in SAFETY.
  assert.equal(coerceEditable("jobs_watcher.max_easy_apply_per_day", 10), 10);
  assert.equal(coerceEditable("jobs_watcher.max_easy_apply_per_day", 40), 40);
  assert.throws(() => coerceEditable("jobs_watcher.max_easy_apply_per_day", 5000), /entre/);
  assert.throws(() => coerceEditable("jobs_watcher.max_easy_apply_per_day", -1), /entre/);
  assert.throws(() => coerceEditable("jobs_watcher.max_easy_apply_per_day", "abc"), /num[eé]rico/);
});

test("as novas chaves do pipeline de vagas têm padrão", () => {
  const config = resolveConfig();
  assert.equal(config.jobs_watcher.freshness_days, 7);
  assert.deepEqual(config.jobs_watcher.blocked_companies, []);
  assert.deepEqual(config.jobs_watcher.blocked_apply_domains, []);
  assert.equal(config.jobs_watcher.resolve_external_apply_url, false);
  assert.equal(config.jobs_watcher.quarantine_hours, 72);
  assert.equal(config.jobs_watcher.run_budget_minutes, 12);
});

test("string_list normaliza, deduplica e descarta vazios", () => {
  const value = coerceEditable("jobs_watcher.blocked_companies", ["  Micro1 ", "micro1", "", "Outra"]);
  assert.deepEqual(value, ["Micro1", "Outra"]);
});

test("string_list recusa o que não é lista", () => {
  assert.throws(() => coerceEditable("jobs_watcher.blocked_apply_domains", "micro1.ai"), /lista/i);
});

test("SAFETY continua fora da superfície editável", () => {
  for (const field of EDITABLE) {
    assert.ok(!field.path.startsWith("security."), field.path);
    assert.notEqual(field.path, "jobs_watcher.blocked_question_patterns");
  }
});

test("job searches auto-build LinkedIn URLs from job names", () => {
  const valid = coerceEditable("jobs_watcher.searches", [
    { name: "ai", url: "https://www.linkedin.com/jobs/search-results/?keywords=AI" },
    "Desenvolvedor Node.js",
    { name: "Engenheiro Frontend" }
  ]);
  assert.equal(valid[0].name, "ai");
  assert.equal(valid[0].url, "https://www.linkedin.com/jobs/search-results/?keywords=AI");
  assert.equal(valid[1].name, "Desenvolvedor Node.js");
  assert.equal(valid[1].url, "https://www.linkedin.com/jobs/search/?keywords=Desenvolvedor%20Node.js");
  assert.equal(valid[2].name, "Engenheiro Frontend");
  assert.equal(valid[2].url, "https://www.linkedin.com/jobs/search/?keywords=Engenheiro%20Frontend");
});

test("known answers reject an invalid regular expression", () => {
  assert.deepEqual(
    coerceEditable("jobs_watcher.known_answers", [{ pattern: "react", value: "Yes" }]),
    [{ pattern: "react", value: "Yes" }]
  );
  assert.throws(() => coerceEditable("jobs_watcher.known_answers", [{ pattern: "[unclosed", value: "x" }]), /inv[aá]lida/);
  assert.throws(() => coerceEditable("jobs_watcher.known_answers", [{ pattern: "ok", value: "" }]), /obrigat[oó]rios/);
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

test("pause migration atomically initializes config and clears only legacy windows", () => {
  const { store, cleanup } = freshStore();
  try {
    store.updateSchedule("network", { window_start: "08:00", window_end: "22:00" });
    store.updateSchedule("dm", { window_start: "09:00", window_end: "18:00" });
    store.updateSchedule("jobs", { window_start: "08:00", window_end: "22:00" });
    const result = migratePauseConfigV1(store, new Date("2026-08-05T10:00:00Z"));
    assert.equal(result.migrated, true);
    assert.equal(result.cleared_windows, 2);
    assert.deepEqual(store.getConfigOverrides().pause, DEFAULTS.pause);
    assert.equal(store.getSchedule("network").window_start, "");
    assert.equal(store.getSchedule("jobs").window_end, "");
    assert.equal(store.getSchedule("dm").window_start, "09:00");
    assert.equal(store.getSetting("pause_config_v1_migrated_at"), "2026-08-05T10:00:00.000Z");
    assert.equal(migratePauseConfigV1(store).migrated, false);
  } finally {
    cleanup();
  }
});
