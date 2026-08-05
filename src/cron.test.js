import assert from "node:assert/strict";
import test from "node:test";
import { CronError, describeSchedule, isValidCron, nextCronRun, nextRunForSchedule, parseCron } from "./cron.js";

const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0, 0);

test("parses every-minute expression", () => {
  const parsed = parseCron("* * * * *");
  assert.equal(parsed.minute.size, 60);
  assert.equal(parsed.hour.size, 24);
  assert.equal(parsed.dayOfMonthRestricted, false);
  assert.equal(parsed.dayOfWeekRestricted, false);
});

test("parses steps, ranges and lists", () => {
  const parsed = parseCron("*/15 9-17 * * 1-5");
  assert.deepEqual([...parsed.minute].sort((a, b) => a - b), [0, 15, 30, 45]);
  assert.deepEqual([...parsed.hour].sort((a, b) => a - b), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual([...parsed.dayOfWeek].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test("treats day-of-week 7 as sunday", () => {
  const parsed = parseCron("0 0 * * 7");
  assert.deepEqual([...parsed.dayOfWeek], [0]);
});

test("supports named months and weekdays", () => {
  const parsed = parseCron("0 0 * jan mon");
  assert.deepEqual([...parsed.month], [1]);
  assert.deepEqual([...parsed.dayOfWeek], [1]);
});

test("supports @daily preset", () => {
  assert.equal(parseCron("@daily").expression, "0 0 * * *");
});

test("rejects malformed expressions", () => {
  assert.throws(() => parseCron("* * * *"), CronError);
  assert.throws(() => parseCron("60 * * * *"), CronError);
  assert.throws(() => parseCron("* 25 * * *"), CronError);
  assert.throws(() => parseCron("*/0 * * * *"), CronError);
  assert.throws(() => parseCron("5-1 * * * *"), CronError);
  assert.equal(isValidCron("7 9,12,16 * * 1-5"), true);
  assert.equal(isValidCron("not a cron"), false);
});

test("nextCronRun is strictly after the reference moment", () => {
  const next = nextCronRun("0 * * * *", at(2026, 8, 5, 10, 0));
  assert.equal(next.getHours(), 11);
  assert.equal(next.getMinutes(), 0);
});

test("nextCronRun resolves multi-hour lists", () => {
  const next = nextCronRun("7 9,12,16 * * *", at(2026, 8, 5, 10, 30));
  assert.equal(next.getHours(), 12);
  assert.equal(next.getMinutes(), 7);
});

test("nextCronRun rolls over to the next matching weekday", () => {
  // 2026-08-08 is a Saturday, so a Mon-Fri cron must land on Monday the 10th.
  const next = nextCronRun("0 9 * * 1-5", at(2026, 8, 8, 12, 0));
  assert.equal(next.getDate(), 10);
  assert.equal(next.getDay(), 1);
  assert.equal(next.getHours(), 9);
});

test("nextCronRun handles month rollover", () => {
  const next = nextCronRun("0 0 1 * *", at(2026, 8, 15, 0, 0));
  assert.equal(next.getMonth(), 8); // September (0-indexed)
  assert.equal(next.getDate(), 1);
});

test("day-of-month and day-of-week combine as a union", () => {
  const next = nextCronRun("0 0 13 * 5", at(2026, 8, 5, 0, 0));
  // Friday 2026-08-07 comes before the 13th, so the union picks the Friday.
  assert.equal(next.getDate(), 7);
});

test("nextRunForSchedule returns null when the pipeline is not automatic", () => {
  for (const mode of ["manual", "off"]) {
    const result = nextRunForSchedule({ mode, schedule_kind: "cron", cron: "* * * * *" }, at(2026, 8, 5, 10, 0));
    assert.equal(result.next_run_at, null);
    assert.equal(result.error, null);
  }
});

test("nextRunForSchedule honours the daily window", () => {
  const result = nextRunForSchedule({
    mode: "auto",
    schedule_kind: "cron",
    cron: "0 * * * *",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    window_start: "08:00",
    window_end: "22:00"
  }, at(2026, 8, 5, 23, 30));
  const next = new Date(result.next_run_at);
  assert.equal(result.error, null);
  assert.equal(next.getDate(), 6);
  assert.equal(next.getHours(), 8);
});

test("nextRunForSchedule honours the weekday allowlist", () => {
  const result = nextRunForSchedule({
    mode: "auto",
    schedule_kind: "cron",
    cron: "0 10 * * *",
    weekdays: [1],
    window_start: "",
    window_end: ""
  }, at(2026, 8, 5, 12, 0)); // Wednesday
  const next = new Date(result.next_run_at);
  assert.equal(next.getDay(), 1);
});

test("interval schedules chain from the last run", () => {
  const result = nextRunForSchedule({
    mode: "auto",
    schedule_kind: "interval",
    interval_minutes: 30,
    last_run_at: at(2026, 8, 5, 10, 0).toISOString(),
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    window_start: "",
    window_end: ""
  }, at(2026, 8, 5, 10, 5));
  assert.equal(new Date(result.next_run_at).getHours(), 10);
  assert.equal(new Date(result.next_run_at).getMinutes(), 30);
});

test("interval schedules never return a past moment", () => {
  const result = nextRunForSchedule({
    mode: "auto",
    schedule_kind: "interval",
    interval_minutes: 15,
    last_run_at: at(2026, 8, 1, 10, 0).toISOString(),
    weekdays: [0, 1, 2, 3, 4, 5, 6]
  }, at(2026, 8, 5, 10, 5));
  assert.ok(new Date(result.next_run_at) > at(2026, 8, 5, 10, 5));
});

test("daily_times schedules pick the next configured clock time", () => {
  const result = nextRunForSchedule({
    mode: "auto",
    schedule_kind: "daily_times",
    daily_times: ["09:00", "14:30", "19:15"],
    weekdays: [0, 1, 2, 3, 4, 5, 6]
  }, at(2026, 8, 5, 10, 0));
  const next = new Date(result.next_run_at);
  assert.equal(next.getHours(), 14);
  assert.equal(next.getMinutes(), 30);
});

test("daily_times rolls to the next day after the last slot", () => {
  const result = nextRunForSchedule({
    mode: "auto",
    schedule_kind: "daily_times",
    daily_times: ["09:00"],
    weekdays: [0, 1, 2, 3, 4, 5, 6]
  }, at(2026, 8, 5, 20, 0));
  const next = new Date(result.next_run_at);
  assert.equal(next.getDate(), 6);
  assert.equal(next.getHours(), 9);
});

test("invalid cron surfaces an error instead of throwing", () => {
  const result = nextRunForSchedule({ mode: "auto", schedule_kind: "cron", cron: "nope" }, at(2026, 8, 5, 10, 0));
  assert.equal(result.next_run_at, null);
  assert.match(result.error, /cron/i);
});

test("describeSchedule summarises each kind", () => {
  assert.equal(describeSchedule({ mode: "off" }), "Desativada");
  assert.equal(describeSchedule({ mode: "manual" }), "Somente manual");
  assert.equal(describeSchedule({ mode: "auto", schedule_kind: "cron", cron: "0 9 * * *" }), "cron: 0 9 * * *");
  assert.equal(describeSchedule({ mode: "auto", schedule_kind: "interval", interval_minutes: 45 }), "a cada 45 min");
  assert.equal(
    describeSchedule({ mode: "auto", schedule_kind: "daily_times", daily_times: ["09:00", "18:00"] }),
    "diário às 09:00, 18:00"
  );
});
