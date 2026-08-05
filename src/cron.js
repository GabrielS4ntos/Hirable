/**
 * Minimal 5-field cron parser and next-run resolver.
 *
 * Fields: minute hour day-of-month month day-of-week
 * Supported syntax: *, n, a-b, a-b/step, asterisk/step and comma lists.
 * Day-of-week accepts 0-7 where both 0 and 7 mean Sunday.
 *
 * All computations use the local machine timezone, which is the same timezone
 * the CLI pipelines already assume for their work windows.
 */

const FIELD_RANGES = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day_of_month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day_of_week", min: 0, max: 7 }
];

const MONTH_ALIASES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

const DAY_ALIASES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const PRESETS = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *"
};

export class CronError extends Error {}

function resolveAlias(token, fieldIndex) {
  const lower = token.toLowerCase();
  if (fieldIndex === 3 && MONTH_ALIASES[lower] !== undefined) return String(MONTH_ALIASES[lower]);
  if (fieldIndex === 4 && DAY_ALIASES[lower] !== undefined) return String(DAY_ALIASES[lower]);
  return token;
}

function parseField(rawField, fieldIndex) {
  const { name, min, max } = FIELD_RANGES[fieldIndex];
  const values = new Set();

  for (const rawPart of String(rawField).split(",")) {
    const part = rawPart.trim();
    if (!part) throw new CronError(`campo ${name} vazio`);

    const [rangePart, stepPart] = part.split("/");
    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step < 1) throw new CronError(`passo inválido em ${name}: ${part}`);
    }

    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [rawStart, rawEnd] = rangePart.split("-");
      start = Number(resolveAlias(rawStart.trim(), fieldIndex));
      end = Number(resolveAlias(rawEnd.trim(), fieldIndex));
    } else {
      start = Number(resolveAlias(rangePart.trim(), fieldIndex));
      end = stepPart === undefined ? start : max;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new CronError(`valor inválido em ${name}: ${part}`);
    }
    if (start < min || end > max || start > end) {
      throw new CronError(`intervalo fora do limite em ${name} (${min}-${max}): ${part}`);
    }

    for (let value = start; value <= end; value += step) values.add(value);
  }

  if (fieldIndex === 4 && values.has(7)) {
    values.delete(7);
    values.add(0);
  }

  if (values.size === 0) throw new CronError(`campo ${name} não produziu valores`);
  return values;
}

export function parseCron(expression) {
  const raw = String(expression || "").trim().toLowerCase();
  if (!raw) throw new CronError("expressão cron vazia");
  const normalized = PRESETS[raw] || raw;
  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) {
    throw new CronError("a expressão cron precisa ter 5 campos: minuto hora dia mês dia-da-semana");
  }
  const parsed = fields.map((field, index) => parseField(field, index));
  return {
    expression: normalized,
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek: parsed[4],
    // POSIX cron: when both day fields are restricted the match is a union.
    dayOfMonthRestricted: fields[2].trim() !== "*",
    dayOfWeekRestricted: fields[4].trim() !== "*"
  };
}

