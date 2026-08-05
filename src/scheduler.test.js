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
