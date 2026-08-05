import type { AgentRecord, SendState } from "./api";
import type { AppLocale, Translate } from "./i18n";

export function formatDateTime(value?: string | null, locale: AppLocale = "pt-BR", timeZone?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {})
  }).format(date);
}

export function formatFullDateTime(value?: string | null, locale: AppLocale = "pt-BR", timeZone?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
    ...(timeZone ? { timeZone } : {})
  }).format(date);
}

export function formatRelative(value?: string | null, locale: AppLocale = "pt-BR") {
  if (!value) return "—";
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return "—";
  const diffSeconds = Math.round((target - Date.now()) / 1000);
  const absolute = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absolute < 60) return formatter.format(diffSeconds, "second");
  if (absolute < 3600) return formatter.format(Math.round(diffSeconds / 60), "minute");
  if (absolute < 86400) return formatter.format(Math.round(diffSeconds / 3600), "hour");
  return formatter.format(Math.round(diffSeconds / 86400), "day");
}

export function formatDuration(ms?: number | null, locale: AppLocale = "pt-BR") {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${new Intl.NumberFormat(locale).format(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${new Intl.NumberFormat(locale).format(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const SEND_STATE_VARIANTS: Record<SendState, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  available: "default",
  failed: "destructive",
  in_progress: "warning",
  sent_auto: "success",
  sent_manual: "success",
  unsupported: "outline",
  blocked: "secondary"
};

export function sendStateLabel(state: SendState, t: Translate) {
  const keys = {
    available: "send.available",
    failed: "send.failed",
    in_progress: "send.inProgress",
    sent_auto: "send.sentAuto",
    sent_manual: "send.sentManual",
    unsupported: "send.unsupported",
    blocked: "send.blocked"
  } as const;
  return t(keys[state]);
}

export function isSendable(record: AgentRecord) {
  return record.send_state === "available" || record.send_state === "failed";
}

export function sendDisabledReason(record: AgentRecord, t: Translate, locale: AppLocale): string | null {
  switch (record.send_state) {
    case "available":
    case "failed":
      return null;
    case "in_progress":
      return t("send.reasonInProgress");
    case "sent_auto":
      return t("send.reasonSentAuto", { date: record.sent_at ? ` ${formatFullDateTime(record.sent_at, locale)}` : "" });
    case "sent_manual":
      return t("send.reasonSentManual", { date: record.sent_at ? ` ${formatFullDateTime(record.sent_at, locale)}` : "" });
    case "unsupported":
      return record.send_blocked_reason || t("send.reasonUnsupported");
    case "blocked":
      return record.send_blocked_reason || t("send.reasonBlocked");
    default:
      return t("send.reasonUnknown");
  }
}

export function scoreTone(score: number | null) {
  if (score === null) return "text-muted-foreground";
  if (score >= 86) return "text-success";
  if (score >= 70) return "text-warning";
  return "text-muted-foreground";
}

export function decisionLabel(decision: string, t: Translate) {
  const keys: Record<string, Parameters<Translate>[0]> = {
    apply: "decision.apply",
    reject: "decision.reject",
    review: "decision.review",
    reply: "decision.reply",
    accept: "decision.accept",
    pending: "decision.pending"
  };
  return keys[decision] ? t(keys[decision]) : decision;
}

export function weekdayLabel(day: number, t: Translate) {
  return t(`weekday.${day}` as Parameters<Translate>[0]);
}
