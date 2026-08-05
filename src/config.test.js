import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppStore } from "./app-store.js";
import { DEFAULTS, EDITABLE_BY_PATH, HARD_LIMITS, SAFETY, coerceEditable, getPath, setPath } from "./config-defaults.js";
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
