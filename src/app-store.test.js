import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { AppStore, PIPELINE_IDS, maskSecret, normalizeDailyTimes, normalizeWeekdays } from "./app-store.js";
import { normalizeJobRecord } from "./agent-record.js";

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-store-"));
  const store = new AppStore(path.join(dir, "test.sqlite"));
  return { store, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("secrets are masked and never fully exposed by default", () => {
  assert.equal(maskSecret("AIzaSyABCDEFGHIJKLMNOP"), "AIza********MNOP");
  assert.equal(maskSecret("short"), "sh***");
});

test("api keys round-trip without leaking the secret in listings", () => {
  const { store, cleanup } = freshStore();
  try {
    const id = store.createApiKey({ provider: "gemini", label: "principal", secret: "AIzaSy-primary-key" });
    const [item] = store.listApiKeys();
    assert.equal(item.id, id);
    assert.equal(item.secret, undefined);
    assert.equal(item.masked.includes("primary"), false);
    assert.equal(item.enabled, true);

    assert.equal(store.activeApiKeys("gemini")[0].secret, "AIzaSy-primary-key");
  } finally {
    cleanup();
  }
});

test("disabled keys are excluded from the active rotation", () => {
  const { store, cleanup } = freshStore();
  try {
    const first = store.createApiKey({ provider: "gemini", label: "a", secret: "key-aaaaaaaa" });
    store.createApiKey({ provider: "gemini", label: "b", secret: "key-bbbbbbbb" });
    assert.equal(store.activeApiKeys("gemini").length, 2);

    store.updateApiKey(first, { enabled: false });
    const active = store.activeApiKeys("gemini");
    assert.equal(active.length, 1);
    assert.equal(active[0].secret, "key-bbbbbbbb");
  } finally {
    cleanup();
  }
});

test("api key validation rejects bad providers and short secrets", () => {
  const { store, cleanup } = freshStore();
  try {
    // OpenAI is a supported provider now; an unknown one still fails.
    assert.throws(() => store.createApiKey({ provider: "anthropic", secret: "long-enough-secret" }), /provider/);
    assert.doesNotThrow(() => store.createApiKey({ provider: "openai", label: "o", secret: "sk-proj-abcdefgh" }));
    assert.throws(() => store.createApiKey({ provider: "gemini", secret: "tiny" }), /too short/);
  } finally {
    cleanup();
  }
});

test("updating a key without a secret keeps the stored one", () => {
  const { store, cleanup } = freshStore();
  try {
    const id = store.createApiKey({ provider: "openrouter", label: "or", secret: "sk-or-original-key" });
    store.updateApiKey(id, { label: "renomeada" });
    assert.equal(store.activeApiKeys("openrouter")[0].secret, "sk-or-original-key");
    assert.equal(store.listApiKeys()[0].label, "renomeada");
  } finally {
    cleanup();
  }
});

test("every known pipeline gets a default manual schedule", () => {
  const { store, cleanup } = freshStore();
  try {
    const schedules = store.listSchedules();
    assert.deepEqual(schedules.map((item) => item.pipeline).sort(), [...PIPELINE_IDS].sort());
    for (const schedule of schedules) {
      assert.equal(schedule.mode, "manual", `${schedule.pipeline} deve comecar em manual`);
      assert.ok(schedule.cron.length > 0);
    }
  } finally {
    cleanup();
  }
});

test("schedules accept every supported scheduling kind", () => {
  const { store, cleanup } = freshStore();
  try {
    const cron = store.updateSchedule("jobs", { mode: "auto", schedule_kind: "cron", cron: "0 9 * * 1-5" });
    assert.equal(cron.mode, "auto");
    assert.equal(cron.cron, "0 9 * * 1-5");

    const interval = store.updateSchedule("dm", { mode: "auto", schedule_kind: "interval", interval_minutes: 25 });
    assert.equal(interval.interval_minutes, 25);

    const daily = store.updateSchedule("network", {
      mode: "auto",
      schedule_kind: "daily_times",
      daily_times: ["09:05", "18:00", "18:00", "bad", "9:5"]
    });
    assert.deepEqual(daily.daily_times, ["09:05", "18:00"]);
  } finally {
    cleanup();
  }
});

test("daily schedules preserve sub-hour slots across a full work window", () => {
  const { store, cleanup } = freshStore();
  try {
    const dailyTimes = [];
    for (let minutes = 8 * 60; minutes < 22 * 60; minutes += 27) {
      dailyTimes.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
    }
    const daily = store.updateSchedule("network", {
      mode: "auto",
      schedule_kind: "daily_times",
      daily_times: dailyTimes
    });
    assert.equal(daily.daily_times.length, 32);
    assert.equal(daily.daily_times.at(-1), "21:57");
  } finally {
    cleanup();
  }
});

test("automatic mode requires a usable schedule", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.throws(() => store.updateSchedule("jobs", { mode: "auto", schedule_kind: "cron", cron: "" }), /cron/i);
    assert.throws(
      () => store.updateSchedule("jobs", { mode: "auto", schedule_kind: "daily_times", daily_times: [] }),
      /hor[aá]rio/i
    );
    assert.throws(() => store.updateSchedule("jobs", { mode: "turbo" }), /mode/);
    assert.throws(() => store.updateSchedule("inexistente", { mode: "manual" }), /unknown pipeline/);
  } finally {
    cleanup();
  }
});

