/** Types mirroring the standardized records the pipelines write to SQLite. */

export type SendState =
  | "available"
  | "failed"
  | "in_progress"
  | "sent_auto"
  | "sent_manual"
  | "unsupported"
  | "blocked";

export type RecordKind = "job" | "dm" | "invite";

export type AgentRecord = {
  record_id: string;
  pipeline: string;
  kind: RecordKind;
  external_id: string;
  title: string;
  subtitle: string;
  location: string;
  url: string;
  action_url: string;
  source: string;
  score: number | null;
  decision: string;
  confidence: number | null;
  risk_flags: string[];
  reason: string;
  variant: string;
  status: string;
  send_method: string;
  send_state: SendState;
  send_blocked_reason: string;
  sent_at: string | null;
  sent_by: string | null;
  send_error: string | null;
  analyzed_at: string;
  updated_at: string;
  raw: Record<string, unknown>;
};

export type ScheduleMode = "auto" | "manual" | "off";
export type ScheduleKind = "cron" | "interval" | "daily_times";

export type PipelineSchedule = {
  pipeline: string;
  label: string;
  command: string;
  description: string;
  mode: ScheduleMode;
  schedule_kind: ScheduleKind;
  cron: string;
  interval_minutes: number | null;
  daily_times: string[];
  weekdays: number[];
  window_start: string;
  window_end: string;
  jitter_seconds: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  updated_at: string;
  summary?: string;
  next_run_preview?: string | null;
  schedule_error?: string | null;
};

export type ApiKey = {
  id: string;
  provider: "gemini" | "openrouter";
  label: string;
  masked: string;
  enabled: boolean;
  priority: number;
  use_count: number;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type PipelineRun = {
  id: string;
  pipeline: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  exit_code: number | null;
  summary: Record<string, unknown> | null;
  error: string | null;
};

export type ProfileValue = string | number | boolean | null | string[] | Record<string, any> | Record<string, any>[];

export type ProfileField = {
  key: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "enum"
    | "enum_or_text"
    | "tristate"
    | "string_list"
    | "years_map"
    | "record_list";
  hint?: string;
  required?: boolean;
  options?: string[];
  item_fields?: ProfileField[];
};

export type ProfileSection = {
  key: string;
  label: string;
  description?: string;
  sensitive?: boolean;
  fields: ProfileField[];
};

export type DeclaredDemographics = {
  pcd: string;
  veterano: string;
  genero: string;
  identidade_de_genero: string;
  raca_etnia: string;
  orientacao_sexual: string;
};

/** What the extraction agent last read, so the button knows when to re-enable. */
export type LastExtraction = {
  source: "text" | "file";
  hash: string;
  resume_id: string | null;
  at: string;
};

export type ProfilePayload = {
  resume_text: string;
  profile: Record<string, any>;
  last_extraction: LastExtraction | null;
  onboarding_complete: boolean;
  onboarding_completed_at: string | null;
  updated_at: string | null;
  completeness: { complete: boolean; missing: string[] };
  declared_demographics: DeclaredDemographics;
  sections: ProfileSection[];
};

/** Pipelines stay disarmed until the profile the agents rely on is filled in. */
export type ProfileGate = {
  ready: boolean;
  code: string | null;
  reason: string | null;
  missing: string[];
  onboarding_complete: boolean;
};

/** Easy Apply and the job digest both need a stored résumé to send. */
export type ResumeGate = {
  ready: boolean;
  code: string | null;
  reason: string | null;
  count: number;
};

export type StatusPayload = {
  now: string;
  timezone: string;
  onboarding: { complete: boolean };
  profile_gate: ProfileGate;
  resume_gate: ResumeGate;
  scheduler: {
    running: { pipeline: string; run_id: string; started_at: string } | null;
    queued: { pipeline: string; run_id: string; trigger: string }[];
    active: boolean;
  };
  schedules: PipelineSchedule[];
  counts: Record<RecordKind, Record<string, number>>;
  keys: { gemini: number; openrouter: number };
  providers: { id: string; label: string; role: string; model: string; configured: boolean }[];
  model_gate: Record<string, string | null>;
  pause: {
    enabled: boolean;
    start: string;
    end: string;
    allow_manual_runs: boolean;
    active: boolean;
    manual_run_allowed: boolean;
    next_boundary_at: string | null;
  };
};

export type GoogleIntegrationStatus = {
  provider: string;
  client_configured: boolean;
  client_id_hint: string;
  connected: boolean;
  has_refresh_token: boolean;
  scopes: string[];
  account_email: string;
  connected_at: string | null;
  last_error: string | null;
};

export type NotificationSettings = {
  email_enabled: boolean;
  email_to: string;
  email_from: string;
  alert_on_error: boolean;
  macos_notification: boolean;
  job_digest_enabled: boolean;
  calendar_enabled: boolean;
  calendar_id: string;
  /** Silence window for an identical failure. 0 disables deduplication. */
  alert_dedupe_minutes: number;
  auto_fix_enabled: boolean;
  updated_at: string | null;
};

/** A coding-agent CLI that can be handed a failure. Same role model as providers. */
export type CliAgent = {
  id: string;
  label: string;
  command: string;
  args_template: string[];
  docs_url: string;
  install_hint: string;
  role: string;
  enabled: boolean;
  configured: boolean;
  last_status: string;
  last_error: string;
  last_run_at: string | null;
  run_count: number;
};

export type AutoFixState = { ready: boolean; enabled: boolean; reason: string; agent?: string };

export type AlertEvent = {
  fingerprint: string;
  level: string;
  command: string;
  status: string;
  message: string;
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  notified_at: string | null;
  notified_count: number;
  occurrences_since_notify: number;
  auto_fix_at: string | null;
  auto_fix_status: string;
  auto_fix_agent: string;
};

export type IntegrationsPayload = {
  google: GoogleIntegrationStatus;
  notifications: NotificationSettings;
  email_delivery: { ready: boolean; enabled: boolean; reason: string };
  required_scopes: string[];
  redirect_uri: string;
  pending_authorization: { active: boolean; started_at: string | null };
};

export type ConfigField = {
  path: string;
  label: string;
  type: "string" | "clock" | "int" | "boolean" | "searches" | "known_answers" | "string_map";
  min?: number;
  max?: number;
  value: any;
};

export type ConfigPayload = {
  fields: ConfigField[];
  legacy_config_file: boolean;
  imported_at: string | null;
};

export type ResumeDocument = {
  id: string;
  label: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  summary: string;
  headline: string;
  roles: string[];
  technologies: string[];
  seniority: string;
  indexed: boolean;
  indexed_at: string | null;
  index_error: string | null;
  is_default: boolean;
  use_count: number;
};

export type ModelProvider = {
  id: string;
  label: string;
  docs_url: string;
  key_hint: string;
  supports_multiple_keys: boolean;
  models: string[];
  default_model: string;
  model: string;
  role: "primary" | "fallback" | "none";
  key_count: number;
  active_key_count: number;
  configured: boolean;
};

export class ApiError extends Error {
  status: number;
  code: string;
  params: Record<string, string | number>;
  /** Seconds to wait, parsed from a 429 response. */
  retryAfter: number | null;

  constructor(
    message: string,
    status: number,
    retryAfter: number | null = null,
    code = "request_failed",
    params: Record<string, string | number> = {}
  ) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
    this.params = params;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const seconds = Number(/(\d+)s/.exec(body.error || "")?.[1]);
    throw new ApiError(
      body.error || `Erro ${response.status}`,
      response.status,
      Number.isFinite(seconds) ? seconds : null,
      body.code || (response.status === 429 ? "rate_limited" : "request_failed"),
      body.params || {}
    );
  }
  return body as T;
}

