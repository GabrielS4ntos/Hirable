import test from "node:test";
import assert from "node:assert/strict";
import { shouldStopScrolling } from "./job-scan-budget.js";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const LIMITS = { staleScrollLimit: 3, budgetMs: 60000, maxScrolls: 12, freshnessDays: 7, now: NOW };

test("keeps scrolling while jobs still qualify", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 4, staleScrolls: 0, oldestPostedAt: "2026-08-05T12:00:00.000Z", elapsedMs: 1000, scrolls: 1 },
    LIMITS
  );
  assert.equal(result.stop, false);
});

test("stops when the cards cross the freshness horizon", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 4, staleScrolls: 0, oldestPostedAt: "2026-07-01T12:00:00.000Z", elapsedMs: 1000, scrolls: 1 },
    LIMITS
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "freshness_horizon");
});

test("stops after enough scrolls without a qualified job", () => {
  // Counting scrolls that produced no *qualified* job, not scrolls that
  // produced no card: a page full of jobs we will never send is still stale.
  const result = shouldStopScrolling(
    { qualifiedCount: 1, staleScrolls: 3, oldestPostedAt: "2026-08-05T12:00:00.000Z", elapsedMs: 1000, scrolls: 5 },
    LIMITS
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "no_qualified_yield");
});

test("stops when the run budget is spent", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 9, staleScrolls: 0, oldestPostedAt: "2026-08-05T12:00:00.000Z", elapsedMs: 60001, scrolls: 2 },
    LIMITS
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "run_budget");
});

test("stops at the scroll ceiling", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 9, staleScrolls: 0, oldestPostedAt: "2026-08-05T12:00:00.000Z", elapsedMs: 100, scrolls: 12 },
    LIMITS
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "max_scrolls");
});

test("an unknown oldest date does not stop the scroll", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 2, staleScrolls: 0, oldestPostedAt: null, elapsedMs: 100, scrolls: 1 },
    LIMITS
  );
  assert.equal(result.stop, false);
});

test("the budget wins over everything else", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 0, staleScrolls: 0, oldestPostedAt: null, elapsedMs: 999999, scrolls: 0 },
    LIMITS
  );
  assert.equal(result.reason, "run_budget");
});

test("a search entered with no budget left stops immediately", () => {
  const result = shouldStopScrolling(
    { qualifiedCount: 0, staleScrolls: 0, oldestPostedAt: null, elapsedMs: 0, scrolls: 0 },
    { ...LIMITS, budgetMs: 0 }
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "run_budget");
});