test("turning a pipeline off preserves its saved cron for later", () => {
  const { store, cleanup } = freshStore();
  try {
    store.updateSchedule("jobs", { mode: "auto", schedule_kind: "cron", cron: "30 8 * * *" });
    const off = store.updateSchedule("jobs", { mode: "off" });
    assert.equal(off.mode, "off");
    assert.equal(off.cron, "30 8 * * *");
  } finally {
    cleanup();
  }
});

test("interval and jitter values are clamped to sane bounds", () => {
  const { store, cleanup } = freshStore();
  try {
    const high = store.updateSchedule("dm", { schedule_kind: "interval", interval_minutes: 99999, jitter_seconds: 99999 });
    assert.equal(high.interval_minutes, 1440);
    assert.equal(high.jitter_seconds, 3600);

    const low = store.updateSchedule("dm", { interval_minutes: 0, jitter_seconds: -5 });
    assert.equal(low.interval_minutes, 1);
    assert.equal(low.jitter_seconds, 0);
  } finally {
    cleanup();
  }
});

test("runs record their lifecycle and summary", () => {
  const { store, cleanup } = freshStore();
  try {
    const runId = store.startRun({ pipeline: "jobs", trigger: "manual" });
    assert.ok(store.runningRun("jobs"));

    store.finishRun(runId, { status: "success", exit_code: 0, summary: { status: "scanned", job_count: 12 } });
    const [run] = store.listRuns({ pipeline: "jobs" }).items;
    assert.equal(run.status, "success");
    assert.equal(run.summary.job_count, 12);
    assert.ok(run.duration_ms !== null);
    assert.equal(store.runningRun("jobs"), null);
  } finally {
    cleanup();
  }
});

test("stale running executions are released", () => {
  const { store, cleanup } = freshStore();
  try {
    store.startRun({ pipeline: "jobs", trigger: "auto" });
    assert.equal(store.releaseStaleRuns(-1), 1);
    assert.equal(store.runningRun("jobs"), null);
  } finally {
    cleanup();
  }
});

test("agent records upsert by identity and stay consistent across pipelines", () => {
  const { store, cleanup } = freshStore();
  try {
    const job = {
      external_id: "999",
      title: "Engenheiro",
      company: "Acme",
      location: "Remoto",
      url: "https://linkedin.com/jobs/view/999/",
      apply_url: "https://linkedin.com/jobs/view/999/apply/",
      easy_apply: true,
      search_name: "busca"
    };
    const record = normalizeJobRecord(job, null, { score: 75 });
    store.upsertAgentRecord(record);
    store.upsertAgentRecord(normalizeJobRecord({ ...job, title: "Engenheiro Senior" }, null, { score: 80 }));

    const { items, total } = store.listAgentRecords({ kind: "job" });
    assert.equal(total, 1);
    assert.equal(items[0].title, "Engenheiro Senior");
    assert.equal(items[0].score, 80);
    assert.equal(items[0].raw.job.external_id, "999");
  } finally {
    cleanup();
  }
});

