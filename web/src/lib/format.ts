import type { AgentRecord, SendState } from "./api";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const fullDateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium"
});

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

export function formatFullDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : fullDateTime.format(date);
}

export function formatRelative(value?: string | null) {
  if (!value) return "—";
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return "—";
  const diffSeconds = Math.round((target - Date.now()) / 1000);
  const absolute = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (absolute < 60) return formatter.format(diffSeconds, "second");
  if (absolute < 3600) return formatter.format(Math.round(diffSeconds / 60), "minute");
  if (absolute < 86400) return formatter.format(Math.round(diffSeconds / 3600), "hour");
  return formatter.format(Math.round(diffSeconds / 86400), "day");
}

export function formatDuration(ms?: number | null) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const SEND_STATE_LABELS: Record<SendState, string> = {
  available: "Pronta para envio",
  failed: "Falhou",
  in_progress: "Enviando…",
  sent_auto: "Enviada (automático)",
  sent_manual: "Enviada (manual)",
  unsupported: "Sem envio automático",
  blocked: "Bloqueada"
};

export const SEND_STATE_VARIANTS: Record<SendState, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  available: "default",
  failed: "destructive",
  in_progress: "warning",
  sent_auto: "success",
  sent_manual: "success",
  unsupported: "outline",
  blocked: "secondary"
};

export function isSendable(record: AgentRecord) {
  return record.send_state === "available" || record.send_state === "failed";
}

/** Explains, in one sentence, why the Enviar button is disabled. */
export function sendDisabledReason(record: AgentRecord): string | null {
  switch (record.send_state) {
    case "available":
    case "failed":
      return null;
    case "in_progress":
      return "Um envio para esta vaga já está em andamento.";
    case "sent_auto":
      return `Candidatura já enviada pelo processo automático${record.sent_at ? ` em ${formatFullDateTime(record.sent_at)}` : ""}.`;
    case "sent_manual":
      return `Candidatura já enviada manualmente${record.sent_at ? ` em ${formatFullDateTime(record.sent_at)}` : ""}.`;
    case "unsupported":
      return record.send_blocked_reason || "Esta vaga não tem método de envio automático.";
    case "blocked":
      return record.send_blocked_reason || "O agente bloqueou o envio desta vaga.";
    default:
      return "Estado de envio desconhecido.";
  }
}

export function scoreTone(score: number | null) {
  if (score === null) return "text-muted-foreground";
  if (score >= 86) return "text-success";
  if (score >= 70) return "text-warning";
  return "text-muted-foreground";
}

export const DECISION_LABELS: Record<string, string> = {
  apply: "Aplicar",
  reject: "Rejeitada",
  review: "Revisar",
  reply: "Responder",
  accept: "Aceitar",
  pending: "Pendente"
};

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
