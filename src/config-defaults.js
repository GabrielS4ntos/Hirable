/**
 * Configuration defaults, in code.
 *
 * A fresh install must work with no files to edit: these defaults boot the app,
 * and everything the user is meant to change is stored in SQLite and edited in
 * the web console.
 *
 * Three tiers:
 *  - BOOTSTRAP  paths needed before the database can be opened; env-overridable.
 *  - SAFETY     guard rails that must NOT be editable at runtime (see below).
 *  - DEFAULTS   everything else; the user's values live in the database.
 */

/**
 * Guard rails. Deliberately not part of the editable surface: these decide what
 * the agent refuses to answer on the user's behalf. If they were rows the web
 * interface could write, any bug in the API — or a prompt injection that reached
 * a write path — could silently widen what the automation is willing to disclose.
 * Changing them requires editing this file, which shows up in a diff.
 */
export const SAFETY = Object.freeze({
  external_content_is_untrusted: true,
  never_use_private_apis: true,
  stop_on_captcha: true,
  stop_on_checkpoint: true,
  stop_on_logout: true,
  // Both languages, deliberately. The list decides what the agent refuses to
  // answer on the user's behalf, and it was English-only: on a Portuguese
  // LinkedIn — which is what most users of this project see — "pretensão
  // salarial", "visto de trabalho", "aviso prévio" and "data de nascimento"
  // walked straight past it. A guard rail that only holds in one language is
  // not a guard rail.
  blocked_question_patterns: Object.freeze([
    // Work authorisation
    "visa",
    "sponsorship",
    "work authorization",
    "authorized to work",
    "security clearance",
    "government clearance",
    "visto",
    "patroc[ií]nio",
    "autoriza[cç][aã]o de trabalho",
    "permiss[aã]o de trabalho",
    // Availability
    "start date",
    "notice period",
    "data de in[ií]cio",
    "aviso pr[ée]vio",
    "disponibilidade para in[ií]cio",
    // Money
    "salary",
    "compensation",
    "sal[aá]rio",
    "pretens[aã]o",
    "remunera[cç][aã]o",
    // Demographics
    "\\brace\\b",
    "ethnicity",
    "gender",
    "disability",
    "veteran",
    "ra[cç]a",
    "etnia",
    "g[eê]nero",
    "identidade de g[eê]nero",
    "orienta[cç][aã]o sexual",
    "defici[eê]ncia",
    "\\bpcd\\b",
    "veterano",
    // Age
    "date of birth",
    "birth date",
    "\\bage\\b",
    "data de nascimento",
    "\\bidade\\b",
    // Records and identifiers
    "criminal",
    "government id",
    "national id",
    "passport",
    "identity document",
    "social security",
    "antecedentes",
    "ficha criminal",
    "\\bcpf\\b",
    "\\brg\\b",
    "documento de identidade",
    "carteira de trabalho"
  ])
});

/** Hard ceilings a user preference may lower but never raise. */
export const HARD_LIMITS = Object.freeze({
  max_easy_apply_per_run: 5,
  max_easy_apply_per_day: 30,
  max_easy_apply_per_week: 60,
  max_accepts_per_run: 100,
  max_threads_to_scan: 50,
  max_searches_per_run: 10,
  max_jobs_per_search: 50
});

