import * as React from "react";
import { ExternalLink, Loader2, Search, Send, ShieldAlert } from "lucide-react";
import { api, type AgentRecord, type RecordKind, type SendState } from "@/lib/api";
import type { PageProps } from "@/lib/page";
import { usePolling } from "@/hooks/usePolling";
import {
  SEND_STATE_VARIANTS,
  decisionLabel,
  sendStateLabel,
  formatDateTime,
  isSendable,
  scoreTone,
  sendDisabledReason
} from "@/lib/format";
import { localizedError, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { RecordDetailDialog } from "@/components/RecordDetailDialog";

export function JobsPage({ status }: PageProps) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const kindOptions: { value: RecordKind | "all"; label: string }[] = [
    { value: "job", label: t("jobs.jobs") }, { value: "dm", label: t("jobs.messages") },
    { value: "invite", label: t("jobs.invites") }, { value: "all", label: t("common.all") }
  ];
  const stateOptions: { value: SendState | "all"; label: string }[] = [
    { value: "all", label: t("jobs.allStates") },
    ...(["available", "sent_auto", "sent_manual", "blocked", "unsupported", "failed", "in_progress"] as SendState[])
      .map((value) => ({ value, label: sendStateLabel(value, t) }))
  ];
  const [kind, setKind] = React.useState<RecordKind | "all">("job");
  const [sendState, setSendState] = React.useState<SendState | "all">("all");
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [sending, setSending] = React.useState<Set<string>>(new Set());
  const [detail, setDetail] = React.useState<AgentRecord | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const records = usePolling(
    () => api.listRecords({ kind, send_state: sendState, q: debouncedQuery, limit: 300 }),
    6000,
    [kind, sendState, debouncedQuery]
  );

  const items = records.data?.items ?? [];
  const counts = records.data?.counts ?? {};

  async function handleSend(record: AgentRecord) {
    setSending((current) => new Set(current).add(record.record_id));
    try {
      await api.sendRecord(record.record_id);
      toast({
        title: t("jobs.queuedToast"),
        description: t("jobs.queuedDescription", { title: record.title }),
        variant: "success"
      });
      await records.refresh();
    } catch (error) {
      toast({ title: t("jobs.sendError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setSending((current) => {
        const next = new Set(current);
        next.delete(record.record_id);
        return next;
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label={t("dashboard.ready")} value={counts.available ?? 0} tone="primary" />
        <SummaryTile label={t("jobs.sent")} value={(counts.sent_auto ?? 0) + (counts.sent_manual ?? 0)} tone="success" />
        <SummaryTile label={t("jobs.blockedAgent")} value={counts.blocked ?? 0} tone="muted" />
        <SummaryTile label={t("jobs.noAutomatic")} value={counts.unsupported ?? 0} tone="muted" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("jobs.searchPlaceholder")}
                className="pl-9"
              />
            </div>

            <Select value={kind} onValueChange={(value) => setKind(value as RecordKind | "all")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kindOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sendState} onValueChange={(value) => setSendState(value as SendState | "all")}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stateOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="ml-auto text-xs text-muted-foreground">
              {records.data ? t("jobs.count", { shown: items.length, total: records.data.total }) : t("app.loading")}
            </span>
          </div>

          {records.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {records.error}
            </p>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-64">{t("jobs.item")}</TableHead>
                <TableHead className="w-20">{t("jobs.score")}</TableHead>
                <TableHead className="w-28">{t("jobs.decision")}</TableHead>
                <TableHead className="min-w-44">{t("jobs.state")}</TableHead>
                <TableHead className="w-32">{t("jobs.analyzed")}</TableHead>
                <TableHead className="w-36 text-right">{t("jobs.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && !records.loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-14 text-center text-sm text-muted-foreground">
                    {t("jobs.empty")}
                  </TableCell>
                </TableRow>
              ) : null}

              {items.map((record) => {
                const disabledReason = sendDisabledReason(record, t, locale);
                const busy = sending.has(record.record_id) || record.send_state === "in_progress";
                return (
                  <TableRow key={record.record_id} className="group">
                    <TableCell>
                      <button
                        onClick={() => setDetail(record)}
                        className="text-left transition-colors hover:text-primary"
                      >
                        <span className="line-clamp-1 font-medium">{record.title}</span>
                      </button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {record.subtitle ? <span className="line-clamp-1">{record.subtitle}</span> : null}
                        {record.location ? <span className="line-clamp-1">· {record.location}</span> : null}
                        {record.variant ? <Badge variant="outline">{record.variant}</Badge> : null}
                        {record.risk_flags.slice(0, 2).map((flag) => (
                          <Badge key={flag} variant="warning" className="gap-1">
                            <ShieldAlert className="size-3" />
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>

                    <TableCell>
                      <span className={cn("font-mono text-sm font-semibold tabular-nums", scoreTone(record.score))}>
                        {record.score ?? "—"}
                      </span>
                      {record.confidence !== null ? (
                        <span className="ml-1 text-xs text-muted-foreground">/{record.confidence}%</span>
                      ) : null}
                    </TableCell>

                    <TableCell>
                      <span className="text-sm">{decisionLabel(record.decision, t)}</span>
                    </TableCell>

                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-block">
                            <Badge variant={SEND_STATE_VARIANTS[record.send_state]}>
                              {sendStateLabel(record.send_state, t)}
                            </Badge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{disabledReason ?? t("jobs.sendPossible")}</TooltipContent>
                      </Tooltip>
                    </TableCell>

                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(record.analyzed_at, locale, status?.timezone)}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {record.url ? (
                          <Button asChild variant="ghost" size="icon" title={t("jobs.openLinkedIn")}>
                            <a href={record.url} target="_blank" rel="noreferrer noopener">
                              <ExternalLink />
                            </a>
                          </Button>
                        ) : null}

                        {record.kind === "job" ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-block">
                                <Button
                                  size="sm"
                                  disabled={!isSendable(record) || busy}
                                  onClick={() => handleSend(record)}
                                >
                                  {busy ? <Loader2 className="animate-spin" /> : <Send />}
                                  {t("jobs.send")}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {busy ? t("jobs.sendInProgress") : (disabledReason ?? t("jobs.sendEasyApply"))}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge variant="outline">{record.send_method}</Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {t("jobs.footer")}
        {status?.scheduler.running ? t("jobs.pipelineQueueNote") : ""}
      </p>

      <RecordDetailDialog record={detail} onOpenChange={(open) => !open && setDetail(null)} />
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: "primary" | "success" | "muted" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <p
          className={cn(
            "mt-1 font-mono text-2xl font-semibold tabular-nums",
            tone === "primary" && "text-primary",
            tone === "success" && "text-success"
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