export function isValidCron(expression) {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(parsed, date) {
  const domMatch = parsed.dayOfMonth.has(date.getDate());
  const dowMatch = parsed.dayOfWeek.has(date.getDay());
  if (parsed.dayOfMonthRestricted && parsed.dayOfWeekRestricted) return domMatch || dowMatch;
  if (parsed.dayOfMonthRestricted) return domMatch;
  if (parsed.dayOfWeekRestricted) return dowMatch;
  return true;
}

/**
 * Next moment strictly after `from` that matches the expression.
 * Returns null when nothing matches within the next 5 years.
 */
export function nextCronRun(expression, from = new Date()) {
  const parsed = typeof expression === "string" ? parseCron(expression) : expression;
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = new Date(from.getTime());
  limit.setFullYear(limit.getFullYear() + 5);

  while (cursor <= limit) {
    if (!parsed.month.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(parsed, cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!parsed.hour.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!parsed.minute.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    return cursor;
  }
  return null;
}

function clockToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function withinWindow(date, windowStart, windowEnd) {
  const start = clockToMinutes(windowStart);
  const end = clockToMinutes(windowEnd);
  if (start === null || end === null) return true;
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (start <= end) return minutes >= start && minutes <= end;
  // Window crossing midnight, e.g. 22:00 -> 06:00
  return minutes >= start || minutes <= end;
}

/**
 * Resolves the next run for any schedule kind stored in `pipeline_schedules`.
 *
 * @param {object} schedule row from AppStore.getSchedule()
 * @param {Date}   from     reference moment
 * @returns {{ next_run_at: string|null, error: string|null }}
 */
export function nextRunForSchedule(schedule, from = new Date()) {
  if (!schedule) return { next_run_at: null, error: "schedule not found" };
  if (schedule.mode !== "auto") return { next_run_at: null, error: null };

  const weekdays = Array.isArray(schedule.weekdays) && schedule.weekdays.length
    ? new Set(schedule.weekdays)
    : new Set([0, 1, 2, 3, 4, 5, 6]);

  const accept = (date) => weekdays.has(date.getDay()) && withinWindow(date, schedule.window_start, schedule.window_end);

  try {
    if (schedule.schedule_kind === "cron") {
      const parsed = parseCron(schedule.cron);
      let cursor = from;
      for (let attempt = 0; attempt < 5000; attempt++) {
        const candidate = nextCronRun(parsed, cursor);
        if (!candidate) return { next_run_at: null, error: "nenhuma execução futura para esta cron" };
        if (accept(candidate)) return { next_run_at: candidate.toISOString(), error: null };
        cursor = candidate;
      }
      return { next_run_at: null, error: "cron nunca coincide com a janela configurada" };
    }

    if (schedule.schedule_kind === "interval") {
      const minutes = Math.max(1, Number(schedule.interval_minutes) || 60);
      const base = schedule.last_run_at ? new Date(schedule.last_run_at) : from;
      let candidate = new Date(base.getTime() + minutes * 60000);
      if (candidate <= from) candidate = new Date(from.getTime() + minutes * 60000);
      for (let attempt = 0; attempt < 20000; attempt++) {
        if (accept(candidate)) return { next_run_at: candidate.toISOString(), error: null };
        candidate = new Date(candidate.getTime() + minutes * 60000);
      }
      return { next_run_at: null, error: "intervalo nunca coincide com a janela configurada" };
    }

    if (schedule.schedule_kind === "daily_times") {
      const times = (schedule.daily_times || []).map(clockToMinutes).filter((value) => value !== null).sort((a, b) => a - b);
      if (!times.length) return { next_run_at: null, error: "nenhum horário diário configurado" };
      for (let dayOffset = 0; dayOffset < 370; dayOffset++) {
        const day = new Date(from.getTime());
        day.setDate(day.getDate() + dayOffset);
        for (const minutes of times) {
          const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
          if (candidate <= from) continue;
          if (accept(candidate)) return { next_run_at: candidate.toISOString(), error: null };
        }
      }
      return { next_run_at: null, error: "horários diários nunca coincidem com a janela" };
    }

    return { next_run_at: null, error: `schedule_kind desconhecido: ${schedule.schedule_kind}` };
  } catch (error) {
    return { next_run_at: null, error: error.message };
  }
}

/** Human readable summary used by the settings screen. */
export function describeSchedule(schedule) {
  if (!schedule) return "";
  if (schedule.mode === "off") return "Desativada";
  if (schedule.mode === "manual") return "Somente manual";
  if (schedule.schedule_kind === "cron") return `cron: ${schedule.cron}`;
  if (schedule.schedule_kind === "interval") return `a cada ${schedule.interval_minutes} min`;
  if (schedule.schedule_kind === "daily_times") return `diário às ${(schedule.daily_times || []).join(", ")}`;
  return "";
}
