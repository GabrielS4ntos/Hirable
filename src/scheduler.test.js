import assert from "node:assert/strict";
import test from "node:test";
import { nextInboxPair } from "./scheduler.js";

const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0, 0);
const every27 = (offset = 0) => {
  const values = [];
  for (let minutes = 8 * 60 + offset; minutes < 22 * 60; minutes += 27) {
    if (offset === 0 && minutes + 5 >= 22 * 60) break;
    values.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  }
  return values;
};
const schedule = (pipeline, dailyTimes) => ({
  pipeline,
  mode: "auto",
  schedule_kind: "daily_times",
  daily_times: dailyTimes,
  weekdays: [1, 2, 3, 4, 5, 6],
  window_start: "08:00",
  window_end: "22:00"
});
const network = schedule("network", every27(0));
const dm = schedule("dm", every27(5));

test("inbox pair starts at 08:00 and keeps a five-minute phase", () => {
  const pair = nextInboxPair(network, dm, at(2026, 8, 5, 7, 0));
  assert.equal(new Date(pair.network).getHours(), 8);
  assert.equal(new Date(pair.network).getMinutes(), 0);
  assert.equal(new Date(pair.dm).getTime() - new Date(pair.network).getTime(), 5 * 60_000);
});

test("restart between network and dm skips the orphan dm", () => {
  const pair = nextInboxPair(network, dm, at(2026, 8, 5, 8, 3));
  assert.equal(new Date(pair.network).getMinutes(), 27);
  assert.equal(new Date(pair.dm).getMinutes(), 32);
});

test("resume after suspension chooses the next complete pair", () => {
  const pair = nextInboxPair(network, dm, at(2026, 8, 5, 20, 40));
  assert.equal(new Date(pair.network).getHours(), 21);
  assert.equal(new Date(pair.network).getMinutes(), 3);
  assert.equal(new Date(pair.dm).getMinutes(), 8);
});

test("sunday rolls to monday without losing the phase", () => {
  const pair = nextInboxPair(network, dm, at(2026, 8, 9, 12, 0));
  assert.equal(new Date(pair.network).getDay(), 1);
  assert.equal(new Date(pair.network).getHours(), 8);
  assert.equal(new Date(pair.dm).getTime() - new Date(pair.network).getTime(), 5 * 60_000);
});

test("a mismatched dm list fails closed", () => {
  const badDm = schedule("dm", ["08:06"]);
  const pair = nextInboxPair(network, badDm, at(2026, 8, 5, 7, 0));
  assert.equal(pair.network, null);
  assert.match(pair.error, /complete future inbox pair/i);
});

