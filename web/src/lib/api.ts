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

export type ProfilePayload = {
  resume_text: string;
  profile: Record<string, any>;
  onboarding_complete: boolean;
  onboarding_completed_at: string | null;
  updated_at: string | null;
  completeness: { complete: boolean; missing: string[] };
  declared_demographics: DeclaredDemographics;
  sections: ProfileSection[];
};

export type StatusPayload = {
  now: string;
  timezone: string;
  onboarding: { complete: boolean };
  scheduler: {
    running: { pipeline: string; run_id: string; started_at: string } | null;
    queued: { pipeline: string; run_id: string; trigger: string }[];
    active: boolean;
  };
  schedules: PipelineSchedule[];
  counts: Record<RecordKind, Record<string, number>>;
  keys: { gemini: number; openrouter: number };
  model_gate: Record<string, string | null>;
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
  updated_at: string | null;
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
  type: "string" | "int" | "boolean" | "searches" | "known_answers" | "string_map";
  min?: number;
  max?: number;
  value: any;
};

export type ConfigPayload = {
  fields: ConfigField[];
  legacy_config_file: boolean;
  imported_at: string | null;
};

export class ApiError extends Error {
  status: number;
  /** Seconds to wait, parsed from a 429 response. */
  retryAfter: number | null;

  constructor(message: string, status: number, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
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
    throw new ApiError(body.error || `Erro ${response.status}`, response.status, Number.isFinite(seconds) ? seconds : null);
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
  extractProfile: (resumeText: string) =>
    request<{
      profile: Record<string, any>;
      warnings: string[];
      declared_demographics: DeclaredDemographics;
      completeness: { complete: boolean; missing: string[] };
    }>("/api/profile/extract", { method: "POST", body: JSON.stringify({ resume_text: resumeText }) }),
  resetOnboarding: () => request<{ onboarding_complete: boolean }>("/api/profile/reset-onboarding", { method: "POST" }),

  listKeys: () => request<{ items: ApiKey[] }>("/api/keys"),
  createKey: (input: { provider: string; label: string; secret: string; enabled?: boolean }) =>
    request<{ items: ApiKey[] }>("/api/keys", { method: "POST", body: JSON.stringify(input) }),
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

  getConfig: () => request<ConfigPayload>("/api/config"),
  saveConfig: (values: Record<string, any>) =>
    request<{ applied: string[]; rejected: { path: string; error: string }[]; fields: ConfigField[] }>("/api/config", {
      method: "PUT",
      body: JSON.stringify({ values })
    }),

  listPipelines: () => request<{ items: PipelineSchedule[] }>("/api/pipelines"),
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