export const api = {
  status: () => request<StatusPayload>("/api/status"),

  getProfile: () => request<ProfilePayload>("/api/profile"),
  saveProfile: (input: { profile: Record<string, any>; resume_text?: string; complete_onboarding?: boolean }) =>
    request<Omit<ProfilePayload, "sections" | "onboarding_completed_at" | "updated_at">>("/api/profile", {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  /** Fills the profile from pasted text or from an uploaded file, never both. */
  extractProfile: (source: { resume_text: string } | { resume_id: string }) =>
    request<{
      profile: Record<string, any>;
      resume_text?: string;
      warnings: string[];
      declared_demographics: DeclaredDemographics;
      completeness: { complete: boolean; missing: string[] };
      last_extraction: LastExtraction;
    }>("/api/profile/extract", { method: "POST", body: JSON.stringify(source) }),
  resetOnboarding: () => request<{ onboarding_complete: boolean }>("/api/profile/reset-onboarding", { method: "POST" }),
  completeOnboarding: () =>
    request<{ onboarding_complete: boolean; completeness: { complete: boolean; missing: string[] } }>(
      "/api/profile/complete-onboarding",
      { method: "POST" }
    ),

  listResumes: () => request<{ items: ResumeDocument[] }>("/api/resumes"),
  uploadResume: (input: { filename: string; label?: string; mime_type?: string; content_base64: string }) =>
    request<{ id: string; items: ResumeDocument[]; extraction: { kind: string; extracted: boolean; reason: string } }>(
      "/api/resumes",
      { method: "POST", body: JSON.stringify(input) }
    ),
  updateResume: (id: string, patch: { label?: string; is_default?: boolean }) =>
    request<{ items: ResumeDocument[] }>(`/api/resumes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteResume: (id: string) => request<{ items: ResumeDocument[] }>(`/api/resumes/${id}`, { method: "DELETE" }),
  reindexResume: (id: string) =>
    request<{ items: ResumeDocument[] }>(`/api/resumes/${id}/reindex`, { method: "POST" }),

  listProviders: () => request<{ items: ModelProvider[] }>("/api/providers"),
  updateProvider: (provider: string, patch: { role?: string; model?: string }) =>
    request<{ items: ModelProvider[] }>(`/api/providers/${provider}`, { method: "PUT", body: JSON.stringify(patch) }),

  listKeys: () => request<{ items: ApiKey[] }>("/api/keys"),
  createKey: (input: {
    provider: string;
    label: string;
    secret: string;
    enabled?: boolean;
    model?: string;
    make_primary?: boolean;
  }) => request<{ id: string; items: ApiKey[]; providers: ModelProvider[] }>("/api/keys", {
    method: "POST",
    body: JSON.stringify(input)
  }),
  updateKey: (id: string, patch: Partial<{ label: string; secret: string; enabled: boolean; priority: number }>) =>
    request<{ items: ApiKey[] }>(`/api/keys/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteKey: (id: string) => request<{ items: ApiKey[] }>(`/api/keys/${id}`, { method: "DELETE" }),

  getIntegrations: () => request<IntegrationsPayload>("/api/integrations"),
  saveGoogleClient: (clientJson: string) =>
    request<{ google: GoogleIntegrationStatus }>("/api/integrations/google/client", {
      method: "POST",
      body: JSON.stringify({ client_json: clientJson })
    }),
  connectGoogle: () =>
    request<{ auth_url: string; redirect_uri: string; expires_in_seconds: number }>("/api/integrations/google/connect", {
      method: "POST"
    }),
  disconnectGoogle: () =>
    request<{ google: GoogleIntegrationStatus }>("/api/integrations/google/disconnect", { method: "POST" }),
  testGoogleEmail: (to?: string) =>
    request<{ status: string; to: string }>("/api/integrations/google/test-email", {
      method: "POST",
      body: JSON.stringify({ to })
    }),
  saveNotifications: (patch: Partial<NotificationSettings>) =>
    request<{ notifications: NotificationSettings; refused: string[]; email_delivery: { ready: boolean; enabled: boolean; reason: string } }>(
      "/api/integrations/notifications",
      { method: "PUT", body: JSON.stringify(patch) }
    ),

  listCliAgents: () => request<{ items: CliAgent[]; auto_fix: AutoFixState }>("/api/cli-agents"),
  saveCliAgent: (
    agent: string,
    patch: { command?: string; args_template?: string | string[]; enabled?: boolean; make_primary?: boolean; role?: string }
  ) =>
    request<{ items: CliAgent[]; auto_fix: AutoFixState }>(`/api/cli-agents/${agent}`, {
      method: "PUT",
      body: JSON.stringify(patch)
    }),
  probeCliAgent: (agent: string) =>
    request<{ available: boolean; detail: string }>(`/api/cli-agents/${agent}/probe`, { method: "POST" }),

  listAlerts: (limit = 50) =>
    request<{ items: AlertEvent[]; dedupe_minutes: number }>(`/api/alerts?limit=${limit}`),

  getConfig: () => request<ConfigPayload>("/api/config"),
  saveConfig: (values: Record<string, any>) =>
    request<{ applied: string[]; rejected: { path: string; error: string }[]; fields: ConfigField[] }>("/api/config", {
      method: "PUT",
      body: JSON.stringify({ values })
    }),

  listPipelines: () =>
    request<{ items: PipelineSchedule[]; profile_gate: ProfileGate; resume_gate: ResumeGate }>("/api/pipelines"),
  updatePipeline: (pipeline: string, patch: Partial<PipelineSchedule>) =>
    request<{ item: PipelineSchedule }>(`/api/pipelines/${pipeline}`, { method: "PUT", body: JSON.stringify(patch) }),
  runPipeline: (pipeline: string) => request<{ run_id: string }>(`/api/pipelines/${pipeline}/run`, { method: "POST" }),
  validateCron: (input: { cron: string; weekdays?: number[]; window_start?: string; window_end?: string }) =>
    request<{ valid: boolean; preview: string[] }>("/api/cron/validate", { method: "POST", body: JSON.stringify(input) }),

  listRecords: (params: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "" && value !== "all") query.set(key, String(value));
    }
    return request<{ items: AgentRecord[]; total: number; counts: Record<string, number> }>(`/api/records?${query}`);
  },
  sendRecord: (id: string) => request<{ run_id: string; item: AgentRecord }>(`/api/records/${id}/send`, { method: "POST" }),

  listRuns: (pipeline?: string) =>
    request<{ items: PipelineRun[] }>(`/api/runs${pipeline ? `?pipeline=${pipeline}` : ""}`),

  getSettings: () => request<{ settings: Record<string, unknown>; config: Record<string, any> }>("/api/settings"),
  saveSettings: (patch: Record<string, unknown>) =>
    request<{ settings: Record<string, unknown> }>("/api/settings", { method: "PUT", body: JSON.stringify(patch) })
};
