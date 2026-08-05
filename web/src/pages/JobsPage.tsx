import * as React from "react";
import { ExternalLink, Loader2, Search, Send, ShieldAlert } from "lucide-react";
import { api, type AgentRecord, type RecordKind, type SendState } from "@/lib/api";
import type { PageProps } from "@/lib/page";
import { usePolling } from "@/hooks/usePolling";
import {
  DECISION_LABELS,
  SEND_STATE_LABELS,
  SEND_STATE_VARIANTS,
  formatDateTime,
  isSendable,
  scoreTone,
  sendDisabledReason
} from "@/lib/format";
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

const KIND_OPTIONS: { value: RecordKind | "all"; label: string }[] = [
  { value: "job", label: "Vagas" },
  { value: "dm", label: "Mensagens" },
  { value: "invite", label: "Convites" },
  { value: "all", label: "Tudo" }
];

const STATE_OPTIONS: { value: SendState | "all"; label: string }[] = [
  { value: "all", label: "Todos os estados" },
  { value: "available", label: "Pronta para envio" },
  { value: "sent_auto", label: "Enviada (automático)" },
  { value: "sent_manual", label: "Enviada (manual)" },
  { value: "blocked", label: "Bloqueada" },
  { value: "unsupported", label: "Sem envio automático" },
  { value: "failed", label: "Falhou" },
  { value: "in_progress", label: "Enviando" }
];

export function JobsPage({ status }: PageProps) {
  const toast = useToast();
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
        title: "Candidatura enfileirada",
        description: `${record.title} entrou na fila de envio. O navegador abre em segundo plano.`,
        variant: "success"
      });
      await records.refresh();
    } catch (error) {
      toast({ title: "Não foi possível enviar", description: (error as Error).message, variant: "error" });
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
        <SummaryTile label="Prontas para envio" value={counts.available ?? 0} tone="primary" />
        <SummaryTile label="Enviadas" value={(counts.sent_auto ?? 0) + (counts.sent_manual ?? 0)} tone="success" />
        <SummaryTile label="Bloqueadas pelo agente" value={counts.blocked ?? 0} tone="muted" />
        <SummaryTile label="Sem envio automático" value={counts.unsupported ?? 0} tone="muted" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por título, empresa ou local…"
                className="pl-9"
              />
            </div>

            <Select value={kind} onValueChange={(value) => setKind(value as RecordKind | "all")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((option) => (
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
                {STATE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="ml-auto text-xs text-muted-foreground">
              {records.data ? `${items.length} de ${records.data.total}` : "carregando…"}
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
                <TableHead className="min-w-64">Item</TableHead>
                <TableHead className="w-20">Score</TableHead>
                <TableHead className="w-28">Decisão</TableHead>
                <TableHead className="min-w-44">Estado</TableHead>
                <TableHead className="w-32">Analisada</TableHead>
                <TableHead className="w-36 text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && !records.loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-14 text-center text-sm text-muted-foreground">
                    Nenhum registro ainda. Rode o pipeline de vagas no Painel para popular esta tabela.
                  </TableCell>
                </TableRow>
              ) : null}

              {items.map((record) => {
                const disabledReason = sendDisabledReason(record);
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
                      <span className="text-sm">{DECISION_LABELS[record.decision] ?? record.decision}</span>
                    </TableCell>

                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-block">
                            <Badge variant={SEND_STATE_VARIANTS[record.send_state]}>
                              {SEND_STATE_LABELS[record.send_state]}
                            </Badge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{disabledReason ?? "Você pode enviar esta candidatura agora."}</TooltipContent>
                      </Tooltip>
                    </TableCell>

                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(record.analyzed_at)}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {record.url ? (
                          <Button asChild variant="ghost" size="icon" title="Abrir no LinkedIn">
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
                                  Enviar
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {busy ? "Envio em andamento…" : (disabledReason ?? "Enviar candidatura via Easy Apply")}
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
        O botão fica desabilitado quando a vaga já foi enviada (automática ou manualmente), quando não existe
        método de envio automático (sem Easy Apply) ou quando o agente bloqueou o envio. Passe o mouse sobre o
        estado para ver o motivo exato.
        {status?.scheduler.running ? " Um pipeline está em execução: o envio manual entra na fila." : ""}
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
