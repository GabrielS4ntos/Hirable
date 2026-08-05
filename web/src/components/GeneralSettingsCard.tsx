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

/** Groups, so a flat list of 30 knobs reads as a settings screen. */
const GROUPS: { prefix: string; label: string; description?: string }[] = [
  { prefix: "jobs_watcher.searches", label: "Buscas de vagas", description: "As URLs de busca do LinkedIn que o pipeline percorre." },
  { prefix: "jobs_watcher", label: "Vagas e candidaturas" },
  { prefix: "dm_watcher", label: "Mensagens diretas" },
  { prefix: "network_invites", label: "Convites de rede" },
  { prefix: "model_gate", label: "Modelos" },
  { prefix: "calendar", label: "Agenda" },
  { prefix: "browser", label: "Navegador" },
  { prefix: "timezone", label: "Geral" }
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
          title: `${result.applied.length} salvos, ${result.rejected.length} recusados`,
          description: result.rejected.map((item) => item.error).join(" · "),
          variant: "error"
        });
      } else {
        toast({ title: "Configuração salva", description: "Vale para a próxima execução.", variant: "success" });
      }
    } catch (error) {
      toast({ title: "Erro ao salvar", description: (error as Error).message, variant: "error" });
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
            Comportamento dos pipelines
          </CardTitle>
          <CardDescription>
            Tudo o que antes exigia editar <code className="font-mono text-xs">config.json</code>. Os limites máximos e as
            regras de segurança ficam no código e não são editáveis aqui.
          </CardDescription>
        </div>
        <Button size="sm" onClick={save} disabled={!dirtyPaths.length || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Salvar {dirtyPaths.length ? `(${dirtyPaths.length})` : ""}
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
              <h4 className="text-sm font-semibold">{group.label}</h4>
              {group.description ? <p className="text-xs text-muted-foreground">{group.description}</p> : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {groupFields.map((field) => {
                const wide = field.type === "searches" || field.type === "known_answers" || field.type === "string_map";
                return (
                  <div key={field.path} className={cn("space-y-1.5", wide && "sm:col-span-2")}>
                    <Label htmlFor={field.path} className="flex items-center gap-2">
                      {field.label}
                      {field.path in draft ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                    </Label>
                    <ConfigControl field={field} value={valueOf(field)} onChange={(next) => update(field.path, next)} />
                    {field.type === "int" ? (
                      <p className="text-xs text-muted-foreground">
                        entre {field.min} e {field.max}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {config.data?.legacy_config_file ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Um <code className="font-mono">config.json</code> ainda existe na pasta do projeto. Ele já foi importado
            {config.data.imported_at ? " para o banco" : ""} e agora é opcional — as alterações feitas aqui têm
            prioridade sobre ele.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConfigControl({
  field,
  value,
  onChange
}: {
  field: ConfigField;
  value: any;
  onChange: (value: any) => void;
}) {
  switch (field.type) {
    case "boolean":
      return (
        <div className="flex h-9 items-center">
          <Switch checked={Boolean(value)} onCheckedChange={onChange} aria-label={field.label} />
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

    case "searches":
      return <SearchesControl value={Array.isArray(value) ? value : []} onChange={onChange} />;

    case "known_answers":
      return <KnownAnswersControl value={Array.isArray(value) ? value : []} onChange={onChange} />;

    case "string_map":
      return <StringMapControl value={value || {}} onChange={onChange} />;

    default:
      return <Input id={field.path} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />;
  }
}

function SearchesControl({
  value,
  onChange
}: {
  value: { name: string; url: string }[];
  onChange: (value: { name: string; url: string }[]) => void;
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
            aria-label={`Remover ${item.name}`}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...value, { name: "", url: "" }])}>
        <Search />
        Adicionar busca
      </Button>
    </div>
  );
}

function KnownAnswersControl({
  value,
  onChange
}: {
  value: { pattern: string; value: string }[];
  onChange: (value: { pattern: string; value: string }[]) => void;
}) {
  const update = (index: number, patch: Partial<{ pattern: string; value: string }>) =>
    onChange(value.map((item, position) => (position === index ? { ...item, ...patch } : item)));

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Respostas determinísticas do Easy Apply: o padrão casa com o rótulo do campo, o valor é preenchido.
      </p>
      {value.map((item, index) => (
        <div key={index} className="flex flex-wrap items-start gap-2">
          <Input
            value={item.pattern}
            onChange={(event) => update(index, { pattern: event.target.value })}
            placeholder="regex do rótulo"
            className="min-w-56 flex-1 font-mono text-xs"
          />
          <Input
            value={item.value}
            onChange={(event) => update(index, { value: event.target.value })}
            placeholder="resposta"
            className="max-w-56"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(value.filter((_, position) => position !== index))}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Remover resposta"
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...value, { pattern: "", value: "" }])}>
        <Plus />
        Adicionar resposta
      </Button>
    </div>
  );
}

function StringMapControl({
  value,
  onChange
}: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
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
            aria-label={`Remover ${key}`}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder="chave" className="max-w-48 font-mono text-xs" />
        <Input value={draftValue} onChange={(event) => setDraftValue(event.target.value)} placeholder="valor" className="flex-1" />
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
