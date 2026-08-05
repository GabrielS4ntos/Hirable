import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextRunForSchedule } from "./cron.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const CLI_PATH = path.join(ROOT, "src", "cli.js");

const DEFAULT_TICK_MS = 30_000;
const DEFAULT_MAX_RUNTIME_MS = 30 * 60 * 1000;
const INBOX_PIPELINES = new Set(["network", "dm"]);

/**
 * Resolves network/DM as one complete future pair. An orphan DM whose network
 * slot is already in the past is deliberately skipped after boot or downtime.
 */
export function nextInboxPair(networkSchedule, dmSchedule, from = new Date(), offsetMinutes = 5) {
  if (!networkSchedule || !dmSchedule) return { network: null, dm: null, error: "inbox schedules not found" };
  if (networkSchedule.mode !== "auto" || dmSchedule.mode !== "auto") {
    return { network: null, dm: null, error: "network and dm must both be automatic" };
  }
  if (networkSchedule.schedule_kind !== "daily_times" || dmSchedule.schedule_kind !== "daily_times") {
    return { network: null, dm: null, error: "network and dm must use daily_times" };
  }

  let cursor = new Date(from);
  for (let attempt = 0; attempt < 500; attempt++) {
    const networkResult = nextRunForSchedule(networkSchedule, cursor);
    if (!networkResult.next_run_at) return { network: null, dm: null, error: networkResult.error || "no future network slot" };
    const networkAt = new Date(networkResult.next_run_at);
    const expectedDmAt = new Date(networkAt.getTime() + offsetMinutes * 60_000);
    const dmResult = nextRunForSchedule(dmSchedule, networkAt);
    if (!dmResult.next_run_at) return { network: null, dm: null, error: dmResult.error || "no future dm slot" };
    const dmAt = new Date(dmResult.next_run_at);
    if (dmAt.getTime() === expectedDmAt.getTime()) {
      return { network: networkAt.toISOString(), dm: dmAt.toISOString(), error: null };
    }
    cursor = networkAt;
  }
  return { network: null, dm: null, error: "no complete future inbox pair" };
}

/**
 * Runs pipelines according to the schedules stored in SQLite.
 *
 * All pipelines share a single Playwright browser profile, so this scheduler
 * executes at most one pipeline at a time and queues everything else.
 */
export class Scheduler {
  constructor(store, { tickMs = DEFAULT_TICK_MS, maxRuntimeMs = DEFAULT_MAX_RUNTIME_MS, logger = console } = {}) {
    this.store = store;
    this.tickMs = tickMs;
    this.maxRuntimeMs = maxRuntimeMs;
    this.logger = logger;
    this.timer = null;
    this.queue = [];
    this.current = null;
    this.listeners = new Set();
  }

