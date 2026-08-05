import assert from "node:assert/strict";
import test from "node:test";
import { createTaskQueue } from "./task-queue.js";

const defer = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test("never runs more than the limit at once", async () => {
  const queue = createTaskQueue({ limit: 2 });
  const gates = Array.from({ length: 6 }, defer);
  let running = 0;
  let peak = 0;

  const all = gates.map((gate) =>
    queue.run(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await gate.promise;
      running -= 1;
    })
  );

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(queue.stats().active, 2, "so duas rodam");
  assert.equal(queue.stats().waiting, 4);

  gates.forEach((gate) => gate.resolve());
  await Promise.all(all);
  assert.equal(peak, 2, "o pico nunca passa do limite");
  assert.deepEqual(queue.stats(), { active: 0, waiting: 0, limit: 2 });
});

test("a task that throws does not stall the queue", async () => {
  // The failure this guards: one rejected index leaving every later upload
  // stuck on "analisando" forever.
  const queue = createTaskQueue({ limit: 1 });
  const failed = queue.run(async () => { throw new Error("boom"); });
  await assert.rejects(failed, /boom/);

  const after = await queue.run(async () => "seguiu");
  assert.equal(after, "seguiu");
  assert.equal(queue.stats().active, 0);
});

test("a rejection with no handler attached still drains the queue", async () => {
  const queue = createTaskQueue({ limit: 1, onError: () => {} });
  queue.run(async () => { throw new Error("ignorada"); }).catch(() => {});
  assert.equal(await queue.run(async () => "ok"), "ok");
});

test("onError sees the failure without the queue rethrowing at it", async () => {
  const seen = [];
  const queue = createTaskQueue({ limit: 1, onError: (error) => seen.push(error.message) });
  await queue.run(async () => { throw new Error("registrada"); }).catch(() => {});
  assert.deepEqual(seen, ["registrada"]);
});

test("tasks start in the order they were queued", async () => {
  const queue = createTaskQueue({ limit: 1 });
  const order = [];
  await Promise.all([1, 2, 3].map((n) => queue.run(async () => { order.push(n); })));
  assert.deepEqual(order, [1, 2, 3]);
});

test("a nonsense limit falls back to something that runs", async () => {
  // A limit of 0 would deadlock every upload; anything unusable becomes 1+.
  for (const limit of [0, -3, NaN, undefined]) {
    const queue = createTaskQueue({ limit });
    assert.ok(queue.stats().limit >= 1, String(limit));
    assert.equal(await queue.run(async () => "ok"), "ok");
  }
});