test("a rescan never downgrades an already sent record", () => {
  const { store, cleanup } = freshStore();
  try {
    const job = { external_id: "1", title: "X", easy_apply: true, url: "u", apply_url: "a" };
    store.upsertAgentRecord(normalizeJobRecord(job, null, {}));
    const record = store.listAgentRecords({ kind: "job" }).items[0];

    store.setSendState(record.record_id, { send_state: "sent_manual", sent_by: "manual" });
    // A later scan sees the job again and would normally mark it "available".
    store.upsertAgentRecord(normalizeJobRecord(job, null, {}));

    const after = store.getAgentRecord(record.record_id);
    assert.equal(after.send_state, "sent_manual");
    assert.equal(after.sent_by, "manual");
    assert.ok(after.sent_at);
    assert.equal(after.status, "sent");
  } finally {
    cleanup();
  }
});

test("records can be filtered by state and searched by text", () => {
  const { store, cleanup } = freshStore();
  try {
    store.upsertAgentRecord(normalizeJobRecord(
      { external_id: "1", title: "AI Engineer", company: "Acme", easy_apply: true }, null, {}
    ));
    store.upsertAgentRecord(normalizeJobRecord(
      { external_id: "2", title: "Backend Dev", company: "Globex", easy_apply: false }, null, {}
    ));

    assert.equal(store.listAgentRecords({ kind: "job", sendState: "available" }).total, 1);
    assert.equal(store.listAgentRecords({ kind: "job", sendState: "unsupported" }).total, 1);
    assert.equal(store.listAgentRecords({ kind: "job", search: "globex" }).total, 1);
    assert.equal(store.listAgentRecords({ kind: "job", search: "ENGINEER" }).total, 1);

    const counts = store.agentRecordCounts("job");
    assert.equal(counts.available, 1);
    assert.equal(counts.unsupported, 1);
  } finally {
    cleanup();
  }
});

test("settings store arbitrary JSON values", () => {
  const { store, cleanup } = freshStore();
  try {
    store.setSetting("ui.rows_per_page", 50);
    store.setSetting("ui.filters", { kind: "job" });
    assert.equal(store.getSetting("ui.rows_per_page"), 50);
    assert.deepEqual(store.getSetting("ui.filters"), { kind: "job" });
    assert.equal(store.getSetting("missing", "fallback"), "fallback");
  } finally {
    cleanup();
  }
});

test("the rate limit allows a burst and then blocks", () => {
  const { store, cleanup } = freshStore();
  try {
    const now = Date.parse("2026-08-05T10:00:00.000Z");
    const options = { capacity: 3, refillPerSecond: 1 / 30, now };

    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal(store.consumeRateLimit("extract", options).allowed, true, `tentativa ${attempt + 1}`);
    }
    const blocked = store.consumeRateLimit("extract", options);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retry_after_seconds > 0 && blocked.retry_after_seconds <= 30);
  } finally {
    cleanup();
  }
});

test("the rate limit refills over time and caps at capacity", () => {
  const { store, cleanup } = freshStore();
  try {
    const start = Date.parse("2026-08-05T10:00:00.000Z");
    const options = (now) => ({ capacity: 3, refillPerSecond: 1 / 30, now });

    for (let attempt = 0; attempt < 3; attempt++) store.consumeRateLimit("extract", options(start));
    assert.equal(store.consumeRateLimit("extract", options(start)).allowed, false);

    // 30s later exactly one token is back.
    assert.equal(store.consumeRateLimit("extract", options(start + 30_000)).allowed, true);
    assert.equal(store.consumeRateLimit("extract", options(start + 30_000)).allowed, false);

    // After a long idle period the bucket is full again, but never above capacity.
    const later = start + 3_600_000;
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal(store.consumeRateLimit("extract", options(later)).allowed, true, `pos-espera ${attempt + 1}`);
    }
    assert.equal(store.consumeRateLimit("extract", options(later)).allowed, false);
  } finally {
    cleanup();
  }
});

