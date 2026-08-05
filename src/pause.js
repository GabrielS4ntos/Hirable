import { nextRunForSchedule } from "./cron.js";

const formatterCache = new Map();

export function normalizePauseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

export function validateTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: String(timeZone) }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function formatterFor(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }));
  }
  return formatterCache.get(timeZone);
}

export function zonedDateParts(date, timeZone) {
  const parts = Object.fromEntries(
    formatterFor(timeZone).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function clockToMinutes(value) {
  const normalized = normalizePauseClock(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

export function validatePauseConfig(pause) {
  const enabled = Boolean(pause?.enabled);
  const start = normalizePauseClock(pause?.start);
  const end = normalizePauseClock(pause?.end);
  if (!start || !end) return { valid: false, code: "pause_time_invalid" };
  if (enabled && start === end) return { valid: false, code: "pause_interval_empty" };
  return {
    valid: true,
    value: { enabled, start, end, allow_manual_runs: pause?.allow_manual_runs !== false }
  };
}

export function isPausedAt(date, pause, timeZone) {
  if (!pause?.enabled) return false;
  const start = clockToMinutes(pause.start);
  const end = clockToMinutes(pause.end);
  if (start === null || end === null || start === end) return false;
  const local = zonedDateParts(date, timeZone);
  const minutes = local.hour * 60 + local.minute;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

export function nextPauseBoundary(date, pause, timeZone) {
  if (!pause?.enabled) return null;
  const current = isPausedAt(date, pause, timeZone);
  const cursor = new Date(date);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let attempt = 0; attempt < 60 * 49; attempt++) {
    if (isPausedAt(cursor, pause, timeZone) !== current) return cursor.toISOString();
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

function currentPauseState(config, date = new Date()) {
  const pause = validatePauseConfig(config?.pause || {}).value || {
    enabled: false,
    start: "22:00",
    end: "08:00",
    allow_manual_runs: true
  };
  const timeZone = validateTimeZone(config?.timezone) ? config.timezone : "UTC";
  const active = isPausedAt(date, pause, timeZone);
  return {
    ...pause,
    timezone: timeZone,
    active,
    manual_run_allowed_now: !active || pause.allow_manual_runs
  };
}

export function pauseStatus(config, date = new Date()) {
  const state = currentPauseState(config, date);
  return { ...state, next_boundary_at: nextPauseBoundary(date, state, state.timezone) };
}

export function nextRunOutsidePause(schedule, config, from = new Date()) {
  let cursor = new Date(from);
  for (let attempt = 0; attempt < 5000; attempt++) {
    const result = nextRunForSchedule(schedule, cursor);
    if (!result.next_run_at) return result;
    const candidate = new Date(result.next_run_at);
    if (!currentPauseState(config, candidate).active) return result;
    cursor = candidate;
  }
  return { next_run_at: null, error: "pause_excludes_all_schedule_candidates" };
}

export function canStartDuringPause(config, trigger, date = new Date()) {
  const status = currentPauseState(config, date);
  if (!status.active) return { allowed: true, status };
  const manual = trigger !== "auto";
  return { allowed: manual && status.allow_manual_runs, status, code: "pause_active" };
}
