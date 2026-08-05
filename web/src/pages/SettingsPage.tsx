import * as React from "react";
import { CalendarClock, CheckCircle2, Loader2, Play, Save, TriangleAlert } from "lucide-react";
import { api, type PipelineSchedule, type ScheduleKind, type ScheduleMode } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { WEEKDAY_LABELS, formatDateTime, formatFullDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/toast";
import type { PageProps } from "@/lib/page";
import { GoogleIntegrationCard } from "@/components/GoogleIntegrationCard";

const MODES: { value: ScheduleMode; label: string; hint: string }[] = [
  { value: "auto", label: "Automático", hint: "O scheduler executa sozinho conforme o agendamento." },
  { value: "manual", label: "Manual", hint: "Só executa quando você clicar em Executar agora." },
  { value: "off", label: "Desativada", hint: "Nunca executa, nem manualmente pelo scheduler." }
];

const KINDS: { value: ScheduleKind; label: string }[] = [
  { value: "cron", label: "Expressão cron" },
  { value: "interval", label: "Intervalo fixo" },
  { value: "daily_times", label: "Horários do dia" }
];

const CRON_PRESETS = [
  { label: "A cada 20 min, 8h–22h", value: "*/20 8-22 * * *" },
  { label: "3x por dia útil", value: "7 9,12,16 * * 1-5" },
  { label: "De hora em hora", value: "0 * * * *" },
  { label: "Uma vez ao dia (9h)", value: "0 9 * * *" }
];

export function SettingsPage(_props: PageProps) {
  const pipelines = usePolling(api.listPipelines, 8000);
  const settings = usePolling(api.getSettings, 0);

  return (
    <div className="space-y-6">
      <GoogleIntegrationCard />

      <div className="space-y-4">
        {pipelines.data?.items.map((schedule) => (
          <PipelineCard key={schedule.pipeline} schedule={schedule} onSaved={pipelines.refresh} />
        ))}
        {pipelines.loading && !pipelines.data ? <SkeletonCard /> : null}
        {pipelines.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {pipelines.error}
          </p>
        ) : null}
      </div>

      {settings.data ? (
        <Card>
          <CardHeader>
            <CardTitle>Limites operacionais</CardTitle>
            <CardDescription>
              Definidos em <code className="font-mono text-xs">config.json</code>. Exibidos aqui para referência ao
              montar o agendamento — um cron muito frequente não ultrapassa estes tetos.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Easy Apply por execução" value={settings.data.config.jobs_watcher?.max_easy_apply_per_run} />
            <Stat label="Easy Apply por dia" value={settings.data.config.jobs_watcher?.max_easy_apply_per_day} />
            <Stat label="Easy Apply por semana" value={settings.data.config.jobs_watcher?.max_easy_apply_per_week} />
            <Stat label="Convites por execução" value={settings.data.config.network_invites?.max_accepts_per_run} />
            <Stat label="Conversas por execução" value={settings.data.config.dm_watcher?.max_threads_to_scan} />
            <Stat label="Fuso horário" value={settings.data.config.timezone} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{String(value ?? "—")}</span>
    </div>
  );
}

function SkeletonCard() {
  return <div className="h-56 animate-pulse rounded-xl border border-border bg-card/50" />;
}

function PipelineCard({ schedule, onSaved }: { schedule: PipelineSchedule; onSaved: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = React.useState<PipelineSchedule>(schedule);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [preview, setPreview] = React.useState<{ valid: boolean; preview: string[] } | null>(null);
  const dirty = React.useMemo(() => JSON.stringify(draft) !== JSON.stringify(schedule), [draft, schedule]);

  // Keep in sync with server state unless the user has unsaved edits.
  React.useEffect(() => {
    if (!dirty) setDraft(schedule);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.updated_at, schedule.next_run_at, schedule.last_status]);

  React.useEffect(() => {
    if (draft.mode !== "auto" || draft.schedule_kind !== "cron" || !draft.cron) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .validateCron({
          cron: draft.cron,
          weekdays: draft.weekdays,
          window_start: draft.window_start,
          window_end: draft.window_end
        })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [draft.cron, draft.mode, draft.schedule_kind, draft.weekdays, draft.window_start, draft.window_end]);

  const update = (patch: Partial<PipelineSchedule>) => setDraft((current) => ({ ...current, ...patch }));

  async function save() {
    setSaving(true);
    try {
      await api.updatePipeline(draft.pipeline, {
        mode: draft.mode,
        schedule_kind: draft.schedule_kind,
        cron: draft.cron,
        interval_minutes: draft.interval_minutes,
        daily_times: draft.daily_times,
        weekdays: draft.weekdays,
        window_start: draft.window_start,
        window_end: draft.window_end,
        jitter_seconds: draft.jitter_seconds
      });
      toast({ title: "Agendamento salvo", description: draft.label, variant: "success" });
      onSaved();
    } catch (error) {
      toast({ title: "Erro ao salvar", description: (error as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      await api.runPipeline(draft.pipeline);
      toast({ title: "Execução enfileirada", description: draft.label, variant: "success" });
      onSaved();
    } catch (error) {
      toast({ title: "Não foi possível executar", description: (error as Error).message, variant: "error" });
    } finally {
      setRunning(false);
    }
  }

  const modeHint = MODES.find((item) => item.value === draft.mode)?.hint;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            {schedule.label}
            <Badge variant={schedule.mode === "auto" ? "success" : schedule.mode === "off" ? "secondary" : "outline"}>
              {MODES.find((item) => item.value === schedule.mode)?.label}
            </Badge>
          </CardTitle>
          <CardDescription>{schedule.description}</CardDescription>
          <p className="font-mono text-xs text-muted-foreground">npm run {schedule.command.replace(":", ":")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={runNow} disabled={running || draft.mode === "off"}>
            {running ? <Loader2 className="animate-spin" /> : <Play />}
            Executar agora
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Salvar
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Modo</Label>
            <Select value={draft.mode} onValueChange={(value) => update({ mode: value as ScheduleMode })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{modeHint}</p>
          </div>

          <div className="space-y-1.5">
            <Label>Forma de agendamento</Label>
            <Select
              value={draft.schedule_kind}
              onValueChange={(value) => update({ schedule_kind: value as ScheduleKind })}
              disabled={draft.mode !== "auto"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${draft.pipeline}-start`}>Janela permitida</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`${draft.pipeline}-start`}
                type="time"
                value={draft.window_start}
                onChange={(event) => update({ window_start: event.target.value })}
                disabled={draft.mode !== "auto"}
              />
              <span className="text-muted-foreground">—</span>
              <Input
                type="time"
                value={draft.window_end}
                onChange={(event) => update({ window_end: event.target.value })}
                disabled={draft.mode !== "auto"}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${draft.pipeline}-jitter`}>Jitter (segundos)</Label>
            <Input
              id={`${draft.pipeline}-jitter`}
              type="number"
              min={0}
              max={3600}
              value={draft.jitter_seconds}
              onChange={(event) => update({ jitter_seconds: Number(event.target.value) })}
              disabled={draft.mode !== "auto"}
            />
            <p className="text-xs text-muted-foreground">Atraso aleatório para não parecer robótico.</p>
          </div>
        </div>

        {draft.mode === "auto" ? (
          <>
            <Separator />
            {draft.schedule_kind === "cron" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${draft.pipeline}-cron`}>Expressão cron</Label>
                  <Input
                    id={`${draft.pipeline}-cron`}
                    value={draft.cron}
                    onChange={(event) => update({ cron: event.target.value })}
                    placeholder="minuto hora dia mês dia-da-semana"
                    className={cn(
                      "font-mono",
                      preview && !preview.valid && "border-destructive focus-visible:ring-destructive"
                    )}
                    spellCheck={false}
                  />
                  <p className="font-mono text-xs text-muted-foreground">
                    minuto hora dia mês dia-da-semana · aceita * , - / e @daily
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {CRON_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => update({ cron: preset.value })}
                      className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {preview ? (
                  preview.valid ? (
                    <div className="rounded-md border border-border bg-muted/40 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                        <CheckCircle2 className="size-3.5" />
                        Próximas execuções
                      </p>
                      <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-muted-foreground">
                        {preview.preview.map((item) => (
                          <li key={item}>{formatFullDateTime(item)}</li>
                        ))}
                        {preview.preview.length === 0 ? <li>Nenhuma — a janela bloqueia todos os horários.</li> : null}
                      </ul>
                    </div>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-destructive">
                      <TriangleAlert className="size-3.5" />
                      Expressão cron inválida.
                    </p>
                  )
                ) : null}
              </div>
            ) : null}

            {draft.schedule_kind === "interval" ? (
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor={`${draft.pipeline}-interval`}>Intervalo em minutos</Label>
                <Input
                  id={`${draft.pipeline}-interval`}
                  type="number"
                  min={1}
                  max={1440}
                  value={draft.interval_minutes ?? 60}
                  onChange={(event) => update({ interval_minutes: Number(event.target.value) })}
                />
                <p className="text-xs text-muted-foreground">Contado a partir do fim da última execução.</p>
              </div>
            ) : null}

            {draft.schedule_kind === "daily_times" ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${draft.pipeline}-times`}>Horários (HH:MM, separados por vírgula)</Label>
                <Input
                  id={`${draft.pipeline}-times`}
                  value={draft.daily_times.join(", ")}
                  onChange={(event) =>
                    update({ daily_times: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })
                  }
                  placeholder="09:00, 13:30, 18:00"
                  className="font-mono"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Dias da semana</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_LABELS.map((label, index) => {
                  const active = draft.weekdays.includes(index);
                  return (
                    <button
                      key={label}
                      onClick={() =>
                        update({
                          weekdays: active
                            ? draft.weekdays.filter((day) => day !== index)
                            : [...draft.weekdays, index].sort()
                        })
                      }
                      className={cn(
                        "h-8 w-12 rounded-md border text-xs font-medium transition-colors",
                        active
                          ? "border-primary bg-primary/12 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        <Separator />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5" />
            Próxima:{" "}
            <span className="font-mono text-foreground">
              {schedule.mode === "auto" ? formatFullDateTime(schedule.next_run_at) : "—"}
            </span>
          </span>
          <span>
            Última: <span className="font-mono">{formatDateTime(schedule.last_run_at)}</span>
          </span>
          {schedule.last_status ? (
            <span>
              Status: <span className="font-mono">{schedule.last_status}</span>
            </span>
          ) : null}
          {schedule.schedule_error ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <TriangleAlert className="size-3.5" />
              {schedule.schedule_error}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
