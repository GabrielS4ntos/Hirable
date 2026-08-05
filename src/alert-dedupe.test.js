import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppStore } from "./app-store.js";
import { fingerprintAlert, normalizeAlertMessage, shouldNotify } from "./alert-dedupe.js";

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alerts-"));
  const store = new AppStore(path.join(dir, "test.sqlite"));
  return { store, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const at = (iso) => new Date(iso);

test("the same failure about different jobs collapses into one group", () => {
  const first = fingerprintAlert({
    command: "jobs:apply",
    status: "job_model_failed",
    message: "Job model evaluation failed for Senior Dev: 429 quota exceeded at 2026-08-05T10:00:00Z"
  });
  const second = fingerprintAlert({
    command: "jobs:apply",
    status: "job_model_failed",
    message: "Job model evaluation failed for Senior Dev: 431 quota exceeded at 2026-08-05T11:42:13Z"
  });
  assert.equal(first, second);
});

test("genuinely different failures stay separate", () => {
  const quota = fingerprintAlert({ command: "jobs:apply", status: "failed", message: "quota exceeded" });
  const login = fingerprintAlert({ command: "jobs:apply", status: "failed", message: "needs login" });
  const otherCommand = fingerprintAlert({ command: "dm:check", status: "failed", message: "quota exceeded" });
  assert.notEqual(quota, login);
  assert.notEqual(quota, otherCommand);
});

test("only the first stack line identifies the failure", () => {
  const normalized = normalizeAlertMessage("TypeError: x is not a function\n    at foo (/a/b/c.js:10:5)\n    at bar");
  assert.equal(normalized, "typeerror: x is not a function");
});

test("the first occurrence is always delivered", () => {
  assert.equal(shouldNotify(null, 60, at("2026-08-05T10:00:00Z")).notify, true);
});

test("a repeat inside the window is suppressed, and released after it", () => {
  const previous = { notified_at: "2026-08-05T10:00:00Z", occurrences_since_notify: 4 };
  const inside = shouldNotify(previous, 60, at("2026-08-05T10:30:00Z"));
  assert.equal(inside.notify, false);
  assert.equal(inside.retry_after_seconds, 30 * 60);

  const after = shouldNotify(previous, 60, at("2026-08-05T11:00:00Z"));
  assert.equal(after.notify, true);
  assert.equal(after.suppressed, 4, "o total silenciado precisa acompanhar o proximo e-mail");
});

test("a zero window disables deduplication entirely", () => {
  const previous = { notified_at: "2026-08-05T10:00:00Z", occurrences_since_notify: 1 };
  assert.equal(shouldNotify(previous, 0, at("2026-08-05T10:00:01Z")).notify, true);
});

test("a storm of identical errors produces exactly one notification", () => {
  const { store, cleanup } = freshStore();
  try {
    const alert = { level: "error", command: "jobs:scan", status: "failed", message: "boom" };
    const decisions = [];
    for (let minute = 0; minute < 30; minute++) {
      decisions.push(store.recordAlert(alert, {
        windowMinutes: 120,
        now: at(`2026-08-05T10:${String(minute).padStart(2, "0")}:00Z`)
      }));
    }

    assert.equal(decisions.filter((item) => item.notify).length, 1, "so o primeiro alerta vira e-mail");
    assert.equal(decisions.at(-1).occurrences, 30, "as ocorrencias continuam sendo contadas");

    // Past the window, the next one is delivered with the suppressed count.
    const released = store.recordAlert(alert, { windowMinutes: 120, now: at("2026-08-05T12:30:00Z") });
    assert.equal(released.notify, true);
    assert.equal(released.suppressed, 29);

    const [row] = store.listAlerts();
    assert.equal(row.occurrences, 31);
    assert.equal(row.notified_count, 2);
  } finally {
    cleanup();
  }
});

test("two different failures are notified independently", () => {
  const { store, cleanup } = freshStore();
  try {
    const now = at("2026-08-05T10:00:00Z");
    const a = store.recordAlert({ level: "error", command: "jobs:scan", status: "failed", message: "quota" }, { now });
    const b = store.recordAlert({ level: "error", command: "dm:check", status: "failed", message: "login" }, { now });
    assert.equal(a.notify, true);
    assert.equal(b.notify, true);
    assert.notEqual(a.fingerprint, b.fingerprint);
  } finally {
    cleanup();
  }
});

test("a secret inside an error message is redacted before being stored", () => {
  const { store, cleanup } = freshStore();
  try {
    store.recordAlert({
      level: "error",
      command: "jobs:scan",
      status: "failed",
      message: "request failed with key AIzaSyD-1234567890abcdefghijklmno"
    }, { now: at("2026-08-05T10:00:00Z") });

    const [row] = store.listAlerts();
    assert.ok(!row.message.includes("AIzaSyD-1234567890abcdefghijklmno"));
    assert.match(row.message, /AIza\*\*\*/);
  } finally {
    cleanup();
  }
});