export const DEFAULTS = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
  pause: {
    enabled: true,
    start: "22:00",
    end: "08:00",
    allow_manual_runs: true
  },

  storage: {
    database_path: "./data/semantic-memory.sqlite"
  },

  browser: {
    user_data_dir: "./.browser-profile",
    // Empty uses the Chromium bundled with Playwright; "chrome"/"msedge" use the
    // browser already installed on the machine, with this same profile directory.
    channel: "",
    headless: true,
    slow_mo_ms: 0,
    navigation_timeout_ms: 45000
  },

  linkedin: {
    messaging_url: "https://www.linkedin.com/messaging/",
    network_url: "https://www.linkedin.com/mynetwork/grow/",
    jobs_url: "https://www.linkedin.com/jobs/",
    login_url_pattern: "linkedin.com/login|checkpoint|uas/login"
  },

  orchestrator: {
    lock_file: "./.run.lock",
    lock_ttl_ms: 900000,
    log_retention: { max_file_bytes: 5242880, keep_last_lines: 2000 },
    single_browser_context: true,
    max_tabs: 1
  },

  alerts: {
    title: "LinkedIn automation error"
  },

  gmail: {
    redirect_port: 45819,
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar.events"
    ]
  },

  calendar: {
    default_duration_minutes: 30,
    reminder_minutes: 30,
    allowed_hours: [
      { start: "10:00", end: "12:00" },
      { start: "13:00", end: "18:00" }
    ],
    never_schedule_same_day: true
  },

  dm_watcher: {
    read_only: false,
    max_threads_to_scan: 20,
    open_changed_threads: true,
    compact_text_limit: 240,
    new_message_triggers_agent: true,
    candidate_mode: "range_inbound",
    history_days: 15,
    max_history_messages: 30
  },

  network_invites: {
    enabled: true,
    max_accepts_per_run: 50,
    accept_without_message: true
  },

  jobs_watcher: {
    enabled: true,
    read_only: false,
    external_enabled: true,
    easy_apply_enabled: true,
    max_jobs_per_search: 25,
    max_searches_per_run: 3,
    max_scrolls_per_search: 12,
    stop_after_stale_scrolls: 3,
    max_minutes_per_search: 4,
    history_days: 1,
    max_easy_apply_per_run: 2,
    max_easy_apply_per_day: 20,
    max_easy_apply_per_week: 30,
    ai_form_filler_enabled: true,
    max_ai_form_fill_attempts: 3,
    max_easy_apply_steps: 12,
    max_hot_alerts_per_run: 12,
    max_interview_processes_per_week: 8,
    semantic_memory: {
      enabled: true,
      database_path: "./data/semantic-memory.sqlite",
      embedding_model: "gemini-embedding-001",
      output_dimensions: 768,
      top_k: 3,
      auto_apply_similarity: 0.92,
      model_hint_similarity: 0.82,
      minimum_score_margin: 0.05,
      max_input_chars: 500,
      max_candidates_per_field: 3
    },
    selection_thresholds: {
      default_min_score: 70,
      auto_apply_min_score: 86,
      raise_threshold_when_matches_exceed: 25,
      raised_auto_apply_min_score: 92
    },
    resume_display_names: {},
    known_answers: [],
    searches: []
  },

  model_gate: {
    enabled: true,
    provider: "gemini",
    writer_model: "gemini-3.5-flash-lite",
    validator_model: "gemini-3.5-flash-lite",
    job_model: "gemini-3.5-flash-lite",
    fallback_provider: "openrouter",
    openrouter_model: "google/gemini-3.5-flash-lite",
    max_output_tokens: 600,
    profile_extractor_max_output_tokens: 8000
  }
};

/**
 * Paths the web interface is allowed to write, with the validation each accepts.
 * Anything not listed here cannot be changed through the API, no matter what the
 * request body contains.
 */
export const EDITABLE = [
  { path: "timezone", type: "string", label: "Fuso horário" },

  { path: "pause.enabled", type: "boolean", label: "Ativar pausa global" },
  { path: "pause.start", type: "clock", label: "Início da pausa" },
  { path: "pause.end", type: "clock", label: "Fim da pausa" },
  { path: "pause.allow_manual_runs", type: "boolean", label: "Permitir execução manual durante a pausa" },

  { path: "browser.headless", type: "boolean", label: "Navegador em segundo plano" },
  { path: "browser.channel", type: "enum", options: ["", "chrome", "msedge"], label: "Navegador usado" },
  { path: "browser.slow_mo_ms", type: "int", min: 0, max: 5000, label: "Atraso entre ações (ms)" },
  { path: "browser.navigation_timeout_ms", type: "int", min: 5000, max: 180000, label: "Timeout de navegação (ms)" },

  { path: "dm_watcher.read_only", type: "boolean", label: "Somente leitura (não responde DMs)" },
  { path: "dm_watcher.max_threads_to_scan", type: "int", min: 1, max: HARD_LIMITS.max_threads_to_scan, label: "Conversas por execução" },
  { path: "dm_watcher.history_days", type: "int", min: 1, max: 90, label: "Dias de histórico" },

  { path: "network_invites.enabled", type: "boolean", label: "Aceitar convites" },
  { path: "network_invites.max_accepts_per_run", type: "int", min: 1, max: HARD_LIMITS.max_accepts_per_run, label: "Convites por execução" },

  { path: "jobs_watcher.enabled", type: "boolean", label: "Pipeline de vagas ativo" },
  { path: "jobs_watcher.read_only", type: "boolean", label: "Somente leitura (não se candidata)" },
  { path: "jobs_watcher.easy_apply_enabled", type: "boolean", label: "Easy Apply automático" },
  { path: "jobs_watcher.ai_form_filler_enabled", type: "boolean", label: "Preenchimento de formulário por IA" },
  { path: "jobs_watcher.max_easy_apply_per_run", type: "int", min: 0, max: HARD_LIMITS.max_easy_apply_per_run, label: "Candidaturas por execução" },
  { path: "jobs_watcher.max_easy_apply_per_day", type: "int", min: 0, max: HARD_LIMITS.max_easy_apply_per_day, label: "Candidaturas por dia" },
  { path: "jobs_watcher.max_easy_apply_per_week", type: "int", min: 0, max: HARD_LIMITS.max_easy_apply_per_week, label: "Candidaturas por semana" },
  { path: "jobs_watcher.max_jobs_per_search", type: "int", min: 1, max: HARD_LIMITS.max_jobs_per_search, label: "Vagas por busca" },
  { path: "jobs_watcher.max_searches_per_run", type: "int", min: 1, max: HARD_LIMITS.max_searches_per_run, label: "Buscas por execução" },
  { path: "jobs_watcher.selection_thresholds.default_min_score", type: "int", min: 0, max: 100, label: "Score mínimo" },
  { path: "jobs_watcher.selection_thresholds.auto_apply_min_score", type: "int", min: 0, max: 100, label: "Score mínimo para candidatura automática" },
  { path: "jobs_watcher.searches", type: "searches", label: "Buscas de vagas" },
  { path: "jobs_watcher.known_answers", type: "known_answers", label: "Respostas conhecidas" },
  { path: "jobs_watcher.resume_display_names", type: "string_map", label: "Nomes dos currículos" },

  { path: "model_gate.writer_model", type: "string", label: "Modelo de redação" },
  { path: "model_gate.validator_model", type: "string", label: "Modelo validador" },
  { path: "model_gate.job_model", type: "string", label: "Modelo de avaliação de vagas" },
  { path: "model_gate.openrouter_model", type: "string", label: "Modelo do OpenRouter" },
  { path: "model_gate.max_output_tokens", type: "int", min: 100, max: 8000, label: "Tokens de saída" },

  { path: "calendar.default_duration_minutes", type: "int", min: 5, max: 480, label: "Duração do evento (min)" },
  { path: "calendar.reminder_minutes", type: "int", min: 0, max: 1440, label: "Lembrete (min antes)" },
  { path: "calendar.never_schedule_same_day", type: "boolean", label: "Nunca agendar no mesmo dia" }
];

