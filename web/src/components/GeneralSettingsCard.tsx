import * as React from "react";
import { Loader2, Plus, Save, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { api, type ConfigField } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { configFieldLabel, localizedError, useI18n, type Translate } from "@/lib/i18n";

/** Groups, so a flat list of 30 knobs reads as a settings screen. */
const GROUPS: { prefix: string; labelKey: Parameters<Translate>[0]; descriptionKey?: Parameters<Translate>[0] }[] = [
  { prefix: "pause", labelKey: "pause.group", descriptionKey: "pause.groupDescription" },
  { prefix: "jobs_watcher.searches", labelKey: "settings.searches", descriptionKey: "settings.searchesDescription" },
  { prefix: "jobs_watcher", labelKey: "settings.jobs" },
  { prefix: "dm_watcher", labelKey: "settings.dms" },
  { prefix: "network_invites", labelKey: "settings.invites" },
  { prefix: "model_gate", labelKey: "settings.models" },
  { prefix: "calendar", labelKey: "settings.calendar" },
  { prefix: "browser", labelKey: "settings.browser" },
  { prefix: "timezone", labelKey: "settings.general" }
];

function groupOf(path: string) {
  return GROUPS.find((group) => path === group.prefix || path.startsWith(`${group.prefix}.`)) ?? GROUPS[GROUPS.length - 1];
}

/**
 * Every setting the interface may change, rendered from the server's own list.
 * A field that is not in that list cannot be edited here — or through the API.
 */
export function GeneralSettingsCard() {
  const toast = useToast();
  const { t, locale } = useI18n();
  const config = usePolling(api.getConfig, 0);
  const [draft, setDraft] = React.useState<Record<string, any>>({});
  const [saving, setSaving] = React.useState(false);

  const fields = config.data?.fields ?? [];
  const dirtyPaths = Object.keys(draft);

  const valueOf = (field: ConfigField) => (field.path in draft ? draft[field.path] : field.value);
  const update = (path: string, value: any) => setDraft((current) => ({ ...current, [path]: value }));

  async function save() {
    setSaving(true);
    try {
      const result = await api.saveConfig(draft);
      config.setData({ ...config.data!, fields: result.fields });
      setDraft({});
      if (result.rejected.length) {
        toast({
          title: t("settings.partial", { applied: result.applied.length, rejected: result.rejected.length }),
          description: result.rejected.map((item) => locale === "pt-BR" ? item.error : item.path).join(" · "),
          variant: "error"
        });
      } else {
        toast({ title: t("settings.saved"), description: t("settings.savedDescription"), variant: "success" });
      }
    } catch (error) {
      toast({ title: t("settings.saveError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  const grouped = GROUPS.map((group) => ({
    group,
    fields: fields.filter((field) => groupOf(field.path) === group)
  })).filter((entry) => entry.fields.length);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" />
            {t("settings.pipelineBehavior")}
          </CardTitle>
          <CardDescription>
            {t("settings.pipelineBehaviorDescription")}
          </CardDescription>
        </div>
        <Button size="sm" onClick={save} disabled={!dirtyPaths.length || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {t("common.save")} {dirtyPaths.length ? `(${dirtyPaths.length})` : ""}
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        {config.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {config.error}
          </p>
        ) : null}

        {grouped.map(({ group, fields: groupFields }, index) => (
          <section key={group.prefix} className="space-y-3">
            {index > 0 ? <Separator /> : null}
            <div>
              <h4 className="text-sm font-semibold">{t(group.labelKey)}</h4>
              {group.descriptionKey ? <p className="text-xs text-muted-foreground">{t(group.descriptionKey)}</p> : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {groupFields.map((field) => {
                const wide = field.type === "searches" || field.type === "known_answers" || field.type === "string_map";
                return (
                  <div key={field.path} className={cn("space-y-1.5", wide && "sm:col-span-2")}>
                    <Label htmlFor={field.path} className="flex items-center gap-2">
                      {configFieldLabel(field.path, field.label, locale)}
                      {field.path in draft ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                    </Label>
                    <ConfigControl field={field} value={valueOf(field)} onChange={(next) => update(field.path, next)} t={t} locale={locale} />
                    {field.type === "int" ? (
                      <p className="text-xs text-muted-foreground">
                        {t("settings.range", { min: field.min ?? "", max: field.max ?? "" })}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {fields.some((field) => field.path === "pause.enabled") ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {Boolean(valueOf(fields.find((field) => field.path === "pause.enabled")!))
              ? t(Boolean(valueOf(fields.find((field) => field.path === "pause.allow_manual_runs")!)) ? "pause.summaryAllowed" : "pause.summaryBlocked", {
                  start: String(valueOf(fields.find((field) => field.path === "pause.start")!)),
                  end: String(valueOf(fields.find((field) => field.path === "pause.end")!))
                })
              : t("pause.summaryDisabled")}
          </p>
        ) : null}

      </CardContent>
    </Card>
  );
}

function ConfigControl({
  field,
  value,
  onChange,
  t,
  locale
}: {
  field: ConfigField;
  value: any;
  onChange: (value: any) => void;
  t: Translate;
  locale: "pt-BR" | "en";
}) {
  switch (field.type) {
    case "boolean":
      return (
        <div className="flex h-9 items-center">
          <Switch checked={Boolean(value)} onCheckedChange={onChange} aria-label={configFieldLabel(field.path, field.label, locale)} />
        </div>
      );

    case "int":
      return (
        <Input
          id={field.path}
          type="number"
          min={field.min}
          max={field.max}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
        />
      );

    case "clock":
      return <Input id={field.path} type="time" value={value ?? ""} onChange={(event) => onChange(event.target.value)} />;

    case "searches":
      return <SearchesControl value={Array.isArray(value) ? value : []} onChange={onChange} t={t} />;

    case "known_answers":
      return <KnownAnswersControl value={Array.isArray(value) ? value : []} onChange={onChange} t={t} />;

    case "string_map":
      return <StringMapControl value={value || {}} onChange={onChange} t={t} />;

    default:
      return <Input id={field.path} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />;
  }
}

function SearchesControl({
  value,
  onChange,
  t
}: {
  value: { name: string; url: string }[];
  onChange: (value: { name: string; url: string }[]) => void;
  t: Translate;
}) {
  const update = (index: number, patch: Partial<{ name: string; url: string }>) =>
    onChange(value.map((item, position) => (position === index ? { ...item, ...patch } : item)));

  return (
    <div className="space-y-2">
      {value.map((item, index) => (
        <div key={index} className="flex flex-wrap items-start gap-2 rounded-md border border-border p-2">
          <Input
            value={item.name}
            onChange={(event) => update(index, { name: event.target.value })}
            placeholder="nome_da_busca"
            className="max-w-56 font-mono text-xs"
          />
          <Input
            value={item.url}
            onChange={(event) => update(index, { url: event.target.value })}
            placeholder="https://www.linkedin.com/jobs/search-results/?keywords=…"
            className="min-w-64 flex-1 font-mono text-xs"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(value.filter((_, position) => position !== index))}
            className="text-muted-foreground hover:text-destructive"
            aria-label={t("settings.removeSearch", { name: item.name })}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...value, { name: "", url: "" }])}>
        <Search />
        {t("settings.addSearch")}
      </Button>
    </div>
  );
}

function KnownAnswersControl({
  value,
  onChange,
  t
}: {
  value: { pattern: string; value: string }[];
  onChange: (value: { pattern: string; value: string }[]) => void;
  t: Translate;
}) {
  const update = (index: number, patch: Partial<{ pattern: string; value: string }>) =>
    onChange(value.map((item, position) => (position === index ? { ...item, ...patch } : item)));

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("settings.knownAnswersHelp")}
      </p>
      {value.map((item, index) => (
        <div key={index} className="flex flex-wrap items-start gap-2">
          <Input
            value={item.pattern}
            onChange={(event) => update(index, { pattern: event.target.value })}
            placeholder={t("settings.labelRegex")}
            className="min-w-56 flex-1 font-mono text-xs"
          />
          <Input
            value={item.value}
            onChange={(event) => update(index, { value: event.target.value })}
            placeholder={t("settings.answer")}
            className="max-w-56"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(value.filter((_, position) => position !== index))}
            className="text-muted-foreground hover:text-destructive"
            aria-label={t("settings.removeAnswer")}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...value, { pattern: "", value: "" }])}>
        <Plus />
        {t("settings.addAnswer")}
      </Button>
    </div>
  );
}

function StringMapControl({
  value,
  onChange,
  t
}: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  t: Translate;
}) {
  const entries = Object.entries(value);
  const [draftKey, setDraftKey] = React.useState("");
  const [draftValue, setDraftValue] = React.useState("");

  return (
    <div className="space-y-2">
      {entries.map(([key, item]) => (
        <div key={key} className="flex items-center gap-2">
          <Input value={key} readOnly className="max-w-48 font-mono text-xs" />
          <Input
            value={item}
            onChange={(event) => onChange({ ...value, [key]: event.target.value })}
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const next = { ...value };
              delete next[key];
              onChange(next);
            }}
            className="text-muted-foreground hover:text-destructive"
            aria-label={`${t("common.remove")} ${key}`}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder={t("settings.key")} className="max-w-48 font-mono text-xs" />
        <Input value={draftValue} onChange={(event) => setDraftValue(event.target.value)} placeholder={t("settings.value")} className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          disabled={!draftKey.trim() || !draftValue.trim()}
          onClick={() => {
            onChange({ ...value, [draftKey.trim()]: draftValue.trim() });
            setDraftKey("");
            setDraftValue("");
          }}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}