  start() {
    if (this.timer) return;
    this.store.releaseStaleRuns(this.maxRuntimeMs);
    this.store.releaseStuckSends(this.maxRuntimeMs);
    this.refreshAllNextRuns();
    this.timer = setInterval(() => this.tick().catch((error) => this.logger.error("[scheduler] tick failed", error)), this.tickMs);
    this.timer.unref?.();
    this.tick().catch((error) => this.logger.error("[scheduler] first tick failed", error));
    this.logger.log(`[scheduler] ativo, verificando a cada ${Math.round(this.tickMs / 1000)}s`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current?.child) this.current.child.kill("SIGTERM");
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch {}
    }
  }

  /** Recomputes next_run_at for every pipeline (called on boot and after edits). */
  refreshAllNextRuns(from = new Date()) {
    const schedules = this.store.listSchedules();
    if (schedules.some((schedule) => INBOX_PIPELINES.has(schedule.pipeline))) this.refreshInboxPair(from);
    for (const schedule of schedules) {
      if (!INBOX_PIPELINES.has(schedule.pipeline)) this.refreshNextRun(schedule.pipeline, from);
    }
  }

  refreshInboxPair(from = new Date()) {
    const network = this.store.getSchedule("network");
    const dm = this.store.getSchedule("dm");
    const pair = nextInboxPair(network, dm, from);
    const lastStatus = pair.error ? `schedule_error: ${pair.error}` : undefined;
    if (network) this.store.setScheduleRuntime("network", { next_run_at: pair.network, last_status: lastStatus ?? network.last_status });
    if (dm) this.store.setScheduleRuntime("dm", { next_run_at: pair.dm, last_status: lastStatus ?? dm.last_status });
    return pair;
  }

  refreshNextRun(pipeline, from = new Date()) {
    if (INBOX_PIPELINES.has(pipeline)) return this.refreshInboxPair(from)[pipeline];
    const schedule = this.store.getSchedule(pipeline);
    if (!schedule) return null;
    const { next_run_at, error } = nextRunForSchedule(schedule, from);
    this.store.setScheduleRuntime(pipeline, {
      next_run_at,
      last_status: error ? `schedule_error: ${error}` : schedule.last_status
    });
    return next_run_at;
  }

  async tick() {
    const now = new Date();
    for (const schedule of this.store.listSchedules()) {
      if (schedule.mode !== "auto") {
        if (schedule.next_run_at) this.store.setScheduleRuntime(schedule.pipeline, { next_run_at: null });
        continue;
      }
      if (!schedule.next_run_at) {
        this.refreshNextRun(schedule.pipeline);
        continue;
      }
      if (new Date(schedule.next_run_at) > now) continue;
      this.enqueue(schedule.pipeline, "auto");
      // Move the marker forward immediately so a slow run cannot double-fire.
      const nextAfter = nextRunForSchedule({ ...schedule, last_run_at: now.toISOString() }, now);
      this.store.setScheduleRuntime(schedule.pipeline, { next_run_at: nextAfter.next_run_at });
    }
    this.#drain();
  }

  /**
   * Queues a pipeline execution. Returns the queued/running run id, or null when
   * the pipeline is already queued or running.
   */
  enqueue(pipeline, trigger = "manual", { args = [] } = {}) {
    const schedule = this.store.getSchedule(pipeline);
    if (!schedule) throw new Error(`pipeline desconhecido: ${pipeline}`);
    if (trigger === "auto" && schedule.mode !== "auto") return null;
    if (schedule.mode === "off" && trigger !== "force") return null;

    const alreadyQueued = this.queue.some((item) => item.pipeline === pipeline) || this.current?.pipeline === pipeline;
    if (alreadyQueued) return null;

    const runId = this.store.startRun({ pipeline, trigger });
    const jitterMs = trigger === "auto" ? Math.floor(Math.random() * (schedule.jitter_seconds || 0) * 1000) : 0;
    this.queue.push({ pipeline, trigger, runId, command: schedule.command, args, readyAt: Date.now() + jitterMs });
    this.#emit({ type: "queued", pipeline, runId, trigger });
    this.#drain();
    return runId;
  }

  /** Queues an arbitrary CLI command that is not a scheduled pipeline (manual actions). */
  enqueueCommand(pipeline, command, args = [], trigger = "manual") {
    const runId = this.store.startRun({ pipeline, trigger });
    this.queue.push({ pipeline, trigger, runId, command, args, readyAt: Date.now() });
    this.#emit({ type: "queued", pipeline, runId, trigger });
    this.#drain();
    return runId;
  }

  status() {
    return {
      running: this.current ? { pipeline: this.current.pipeline, run_id: this.current.runId, started_at: this.current.startedAt } : null,
      queued: this.queue.map((item) => ({ pipeline: item.pipeline, run_id: item.runId, trigger: item.trigger })),
      active: Boolean(this.timer)
    };
  }

  #drain() {
    if (this.current || this.queue.length === 0) return;
    const nextIndex = this.queue.findIndex((item) => item.readyAt <= Date.now());
    if (nextIndex === -1) {
      const soonest = Math.min(...this.queue.map((item) => item.readyAt));
      const delay = Math.max(250, soonest - Date.now());
      const timer = setTimeout(() => this.#drain(), delay);
      timer.unref?.();
      return;
    }
    const [job] = this.queue.splice(nextIndex, 1);
    this.#execute(job);
  }

  #execute(job) {
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, [CLI_PATH, job.command, ...job.args], {
      cwd: ROOT,
      env: { ...process.env, LINKEDIN_HEADLESS: process.env.LINKEDIN_HEADLESS || "true" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.current = { ...job, child, startedAt };
    this.store.setScheduleRuntime(job.pipeline, { last_run_at: startedAt, last_status: "running" });
    this.#emit({ type: "started", pipeline: job.pipeline, runId: job.runId, trigger: job.trigger });
    this.logger.log(`[scheduler] ${job.pipeline} -> ${job.command} (${job.trigger})`);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-200_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-20_000); });

    const killTimer = setTimeout(() => {
      this.logger.error(`[scheduler] ${job.pipeline} excedeu o tempo maximo, encerrando`);
      child.kill("SIGKILL");
    }, this.maxRuntimeMs);
    killTimer.unref?.();

    const finish = (exitCode, error = null) => {
      clearTimeout(killTimer);
      if (this.current?.runId !== job.runId) return;
      const summary = parseLastJson(stdout);
      const status = error ? "failed" : (exitCode === 0 ? "success" : "failed");
      this.store.finishRun(job.runId, {
        status,
        exit_code: exitCode,
        summary,
        error: error ? error.message : (status === "failed" ? stderr.slice(-2000) || `exit code ${exitCode}` : null)
      });
      this.store.setScheduleRuntime(job.pipeline, {
        last_status: summary?.status ? `${status}: ${summary.status}` : status
      });
      this.current = null;
      this.#emit({ type: "finished", pipeline: job.pipeline, runId: job.runId, status, summary });
      this.#drain();
    };

    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
  }
}

/**
 * The CLI prints a JSON result object as its last output block. This extracts it
 * so run history can show a real summary instead of raw text.
 */
export function parseLastJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const start = trimmed.lastIndexOf("\n{");
  const candidates = [trimmed, start >= 0 ? trimmed.slice(start + 1) : null].filter(Boolean);
  for (const candidate of candidates) {
    const opening = candidate.indexOf("{");
    if (opening === -1) continue;
    try {
      const parsed = JSON.parse(candidate.slice(opening));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return null;
}