export const EDITABLE_BY_PATH = new Map(EDITABLE.map((item) => [item.path, item]));

export function getPath(target, dottedPath) {
  return dottedPath.split(".").reduce((node, key) => (node == null ? undefined : node[key]), target);
}

export function setPath(target, dottedPath, value) {
  const keys = dottedPath.split(".");
  const last = keys.pop();
  let node = target;
  for (const key of keys) {
    if (node[key] == null || typeof node[key] !== "object") node[key] = {};
    node = node[key];
  }
  node[last] = value;
  return target;
}

/** Validates and coerces one editable value; throws with a user-facing message. */
export function coerceEditable(path, value) {
  const field = EDITABLE_BY_PATH.get(path);
  if (!field) throw new Error(`configuração não editável: ${path}`);

  switch (field.type) {
    case "boolean":
      return Boolean(value);

    case "int": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(`${field.label}: valor numérico inválido`);
      const rounded = Math.round(parsed);
      if (rounded < field.min || rounded > field.max) {
        throw new Error(`${field.label}: use um valor entre ${field.min} e ${field.max}`);
      }
      return rounded;
    }

    case "string": {
      const text = String(value ?? "").trim().slice(0, 200);
      if (!text) throw new Error(`${field.label}: não pode ficar vazio`);
      if (path === "timezone") {
        try {
          new Intl.DateTimeFormat("en", { timeZone: text }).format(new Date());
        } catch {
          throw new Error(`${field.label}: fuso IANA inválido`);
        }
      }
      return text;
    }

    case "enum": {
      const text = String(value ?? "").trim();
      // This value selects an executable, so only the listed options are accepted.
      if (!field.options.includes(text)) {
        throw new Error(`${field.label}: escolha uma das opções disponíveis`);
      }
      return text;
    }

    case "clock": {
      const text = String(value ?? "").trim();
      const match = /^(\d{2}):(\d{2})$/.exec(text);
      if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
        throw new Error(`${field.label}: use HH:MM`);
      }
      return text;
    }

    case "searches": {
      if (!Array.isArray(value)) throw new Error(`${field.label}: envie uma lista`);
      return value.slice(0, HARD_LIMITS.max_searches_per_run * 3).map((item, index) => {
        const name = String(item?.name ?? "").trim().slice(0, 80) || `busca_${index + 1}`;
        const url = String(item?.url ?? "").trim();
        // Only LinkedIn job searches: this URL is navigated to by the browser.
        if (!/^https:\/\/(www\.)?linkedin\.com\/jobs\//i.test(url)) {
          throw new Error(`${field.label}: "${name}" precisa de uma URL de busca de vagas do LinkedIn`);
        }
        return { name, url: url.slice(0, 2000) };
      });
    }

    case "known_answers": {
      if (!Array.isArray(value)) throw new Error(`${field.label}: envie uma lista`);
      return value.slice(0, 200).map((item) => {
        const pattern = String(item?.pattern ?? "").trim().slice(0, 300);
        const answer = String(item?.value ?? "").trim().slice(0, 300);
        if (!pattern || !answer) throw new Error(`${field.label}: padrão e valor são obrigatórios`);
        try {
          new RegExp(pattern, "i");
        } catch {
          throw new Error(`${field.label}: expressão regular inválida em "${pattern}"`);
        }
        return { pattern, value: answer };
      });
    }

    case "string_map": {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field.label}: envie um objeto`);
      const map = {};
      for (const [key, item] of Object.entries(value).slice(0, 50)) {
        const cleanKey = String(key).trim().slice(0, 80);
        const cleanValue = String(item ?? "").trim().slice(0, 300);
        if (cleanKey && cleanValue) map[cleanKey] = cleanValue;
      }
      return map;
    }

    default:
      throw new Error(`tipo de configuração desconhecido: ${field.type}`);
  }
}