/* Fallback behaviour: pairing is an optimization, not a requirement. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppStore } from "./app-store.js";
import { Scheduler } from "./scheduler.js";
import { PROFILE_GATE_CODE } from "./profile-gate.js";

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-"));
  const store = new AppStore(path.join(dir, "test.sqlite"));
  return { store, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

// Scheduling tests are about schedules, so the profile gate is injected instead
// of being resolved from whatever profile happens to exist on this machine.
const openGate = () => ({ ready: true, code: null, reason: null, missing: [], onboarding_complete: true });
const closedGate = () => ({
  ready: false,
  code: PROFILE_GATE_CODE,
  reason: "perfil incompleto",
  missing: ["identity.full_name"],
  onboarding_complete: false
});

test("a valid but non-pairable inbox combination schedules independently", () => {
  const { store, cleanup } = freshStore();
  try {
    // Both are choices the interface openly offers.
    store.updateSchedule("dm", { mode: "auto", schedule_kind: "interval", interval_minutes: 20 });
    store.updateSchedule("network", { mode: "manual" });

    const scheduler = new Scheduler(store, { tickMs: 0, profileGate: openGate });
    scheduler.refreshInboxPair(at(2026, 8, 5, 10, 0));

    const dm = store.getSchedule("dm");
    const network = store.getSchedule("network");
    assert.ok(dm.next_run_at, "dm por intervalo deve ter proxima execucao");
    assert.equal(network.next_run_at, null, "pipeline manual nao agenda");
    // Not being able to pair is not a misconfiguration.
    assert.equal(dm.last_status, null);
    assert.equal(network.last_status, null);
  } finally {
    cleanup();
  }
});

test("a genuinely impossible schedule still reports an error", () => {
  const { store, cleanup } = freshStore();
  try {
    store.updateSchedule("jobs", {
      mode: "auto", schedule_kind: "cron", cron: "0 3 * * *", window_start: "08:00", window_end: "22:00"
    });
    const scheduler = new Scheduler(store, { tickMs: 0, profileGate: openGate });
    scheduler.refreshNextRun("jobs", at(2026, 8, 5, 10, 0));

    const jobs = store.getSchedule("jobs");
    assert.equal(jobs.next_run_at, null);
    assert.match(jobs.last_status, /schedule_error/);
  } finally {
    cleanup();
  }
});

test("a disabled pipeline is never queued automatically nor manually", () => {
  const { store, cleanup } = freshStore();
  try {
    store.updateSchedule("jobs", { mode: "off" });
    const scheduler = new Scheduler(store, { tickMs: 0, profileGate: openGate });

    // Refusals do not spawn anything, which is what makes them safe to assert here.
    assert.equal(scheduler.enqueue("jobs", "auto"), null);
    assert.equal(scheduler.enqueue("jobs", "manual"), null);

    store.updateSchedule("jobs", { mode: "manual" });
    assert.equal(scheduler.enqueue("jobs", "auto"), null, "modo manual nao roda no automatico");
    assert.equal(store.runningRun("jobs"), null);
  } finally {
    cleanup();
  }
});

test("a stale schedule error is cleared once the schedule resolves again", () => {
  const { store, cleanup } = freshStore();
  try {
    const scheduler = new Scheduler(store, { tickMs: 0, profileGate: openGate });

    // Impossible: 03:00 never falls inside an 08:00-22:00 window.
    store.updateSchedule("jobs", { mode: "auto", schedule_kind: "cron", cron: "0 3 * * *", window_start: "08:00", window_end: "22:00" });
    scheduler.refreshNextRun("jobs", at(2026, 8, 5, 10, 0));
    assert.match(store.getSchedule("jobs").last_status, /schedule_error/);

    store.updateSchedule("jobs", { cron: "0 9 * * *" });
    scheduler.refreshNextRun("jobs", at(2026, 8, 5, 10, 0));

    const jobs = store.getSchedule("jobs");
    assert.ok(jobs.next_run_at);
    assert.equal(jobs.last_status, null, "o erro antigo nao pode ficar preso");
  } finally {
    cleanup();
  }
});

test("global pause moves an automatic next run to the first allowed slot", () => {
  const { store, cleanup } = freshStore();
  try {
    store.updateSchedule("jobs", {
      mode: "auto",
      schedule_kind: "daily_times",
      daily_times: ["03:00", "09:00"],
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      window_start: "",
      window_end: ""
    });
    const config = {
      timezone: "America/Sao_Paulo",
      pause: { enabled: true, start: "22:00", end: "08:00", allow_manual_runs: true }
    };
    const scheduler = new Scheduler(store, { tickMs: 0, getConfig: () => config, profileGate: openGate });
    scheduler.refreshNextRun("jobs", new Date("2026-08-05T05:00:00Z"));
    assert.equal(store.getSchedule("jobs").next_run_at, "2026-08-05T12:00:00.000Z");
  } finally {
    cleanup();
  }
});

test("manual queueing obeys the pause preference before creating a run", () => {
  const { store, cleanup } = freshStore();
  try {
    store.updateSchedule("jobs", { mode: "manual" });
    const config = {
      timezone: "America/Sao_Paulo",
      pause: { enabled: true, start: "00:00", end: "23:59", allow_manual_runs: false }
    };
    const scheduler = new Scheduler(store, { tickMs: 0, getConfig: () => config, profileGate: openGate });
    assert.throws(() => scheduler.enqueue("jobs", "force"), (error) => error.code === "pause_active");
    assert.equal(store.runningRun("jobs"), null);
  } finally {
    cleanup();
  }
});

/* Profile gate: an unfilled profile disarms every pipeline. */

test("an incomplete profile parks automatic schedules and refuses every trigger", async () => {
  const { store, cleanup } = freshStore();
  try {
    store.updateSchedule("jobs", { mode: "auto", schedule_kind: "interval", interval_minutes: 20 });
    const scheduler = new Scheduler(store, { tickMs: 0, profileGate: closedGate });

    scheduler.refreshAllNextRuns(at(2026, 8, 5, 10, 0));
    const parked = store.getSchedule("jobs");
    assert.equal(parked.next_run_at, null, "nao pode anunciar proxima execucao");
    assert.equal(parked.last_status, `blocked: ${PROFILE_GATE_CODE}`);

    // The automatic trigger declines silently; explicit ones say why.
    assert.equal(scheduler.enqueue("jobs", "auto"), null);
    assert.throws(() => scheduler.enqueue("jobs", "force"), (error) => error.code === PROFILE_GATE_CODE);
    assert.throws(
      () => scheduler.enqueueCommand("jobs", "jobs:apply-one", ["job-1"], "manual"),
      (error) => error.code === PROFILE_GATE_CODE
    );

    // A tick must not queue or spawn anything either.
    await scheduler.tick();
    assert.equal(store.runningRun("jobs"), null);
    assert.equal(scheduler.status().queued.length, 0);
  } finally {
    cleanup();
  }
});

test("completing the profile re-arms the schedule that was parked", () => {
  const { store, cleanup } = freshStore();
  try {
    store.updateSchedule("jobs", { mode: "auto", schedule_kind: "interval", interval_minutes: 20 });

    let ready = false;
    const scheduler = new Scheduler(store, { tickMs: 0, profileGate: () => (ready ? openGate() : closedGate()) });

    scheduler.refreshNextRun("jobs", at(2026, 8, 5, 10, 0));
    assert.equal(store.getSchedule("jobs").next_run_at, null);

    ready = true;
    scheduler.refreshNextRun("jobs", at(2026, 8, 5, 10, 0));

    const armed = store.getSchedule("jobs");
    assert.ok(armed.next_run_at, "a proxima execucao volta assim que o perfil fica completo");
    assert.equal(armed.last_status, null, "o bloqueio antigo nao pode ficar preso");
  } finally {
    cleanup();
  }
});
