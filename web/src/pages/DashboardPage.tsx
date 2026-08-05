import * as React from "react";
import { CalendarClock, Loader2, Play } from "lucide-react";
import { api, type PipelineRun } from "@/lib/api";
import type { PageProps } from "@/lib/page";
import { usePolling } from "@/hooks/usePolling";
import { formatDateTime, formatDuration, formatFullDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { localizedError, pipelineLabel, useI18n } from "@/lib/i18n";
import { ProfileGateBanner } from "@/components/ProfileGateBanner";

export function DashboardPage({ status, refreshStatus }: PageProps) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const runs = usePolling(() => api.listRuns(), 5000);
  const [starting, setStarting] = React.useState<string | null>(null);

  const jobCounts = status?.counts.job ?? {};
  const totalJobs = Object.values(jobCounts).reduce((sum, value) => sum + value, 0);
  const gate = status?.profile_gate ?? null;
  const gateBlocked = Boolean(gate && !gate.ready);

  async function runNow(pipeline: string) {
    setStarting(pipeline);
    try {
      await api.runPipeline(pipeline);
      toast({ title: t("dashboard.queuedToast"), description: pipelineLabel(pipeline, pipeline, locale), variant: "success" });
      refreshStatus();
      await runs.refresh();
    } catch (error) {
      toast({ title: t("dashboard.runError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setStarting(null);
    }
  }

  return (
    <div className="space-y-6">
      <ProfileGateBanner gate={gate} onGoToProfile={() => { window.location.hash = "/perfil"; }} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t("dashboard.jobsAnalyzed")} value={totalJobs} hint={t("dashboard.standardRecords")} />
        <MetricCard label={t("dashboard.ready")} value={jobCounts.available ?? 0} tone="primary" hint={t("dashboard.awaitingDecision")} />
        <MetricCard
          label={t("dashboard.sent")}
          value={(jobCounts.sent_auto ?? 0) + (jobCounts.sent_manual ?? 0)}
          tone="success"
          hint={t("dashboard.sentHint", { auto: jobCounts.sent_auto ?? 0, manual: jobCounts.sent_manual ?? 0 })}
        />
        <MetricCard
          label={t("dashboard.autoPipelines")}
          value={status?.schedules.filter((item) => item.mode === "auto").length ?? 0}
          hint={t("dashboard.configured", { count: status?.schedules.length ?? 0 })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {status?.schedules.map((schedule) => (
          <Card key={schedule.pipeline}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                {pipelineLabel(schedule.pipeline, schedule.label, locale)}
                <Badge
                  variant={schedule.mode === "auto" ? "success" : schedule.mode === "off" ? "secondary" : "outline"}
                >
                  {schedule.mode === "auto" ? t("dashboard.auto") : schedule.mode === "off" ? t("dashboard.off") : t("dashboard.manual")}
                </Badge>
              </CardTitle>
              <CardDescription className="font-mono text-xs">{schedule.summary}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <CalendarClock className="size-3.5" />
                  {t("dashboard.next")}{" "}
                  <span className="font-mono text-foreground">
                    {schedule.mode === "auto" ? formatRelative(schedule.next_run_at, locale) : "—"}
                  </span>
                </p>
                <p>
                  {t("dashboard.lastRun")} <span className="font-mono">{formatDateTime(schedule.last_run_at, locale, status?.timezone)}</span>
                </p>
                {schedule.last_status ? (
                  <p className="line-clamp-1">
                    {t("dashboard.status")} <span className="font-mono">{schedule.last_status}</span>
                  </p>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={starting === schedule.pipeline || schedule.mode === "off" || gateBlocked}
                onClick={() => runNow(schedule.pipeline)}
              >
                {starting === schedule.pipeline ? <Loader2 className="animate-spin" /> : <Play />}
                {t("dashboard.runNow")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.recentRuns")}</CardTitle>
          <CardDescription>{t("dashboard.recentRunsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("dashboard.pipeline")}</TableHead>
                <TableHead className="w-24">{t("dashboard.origin")}</TableHead>
                <TableHead className="w-28">{t("dashboard.status")}</TableHead>
                <TableHead className="w-36">{t("dashboard.start")}</TableHead>
                <TableHead className="w-24">{t("dashboard.duration")}</TableHead>
                <TableHead>{t("dashboard.summary")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runs.data?.items ?? []).length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    {t("dashboard.noRuns")}
                  </TableCell>
                </TableRow>
              ) : null}
              {(runs.data?.items ?? []).map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">{pipelineLabel(run.pipeline, run.pipeline, locale)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{run.trigger}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatFullDateTime(run.started_at, locale, status?.timezone)}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{formatDuration(run.duration_ms, locale)}</TableCell>
                  <TableCell className="max-w-md">
                    <span className="line-clamp-1 font-mono text-xs text-muted-foreground">{summarize(run)}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function statusVariant(status: string) {
  if (status === "success") return "success" as const;
  if (status === "running") return "warning" as const;
  if (status === "failed" || status === "stale") return "destructive" as const;
  return "secondary" as const;
}

function summarize(run: PipelineRun) {
  if (run.error) return run.error.slice(0, 200);
  if (!run.summary) return "—";
  const entries = Object.entries(run.summary)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 6)
    .map(([key, value]) => `${key}=${value}`);
  return entries.join("  ") || "—";
}

function MetricCard({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "primary" | "success";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <p
          className={cn(
            "mt-1 font-mono text-3xl font-semibold tabular-nums",
            tone === "primary" && "text-primary",
            tone === "success" && "text-success"
          )}
        >
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
