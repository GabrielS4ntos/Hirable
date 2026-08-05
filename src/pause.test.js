import assert from "node:assert/strict";
import test from "node:test";
import { canStartDuringPause, isPausedAt, nextPauseBoundary, normalizePauseClock, validatePauseConfig } from "./pause.js";

const instant = (iso) => new Date(iso);
const pause = { enabled: true, start: "22:00", end: "08:00", allow_manual_runs: true };

test("pause clocks are strict and equal enabled bounds are rejected", () => {
  assert.equal(normalizePauseClock("08:05"), "08:05");
  assert.equal(normalizePauseClock("8:05"), null);
  assert.equal(validatePauseConfig({ ...pause, start: "25:00" }).code, "pause_time_invalid");
  assert.equal(validatePauseConfig({ ...pause, start: "08:00", end: "08:00" }).code, "pause_interval_empty");
  assert.equal(validatePauseConfig({ ...pause, enabled: false, start: "08:00", end: "08:00" }).valid, true);
});

test("cross-midnight pause uses a half-open interval in the configured timezone", () => {
  assert.equal(isPausedAt(instant("2026-08-06T00:59:00Z"), pause, "America/Sao_Paulo"), false); // 21:59
  assert.equal(isPausedAt(instant("2026-08-06T01:00:00Z"), pause, "America/Sao_Paulo"), true);  // 22:00
  assert.equal(isPausedAt(instant("2026-08-06T10:59:00Z"), pause, "America/Sao_Paulo"), true);  // 07:59
  assert.equal(isPausedAt(instant("2026-08-06T11:00:00Z"), pause, "America/Sao_Paulo"), false); // 08:00
});

test("same-day pause and disabled pause work", () => {
  const midday = { ...pause, start: "12:00", end: "13:00" };
  assert.equal(isPausedAt(instant("2026-08-05T15:30:00Z"), midday, "America/Sao_Paulo"), true);
  assert.equal(isPausedAt(instant("2026-08-05T16:00:00Z"), midday, "America/Sao_Paulo"), false);
  assert.equal(isPausedAt(instant("2026-08-05T15:30:00Z"), { ...midday, enabled: false }, "America/Sao_Paulo"), false);
});

test("next boundary follows the configured timezone", () => {
  assert.equal(nextPauseBoundary(instant("2026-08-06T00:58:00Z"), pause, "America/Sao_Paulo"), "2026-08-06T01:00:00.000Z");
  assert.equal(nextPauseBoundary(instant("2026-08-06T01:01:00Z"), pause, "America/Sao_Paulo"), "2026-08-06T11:00:00.000Z");
});

test("manual run policy is independent from automatic runs", () => {
  const config = { timezone: "America/Sao_Paulo", pause };
  const atNight = instant("2026-08-06T03:00:00Z");
  assert.equal(canStartDuringPause(config, "auto", atNight).allowed, false);
  assert.equal(canStartDuringPause(config, "force", atNight).allowed, true);
  assert.equal(canStartDuringPause({ ...config, pause: { ...pause, allow_manual_runs: false } }, "force", atNight).allowed, false);
});
