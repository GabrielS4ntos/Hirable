import { ExternalLink } from "lucide-react";
import type { AgentRecord } from "@/lib/api";
import { SEND_STATE_VARIANTS, decisionLabel, formatFullDateTime, sendDisabledReason, sendStateLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

/** Read-only inspector showing exactly what the agent decided and why. */
export function RecordDetailDialog({
  record,
  onOpenChange
}: {
  record: AgentRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useI18n();
  if (!record) return null;
  const reason = sendDisabledReason(record, t, locale);

  return (
    <Dialog open={Boolean(record)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{record.title}</DialogTitle>
          <DialogDescription>
            {[record.subtitle, record.location].filter(Boolean).join(" · ") || record.pipeline}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Badge variant={SEND_STATE_VARIANTS[record.send_state]}>{sendStateLabel(record.send_state, t)}</Badge>
          <Badge variant="outline">decisão: {decisionLabel(record.decision, t)}</Badge>
          <Badge variant="outline">pipeline: {record.pipeline}</Badge>
          <Badge variant="outline">método: {record.send_method}</Badge>
          {record.variant ? <Badge variant="outline">currículo: {record.variant}</Badge> : null}
          {record.risk_flags.map((flag) => (
            <Badge key={flag} variant="warning">
              {flag}
            </Badge>
          ))}
        </div>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Field label="Score heurístico" value={record.score === null ? "—" : String(record.score)} />
          <Field label="Confiança do modelo" value={record.confidence === null ? "—" : `${record.confidence}%`} />
          <Field label="Origem" value={record.source || "—"} />
          <Field label="ID externo" value={record.external_id} mono />
          <Field label="Analisada em" value={formatFullDateTime(record.analyzed_at, locale)} />
          <Field label="Enviada em" value={record.sent_at ? `${formatFullDateTime(record.sent_at, locale)} (${record.sent_by})` : "—"} />
        </dl>

        {reason ? (
          <>
            <Separator />
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Estado do envio</p>
              <p className="mt-1 text-sm">{reason}</p>
            </div>
          </>
        ) : null}

        {record.reason ? (
          <>
            <Separator />
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Justificativa do agente</p>
              <p className="mt-1 text-sm leading-relaxed">{record.reason}</p>
            </div>
          </>
        ) : null}

        {record.send_error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {record.send_error}
          </p>
        ) : null}

        <Separator />
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground">
            Payload bruto do agente
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {JSON.stringify(record.raw, null, 2)}
          </pre>
        </details>

        {record.url ? (
          <Button asChild variant="outline" className="justify-self-start">
            <a href={record.url} target="_blank" rel="noreferrer noopener">
              <ExternalLink />
              Abrir no LinkedIn
            </a>
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>{value}</dd>
    </div>
  );
}
