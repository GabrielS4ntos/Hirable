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

export function DashboardPage({ status, refreshStatus }: PageProps) {
  const toast = useToast();
  const runs = usePolling(() => api.listRuns(), 5000);
  const [starting, setStarting] = React.useState<string | null>(null);

  const jobCounts = status?.counts.job ?? {};
  const totalJobs = Object.values(jobCounts).reduce((sum, value) => sum + value, 0);

  async function runNow(pipeline: string) {
    setStarting(pipeline);
    try {
      await api.runPipeline(pipeline);
      toast({ title: "Execução enfileirada", description: pipeline, variant: "success" });
      refreshStatus();
      await runs.refresh();
    } catch (error) {
      toast({ title: "Não foi possível executar", description: (error as Error).message, variant: "error" });
    } finally {
      setStarting(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Vagas analisadas" value={totalJobs} hint="registros padronizados no banco" />
        <MetricCard label="Prontas para envio" value={jobCounts.available ?? 0} tone="primary" hint="aguardando sua decisão" />
        <MetricCard
          label="Candidaturas enviadas"
          value={(jobCounts.sent_auto ?? 0) + (jobCounts.sent_manual ?? 0)}
          tone="success"
          hint={`${jobCounts.sent_auto ?? 0} automáticas · ${jobCounts.sent_manual ?? 0} manuais`}
        />
        <MetricCard
          label="Pipelines automáticos"
          value={status?.schedules.filter((item) => item.mode === "auto").length ?? 0}
          hint={`de ${status?.schedules.length ?? 0} configurados`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {status?.schedules.map((schedule) => (
          <Card key={schedule.pipeline}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                {schedule.label}
                <Badge
                  variant={schedule.mode === "auto" ? "success" : schedule.mode === "off" ? "secondary" : "outline"}
                >
                  {schedule.mode === "auto" ? "automático" : schedule.mode === "off" ? "desativado" : "manual"}
                </Badge>
              </CardTitle>
              <CardDescription className="font-mono text-xs">{schedule.summary}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <CalendarClock className="size-3.5" />
                  Próxima:{" "}
                  <span className="font-mono text-foreground">
                    {schedule.mode === "auto" ? formatRelative(schedule.next_run_at) : "—"}
                  </span>
                </p>
                <p>
                  Última execução: <span className="font-mono">{formatDateTime(schedule.last_run_at)}</span>
                </p>
                {schedule.last_status ? (
                  <p className="line-clamp-1">
                    Status: <span className="font-mono">{schedule.last_status}</span>
                  </p>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={starting === schedule.pipeline || schedule.mode === "off"}
                onClick={() => runNow(schedule.pipeline)}
              >
                {starting === schedule.pipeline ? <Loader2 className="animate-spin" /> : <Play />}
                Executar agora
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Execuções recentes</CardTitle>
          <CardDescription>Histórico gravado pelo scheduler, incluindo envios manuais disparados na tela de vagas.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Pipeline</TableHead>
                <TableHead className="w-24">Origem</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-36">Início</TableHead>
                <TableHead className="w-24">Duração</TableHead>
                <TableHead>Resumo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runs.data?.items ?? []).length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhuma execução registrada ainda.
                  </TableCell>
                </TableRow>
              ) : null}
              {(runs.data?.items ?? []).map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">{run.pipeline}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{run.trigger}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatFullDateTime(run.started_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{formatDuration(run.duration_ms)}</TableCell>
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
