/**
 * A queue that runs at most N tasks at once.
 *
 * Résumé indexing is fire-and-forget: the upload responds immediately and the
 * model call happens afterwards. Without a limit, dropping ten files in means
 * ten Node subprocesses and ten concurrent provider calls — which is how a
 * rotation of two keys hits a rate limit that neither key would have hit alone,
 * on a machine that is also running a browser.
 *
 * Nobody is waiting on these, so the queue trades wall-clock time for staying
 * within limits.
 */

const DEFAULT_LIMIT = 2;

export function createTaskQueue({ limit = DEFAULT_LIMIT, onError = null } = {}) {
  const max = Math.max(1, Number(limit) || DEFAULT_LIMIT);
  const waiting = [];
  let active = 0;

  function pump() {
    while (active < max && waiting.length) {
      const { task, resolve, reject } = waiting.shift();
      active += 1;

      // The slot is released *before* the caller's promise settles. Settling
      // first lets an awaiting caller observe a count that has not been
      // decremented yet, which makes `stats()` read one task too busy.
      const release = () => {
        active -= 1;
        pump();
      };

      Promise.resolve()
        .then(task)
        .then(
          (value) => { release(); resolve(value); },
          (error) => {
            release();
            // A rejected task must not stall the queue, whether or not anyone
            // attached a handler to the promise it returned.
            try { onError?.(error); } catch {}
            reject(error);
          }
        );
    }
  }

  return {
    /** Queues a task and resolves with its result. */
    run(task) {
      return new Promise((resolve, reject) => {
        waiting.push({ task, resolve, reject });
        pump();
      });
    },
    /** What the queue is doing right now, for status and for tests. */
    stats() {
      return { active, waiting: waiting.length, limit: max };
    }
  };
}