test("rate limit buckets are independent per key", () => {
  const { store, cleanup } = freshStore();
  try {
    const options = { capacity: 1, refillPerSecond: 1 / 60, now: Date.now() };
    assert.equal(store.consumeRateLimit("a", options).allowed, true);
    assert.equal(store.consumeRateLimit("a", options).allowed, false);
    assert.equal(store.consumeRateLimit("b", options).allowed, true);
  } finally {
    cleanup();
  }
});

test("the rate limit survives reopening the database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-store-"));
  const file = path.join(dir, "test.sqlite");
  try {
    const now = Date.parse("2026-08-05T10:00:00.000Z");
    const options = { capacity: 2, refillPerSecond: 1 / 60, now };

    const first = new AppStore(file);
    first.consumeRateLimit("extract", options);
    first.consumeRateLimit("extract", options);
    first.close();

    // A restart must not hand out a fresh bucket.
    const second = new AppStore(file);
    assert.equal(second.consumeRateLimit("extract", options).allowed, false);
    second.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("onboarding starts incomplete and is marked complete on save", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.equal(store.isOnboardingComplete(), false);
    assert.equal(store.getUserProfile().resume_text, "");

    store.saveUserProfile({ resume_text: "Curriculo do Gabriel", profile: { identity: { full_name: "Gabriel" } } });
    assert.equal(store.isOnboardingComplete(), false, "salvar rascunho nao conclui o onboarding");

    store.saveUserProfile({ complete_onboarding: true });
    assert.equal(store.isOnboardingComplete(), true);
    assert.ok(store.getUserProfile().onboarding_completed_at);
  } finally {
    cleanup();
  }
});

test("the profile cache is invalidated on every write", () => {
  const { store, cleanup } = freshStore();
  try {
    store.saveUserProfile({ profile: { identity: { full_name: "Ana" } } });
    assert.equal(store.getUserProfile().profile.identity.full_name, "Ana");

    store.saveUserProfile({ profile: { identity: { full_name: "Bruno" } } });
    assert.equal(store.getUserProfile().profile.identity.full_name, "Bruno");
  } finally {
    cleanup();
  }
});

test("partial saves keep the fields that were not sent", () => {
  const { store, cleanup } = freshStore();
  try {
    store.saveUserProfile({ resume_text: "texto original", profile: { identity: { full_name: "Ana" } } });
    store.saveUserProfile({ profile: { identity: { full_name: "Ana Maria" } } });

    const stored = store.getUserProfile();
    assert.equal(stored.resume_text, "texto original");
    assert.equal(stored.profile.identity.full_name, "Ana Maria");
  } finally {
    cleanup();
  }
});

test("completing the onboarding twice keeps the first timestamp", () => {
  const { store, cleanup } = freshStore();
  try {
    const first = store.saveUserProfile({ complete_onboarding: true }).onboarding_completed_at;
    const second = store.saveUserProfile({ complete_onboarding: true }).onboarding_completed_at;
    assert.equal(first, second);
  } finally {
    cleanup();
  }
});

test("resetting the onboarding keeps the profile data", () => {
  const { store, cleanup } = freshStore();
  try {
    store.saveUserProfile({ resume_text: "curriculo", profile: { identity: { full_name: "Ana" } }, complete_onboarding: true });
    store.resetOnboarding();

    const stored = store.getUserProfile();
    assert.equal(stored.onboarding_complete, false);
    assert.equal(stored.resume_text, "curriculo");
    assert.equal(stored.profile.identity.full_name, "Ana");
  } finally {
    cleanup();
  }
});

