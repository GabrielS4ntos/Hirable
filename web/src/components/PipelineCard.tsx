import * as React from "react";
import { CalendarClock, CheckCircle2, Loader2, Play, Save, TriangleAlert } from "lucide-react";
import { api, type PipelineSchedule, type ProfileGate, type ScheduleKind, type ScheduleMode } from "@/lib/api";
import { formatDateTime, formatFullDateTime, weekdayLabel } from "@/lib/format";
import { pipelineLabel, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/toast";

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

/**
 * One pipeline's schedule. Shared by the settings screen and the onboarding
 * step so scheduling looks and behaves the same the first time and every time
 * after.
 */
export function PipelineCard({
  schedule,
  gate,
  onSaved
}: {
  schedule: PipelineSchedule;
  gate: ProfileGate | null;
  onSaved: () => void;
}) {
  // An incomplete profile disarms the pipeline: no automatic mode, no manual run.
  const gateBlocked = Boolean(gate && !gate.ready);
  const toast = useToast();
  const { t, locale } = useI18n();
  const en = locale === "en";
  const modes = en ? [
    { value: "auto" as const, label: "Automatic", hint: "The scheduler runs automatically according to the schedule." },
    { value: "manual" as const, label: "Manual", hint: "Runs only when you click Run now." },
    { value: "off" as const, label: "Disabled", hint: "Never runs, including manually through the scheduler." }
  ] : MODES;
  const kinds = en ? [
    { value: "cron" as const, label: "Cron expression" }, { value: "interval" as const, label: "Fixed interval" }, { value: "daily_times" as const, label: "Times of day" }
  ] : KINDS;
  const presets = en ? [
    { label: "Every 20 min, 8am–10pm", value: "*/20 8-22 * * *" }, { label: "3× per weekday", value: "7 9,12,16 * * 1-5" },
    { label: "Every hour", value: "0 * * * *" }, { label: "Once a day (9am)", value: "0 9 * * *" }
  ] : CRON_PRESETS;
  const c = en ? {
    saved: "Schedule saved", saveError: "Could not save", queued: "Run queued", runError: "Could not run", runNow: "Run now",
    mode: "Mode", scheduleType: "Schedule type", allowedWindow: "Allowed window", jitter: "Jitter (seconds)", jitterHelp: "Random delay to avoid robotic timing.",
    cron: "Cron expression", cronPlaceholder: "minute hour day month weekday", cronHelp: "minute hour day month weekday · accepts * , - / and @daily",
    nextRuns: "Next runs", none: "None — the window blocks every time.", invalidCron: "Invalid cron expression.", interval: "Interval in minutes",
    intervalHelp: "Counted from the end of the previous run.", times: "Times (HH:MM, comma-separated)", weekdays: "Weekdays", next: "Next:", last: "Last:", status: "Status:"
  } : {
    saved: "Agendamento salvo", saveError: "Erro ao salvar", queued: "Execução enfileirada", runError: "Não foi possível executar", runNow: "Executar agora",
    mode: "Modo", scheduleType: "Forma de agendamento", allowedWindow: "Janela permitida", jitter: "Jitter (segundos)", jitterHelp: "Atraso aleatório para não parecer robótico.",
    cron: "Expressão cron", cronPlaceholder: "minuto hora dia mês dia-da-semana", cronHelp: "minuto hora dia mês dia-da-semana · aceita * , - / e @daily",
    nextRuns: "Próximas execuções", none: "Nenhuma — a janela bloqueia todos os horários.", invalidCron: "Expressão cron inválida.", interval: "Intervalo em minutos",
    intervalHelp: "Contado a partir do fim da última execução.", times: "Horários (HH:MM, separados por vírgula)", weekdays: "Dias da semana", next: "Próxima:", last: "Última:", status: "Status:"
  };
  const scheduleLabel = pipelineLabel(schedule.pipeline, schedule.label, locale);
  const scheduleDescription = en ? ({
    network: "Reviews pending network invitations according to the configured policy.",
    dm: "Checks direct messages and prepares or sends replies according to the configured policy.",
    jobs: "Scans current-day jobs and evaluates eligible applications."
  } as Record<string, string>)[schedule.pipeline] ?? schedule.description : schedule.description;
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
      toast({ title: c.saved, description: scheduleLabel, variant: "success" });
      onSaved();
    } catch (error) {
      toast({ title: c.saveError, description: (error as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      await api.runPipeline(draft.pipeline);
      toast({ title: c.queued, description: scheduleLabel, variant: "success" });
      onSaved();
    } catch (error) {
      toast({ title: c.runError, description: (error as Error).message, variant: "error" });
    } finally {
      setRunning(false);
    }
  }

  const modeHint = modes.find((item) => item.value === draft.mode)?.hint;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            {scheduleLabel}
            <Badge variant={schedule.mode === "auto" ? "success" : schedule.mode === "off" ? "secondary" : "outline"}>
              {modes.find((item) => item.value === schedule.mode)?.label}
            </Badge>
          </CardTitle>
          <CardDescription>{scheduleDescription}</CardDescription>
          <p className="font-mono text-xs text-muted-foreground">npm run {schedule.command.replace(":", ":")}</p>
        </div>
        <div className="flex items-center gap-2">
          {gateBlocked ? <Badge variant="default">{t("gate.blockedBadge")}</Badge> : null}
          <Button variant="outline" size="sm" onClick={runNow} disabled={running || draft.mode === "off" || gateBlocked}>
            {running ? <Loader2 className="animate-spin" /> : <Play />}
            {c.runNow}
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving || (gateBlocked && draft.mode === "auto")}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {t("common.save")}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0 space-y-1.5">
            <Label>{c.mode}</Label>
            <Select value={draft.mode} onValueChange={(value) => update({ mode: value as ScheduleMode })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modes.map((item) => (
                  <SelectItem key={item.value} value={item.value} disabled={gateBlocked && item.value === "auto"}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{gateBlocked ? t("error.profile_incomplete") : modeHint}</p>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label>{c.scheduleType}</Label>
            <Select
              value={draft.schedule_kind}
              onValueChange={(value) => update({ schedule_kind: value as ScheduleKind })}
              disabled={draft.mode !== "auto"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`${draft.pipeline}-start`}>{c.allowedWindow}</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id={`${draft.pipeline}-start`}
                type="time"
                value={draft.window_start}
                onChange={(event) => update({ window_start: event.target.value })}
                disabled={draft.mode !== "auto"}
                className="min-w-0 flex-1 px-1.5 font-mono text-xs"
              />
              <span className="shrink-0 text-muted-foreground">—</span>
              <Input
                type="time"
                value={draft.window_end}
                onChange={(event) => update({ window_end: event.target.value })}
                disabled={draft.mode !== "auto"}
                className="min-w-0 flex-1 px-1.5 font-mono text-xs"
              />
            </div>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`${draft.pipeline}-jitter`}>{c.jitter}</Label>
            <Input
              id={`${draft.pipeline}-jitter`}
              type="number"
              min={0}
              max={3600}
              value={draft.jitter_seconds}
              onChange={(event) => update({ jitter_seconds: Number(event.target.value) })}
              disabled={draft.mode !== "auto"}
            />
            <p className="text-xs text-muted-foreground">{c.jitterHelp}</p>
          </div>
        </div>

        {draft.mode === "auto" ? (
          <>
            <Separator />
            {draft.schedule_kind === "cron" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${draft.pipeline}-cron`}>{c.cron}</Label>
                  <Input
                    id={`${draft.pipeline}-cron`}
                    value={draft.cron}
                    onChange={(event) => update({ cron: event.target.value })}
                    placeholder={c.cronPlaceholder}
                    className={cn(
                      "font-mono",
                      preview && !preview.valid && "border-destructive focus-visible:ring-destructive"
                    )}
                    spellCheck={false}
                  />
                  <p className="font-mono text-xs text-muted-foreground">
                    {c.cronHelp}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {presets.map((preset) => (
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
                        {c.nextRuns}
                      </p>
                      <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-muted-foreground">
                        {preview.preview.map((item) => (
                          <li key={item}>{formatFullDateTime(item, locale)}</li>
                        ))}
                        {preview.preview.length === 0 ? <li>{c.none}</li> : null}
                      </ul>
                    </div>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-destructive">
                      <TriangleAlert className="size-3.5" />
                      {c.invalidCron}
                    </p>
                  )
                ) : null}
              </div>
            ) : null}

            {draft.schedule_kind === "interval" ? (
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor={`${draft.pipeline}-interval`}>{c.interval}</Label>
                <Input
                  id={`${draft.pipeline}-interval`}
                  type="number"
                  min={1}
                  max={1440}
                  value={draft.interval_minutes ?? 60}
                  onChange={(event) => update({ interval_minutes: Number(event.target.value) })}
                />
                <p className="text-xs text-muted-foreground">{c.intervalHelp}</p>
              </div>
            ) : null}

            {draft.schedule_kind === "daily_times" ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${draft.pipeline}-times`}>{c.times}</Label>
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
              <Label>{c.weekdays}</Label>
              <div className="flex flex-wrap gap-1.5">
                {[0, 1, 2, 3, 4, 5, 6].map((index: number) => {
                  const label = weekdayLabel(index, t);
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
            {c.next}{" "}
            <span className="font-mono text-foreground">
              {schedule.mode === "auto" ? formatFullDateTime(schedule.next_run_at, locale) : "—"}
            </span>
          </span>
          <span>
            {c.last} <span className="font-mono">{formatDateTime(schedule.last_run_at, locale)}</span>
          </span>
          {schedule.last_status ? (
            <span>
              {c.status} <span className="font-mono">{schedule.last_status}</span>
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