test("the profile survives reopening the database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-store-"));
  const file = path.join(dir, "test.sqlite");
  try {
    const first = new AppStore(file);
    first.saveUserProfile({ resume_text: "curriculo", profile: { identity: { full_name: "Ana" } }, complete_onboarding: true });
    first.close();

    const second = new AppStore(file);
    assert.equal(second.isOnboardingComplete(), true);
    assert.equal(second.getUserProfile().profile.identity.full_name, "Ana");
    second.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("weekday and daily time normalization reject junk input", () => {
  assert.deepEqual(normalizeWeekdays([5, 1, 1, 9, -2]), [1, 5]);
  assert.deepEqual(normalizeWeekdays([]), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(normalizeDailyTimes("08:00, 25:00, 7:5, 07:05"), ["07:05", "08:00"]);
});

/* Pagination: both tables grow without bound, so both are read a page at a time. */

test("run history is paged, and reports how much it is not showing", () => {
  const { store, cleanup } = freshStore();
  try {
    for (let i = 0; i < 12; i++) {
      const id = store.startRun({ pipeline: i % 2 ? "jobs" : "dm", trigger: "auto" });
      store.finishRun(id, { status: "success", summary: { index: i } });
    }

    const first = store.listRuns({ limit: 5 });
    assert.equal(first.items.length, 5);
    assert.equal(first.total, 12, "o total conta tudo, nao so a pagina");

    const second = store.listRuns({ limit: 5, offset: 5 });
    assert.equal(second.items.length, 5);
    assert.equal(second.total, 12);
    // Pages must not overlap, or the reader sees the same run twice.
    const overlap = second.items.filter((item) => first.items.some((other) => other.id === item.id));
    assert.deepEqual(overlap, []);

    const last = store.listRuns({ limit: 5, offset: 10 });
    assert.equal(last.items.length, 2, "a ultima pagina e parcial");
    assert.deepEqual(store.listRuns({ limit: 5, offset: 99 }).items, [], "alem do fim nao inventa linhas");
  } finally {
    cleanup();
  }
});

test("a filtered run history counts only the filtered rows", () => {
  const { store, cleanup } = freshStore();
  try {
    for (let i = 0; i < 7; i++) {
      const id = store.startRun({ pipeline: i < 3 ? "jobs" : "dm", trigger: "auto" });
      store.finishRun(id, { status: "success" });
    }
    // The total drives the page count, so filtering it wrong shows phantom pages.
    assert.equal(store.listRuns({ pipeline: "jobs" }).total, 3);
    assert.equal(store.listRuns({ pipeline: "dm" }).total, 4);
    assert.equal(store.listRuns({}).total, 7);
  } finally {
    cleanup();
  }
});

test("records are paged the same way, with the same guarantees", () => {
  const { store, cleanup } = freshStore();
  try {
    for (let i = 0; i < 9; i++) {
      store.upsertAgentRecord({
        record_id: `job-${i}`, pipeline: "jobs", kind: "job", external_id: String(i),
        title: `Vaga ${i}`, url: "https://x", send_method: "easy_apply",
        send_state: "available", decision: "apply", analyzed_at: new Date(Date.now() - i * 60000).toISOString()
      });
    }
    const page = store.listAgentRecords({ kind: "job", limit: 4, offset: 4 });
    assert.equal(page.items.length, 4);
    assert.equal(page.total, 9);
    assert.deepEqual(store.listAgentRecords({ kind: "job", limit: 4, offset: 8 }).items.length, 1);
  } finally {
    cleanup();
  }
});

test("as colunas novas de agent_records sobrevivem ao round-trip", () => {
  const { store, cleanup } = freshStore();
  try {
    store.upsertAgentRecord({
      record_id: "abc", pipeline: "jobs", kind: "job", external_id: "1",
      title: "Backend", send_method: "easy_apply", send_state: "available",
      work_mode: "remote", posted_at: "2026-08-05T12:00:00.000Z",
      filter_stage: "prefilter", blocked_until: null, digested_at: null, raw: {}
    });

    const record = store.getAgentRecord("abc");
    assert.equal(record.work_mode, "remote");
    assert.equal(record.posted_at, "2026-08-05T12:00:00.000Z");
    assert.equal(record.filter_stage, "prefilter");
  } finally {
    cleanup();
  }
});

test("markRecordsDigested carimba só os ids informados", () => {
  const { store, cleanup } = freshStore();
  try {
    for (const id of ["a", "b"]) {
      store.upsertAgentRecord({
        record_id: id, pipeline: "jobs", kind: "job", external_id: id,
        title: id, send_method: "external", send_state: "unsupported", raw: {}
      });
    }

    assert.equal(store.markRecordsDigested(["a"], "2026-08-06T12:00:00.000Z"), 1);
    assert.equal(store.getAgentRecord("a").digested_at, "2026-08-06T12:00:00.000Z");
    assert.equal(store.getAgentRecord("b").digested_at, null);
  } finally {
    cleanup();
  }
});

test("uma varredura posterior não apaga o carimbo do digest", () => {
  // A later scan knows nothing about the digest; letting it clear the stamp
  // would make an already delivered email look pending and resend it.
  const { store, cleanup } = freshStore();
  try {
    const base = {
      record_id: "c", pipeline: "jobs", kind: "job", external_id: "9",
      title: "x", send_method: "external", send_state: "unsupported", raw: {}
    };
    store.upsertAgentRecord(base);
    store.markRecordsDigested(["c"], "2026-08-06T12:00:00.000Z");
    store.upsertAgentRecord({ ...base, title: "x rescan" });

    assert.equal(store.getAgentRecord("c").digested_at, "2026-08-06T12:00:00.000Z");
    assert.equal(store.getAgentRecord("c").title, "x rescan");
  } finally {
    cleanup();
  }
});

test("listQuarantine devolve só o que ainda está bloqueado no futuro", () => {
  const { store, cleanup } = freshStore();
  try {
    store.upsertAgentRecord({
      record_id: "q1", pipeline: "jobs", kind: "job", external_id: "10",
      title: "x", send_method: "easy_apply", send_state: "blocked",
      blocked_until: "2099-01-01T00:00:00.000Z", raw: {}
    });
    store.upsertAgentRecord({
      record_id: "q2", pipeline: "jobs", kind: "job", external_id: "11",
      title: "y", send_method: "easy_apply", send_state: "blocked",
      blocked_until: "2000-01-01T00:00:00.000Z", raw: {}
    });

    const quarantine = store.listQuarantine("jobs");
    assert.equal(quarantine.get("10"), "2099-01-01T00:00:00.000Z");
    assert.equal(quarantine.has("11"), false);
  } finally {
    cleanup();
  }
});

test("a migração adiciona as colunas novas a um banco antigo sem perder registros", () => {
  // freshStore() gets the columns from CREATE TABLE, so it never exercises the
  // ALTER path. A broken migration corrupts an existing install, so the legacy
  // shape is rebuilt by hand here.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-"));
  const file = path.join(dir, "legacy.sqlite");
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE agent_records (
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
      INSERT INTO agent_records (record_id, pipeline, kind, external_id, title, send_state, sent_at, sent_by, analyzed_at, updated_at)
      VALUES ('old', 'jobs', 'job', '42', 'Vaga antiga', 'sent_auto', '2026-01-01T00:00:00.000Z', 'auto', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);
    legacy.close();

    const store = new AppStore(file);
    try {
      const record = store.getAgentRecord("old");
      // The send history is the thing that must survive the upgrade.
      assert.equal(record.title, "Vaga antiga");
      assert.equal(record.send_state, "sent_auto");
      assert.equal(record.sent_at, "2026-01-01T00:00:00.000Z");
      // And the new columns exist, with their defaults.
      assert.equal(record.work_mode, "unknown");
      assert.equal(record.posted_at, null);
      assert.equal(record.filter_stage, "");
      assert.equal(record.digested_at, null);
      assert.equal(store.listQuarantine("jobs").size, 0);
    } finally {
      store.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
