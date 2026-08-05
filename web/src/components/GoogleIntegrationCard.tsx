import * as React from "react";
import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Link2Off,
  Loader2,
  Mail,
  Plug,
  Send,
  TriangleAlert
} from "lucide-react";
import { ApiError, api, type IntegrationsPayload } from "@/lib/api";
import { useCooldown } from "@/hooks/useCooldown";
import { usePolling } from "@/hooks/usePolling";
import { formatFullDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

const GCP_CREDENTIALS_URL = "https://console.cloud.google.com/apis/credentials";
const GCP_OAUTH_DOCS_URL = "https://developers.google.com/identity/protocols/oauth2/native-app";

const DELIVERY_REASONS: Record<string, string> = {
  client_oauth_nao_configurado: "Cole o JSON do client OAuth para começar.",
  conta_google_nao_conectada: "Conecte uma conta Google.",
  destinatario_nao_definido: "Defina o e-mail que vai receber os alertas.",
  envio_desativado_pelo_usuario: "Tudo pronto — falta ligar o envio.",
  storage_indisponivel: "Banco local indisponível."
};

/**
 * Google integration: OAuth connection, alert delivery and calendar.
 *
 * Email sending stays off until an account is connected AND a recipient is saved
 * AND the user explicitly enables it, so pipelines never email anyone by default.
 */
export function GoogleIntegrationCard() {
  const toast = useToast();
  const integrations = usePolling<IntegrationsPayload>(api.getIntegrations, 0);
  const cooldown = useCooldown();

  const [clientJson, setClientJson] = React.useState("");
  const [emailTo, setEmailTo] = React.useState("");
  const [calendarId, setCalendarId] = React.useState("primary");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [awaitingConsent, setAwaitingConsent] = React.useState(false);

  const data = integrations.data;
  const google = data?.google;
  const settings = data?.notifications;
  const delivery = data?.email_delivery;

  React.useEffect(() => {
    if (!data) return;
    setEmailTo((current) => current || data.notifications.email_to);
    setCalendarId(data.notifications.calendar_id || "primary");
  }, [data]);

  // While the consent tab is open, poll until the token lands in the database.
  React.useEffect(() => {
    if (!awaitingConsent) return;
    const timer = setInterval(async () => {
      const payload = await integrations.refresh();
      if (payload?.google.connected) {
        setAwaitingConsent(false);
        toast({ title: "Conta Google conectada", description: payload.google.account_email, variant: "success" });
      }
    }, 2000);
    const stop = setTimeout(() => setAwaitingConsent(false), 5 * 60 * 1000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingConsent]);

  async function run(key: string, action: () => Promise<unknown>, successTitle?: string) {
    setBusy(key);
    try {
      await action();
      await integrations.refresh();
      if (successTitle) toast({ title: successTitle, variant: "success" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) cooldown.start(error.retryAfter ?? 60);
      toast({ title: "Erro", description: (error as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    setBusy("connect");
    try {
      const { auth_url } = await api.connectGoogle();
      window.open(auth_url, "_blank", "noopener,noreferrer");
      setAwaitingConsent(true);
      toast({ title: "Autorize na aba aberta", description: "Volte aqui depois de conceder o acesso." });
    } catch (error) {
      toast({ title: "Não foi possível iniciar", description: (error as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  const missingScopes = (data?.required_scopes ?? []).filter((scope) => !(google?.scopes ?? []).includes(scope));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Plug className="size-4" />
          Google (Gmail e Agenda)
          {google?.connected ? (
            <Badge variant="success">conectado</Badge>
          ) : (
            <Badge variant="outline">não conectado</Badge>
          )}
          {delivery?.enabled ? <Badge variant="success">envio ligado</Badge> : <Badge variant="secondary">envio desligado</Badge>}
        </CardTitle>
        <CardDescription>
          Usado para enviar alertas por e-mail e criar eventos de entrevista na sua agenda. Enquanto não estiver
          configurado e ligado aqui, os pipelines não enviam nenhum e-mail.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Step 1 — OAuth client */}
        <section className="space-y-3">
          <StepHeader index={1} label="Credencial do Google Cloud" done={Boolean(google?.client_configured)} />

          {google?.client_configured ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" />
              Client OAuth salvo <code className="font-mono text-xs">{google.client_id_hint}</code>
            </p>
          ) : null}

          <details className="rounded-md border border-border bg-muted/30 p-3 text-sm" open={!google?.client_configured}>
            <summary className="cursor-pointer font-medium">Como obter (2 minutos)</summary>
            <ol className="mt-2 list-inside list-decimal space-y-1.5 text-muted-foreground">
              <li>
                Abra o{" "}
                <a href={GCP_CREDENTIALS_URL} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
                  Console do Google Cloud → Credenciais
                </a>{" "}
                e selecione ou crie um projeto.
              </li>
              <li>Em "APIs e serviços → Biblioteca", ative a <strong>Gmail API</strong> e a <strong>Google Calendar API</strong>.</li>
              <li>Configure a tela de consentimento como <strong>Externo</strong> e adicione seu e-mail em "Usuários de teste".</li>
              <li>
                Em "Criar credenciais → ID do cliente OAuth", escolha o tipo <strong>App para computador</strong> (Desktop app).
              </li>
              <li>Baixe o JSON e cole o conteúdo abaixo. O redirect de loopback já é tratado automaticamente.</li>
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">
              Redirect usado: <code className="font-mono">{data?.redirect_uri}</code> ·{" "}
              <a href={GCP_OAUTH_DOCS_URL} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
                documentação oficial
                <ExternalLink className="ml-0.5 inline size-3" />
              </a>
            </p>
          </details>

          <div className="space-y-1.5">
            <Label htmlFor="oauth-client">JSON do client OAuth</Label>
            <Textarea
              id="oauth-client"
              value={clientJson}
              onChange={(event) => setClientJson(event.target.value)}
              placeholder='{"installed":{"client_id":"…","client_secret":"…"}}'
              className="min-h-24 font-mono text-xs"
              spellCheck={false}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={clientJson.trim().length < 20 || busy === "client"}
              onClick={() =>
                run("client", async () => {
                  await api.saveGoogleClient(clientJson);
                  setClientJson("");
                }, "Credencial salva")
              }
            >
              {busy === "client" ? <Loader2 className="animate-spin" /> : null}
              Salvar credencial
            </Button>
          </div>
        </section>

        <Separator />

        {/* Step 2 — connect the account */}
        <section className="space-y-3">
          <StepHeader index={2} label="Conectar conta" done={Boolean(google?.connected)} />

          {google?.connected ? (
            <div className="space-y-2">
              <p className="text-sm">
                <span className="font-medium">{google.account_email || "conta conectada"}</span>{" "}
                <span className="text-muted-foreground">· desde {formatFullDateTime(google.connected_at)}</span>
              </p>
              {!google.has_refresh_token ? (
                <p className="flex items-center gap-1.5 text-xs text-warning">
                  <TriangleAlert className="size-3.5" />
                  Sem refresh token: reconecte para o acesso não expirar.
                </p>
              ) : null}
              {missingScopes.length ? (
                <p className="flex items-center gap-1.5 text-xs text-warning">
                  <TriangleAlert className="size-3.5" />
                  Faltam permissões: {missingScopes.join(", ")}. Reconecte para conceder.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={connect} disabled={busy === "connect"}>
                  {busy === "connect" ? <Loader2 className="animate-spin" /> : <Plug />}
                  Reconectar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={busy === "disconnect"}
                  onClick={() => run("disconnect", api.disconnectGoogle, "Conta desconectada")}
                >
                  <Link2Off />
                  Desconectar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Button size="sm" onClick={connect} disabled={!google?.client_configured || busy === "connect"}>
                {busy === "connect" || awaitingConsent ? <Loader2 className="animate-spin" /> : <Plug />}
                {awaitingConsent ? "Aguardando autorização…" : "Conectar com o Google"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Abre a tela de consentimento do Google. O token volta sozinho para o app — você não precisa copiar
                nenhum código.
              </p>
            </div>
          )}
        </section>

        <Separator />

        {/* Step 3 — delivery */}
        <section className="space-y-4">
          <StepHeader index={3} label="Alertas por e-mail" done={Boolean(delivery?.enabled)} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="email-to">E-mail de destino</Label>
              <div className="flex gap-2">
                <Input
                  id="email-to"
                  type="email"
                  value={emailTo}
                  onChange={(event) => setEmailTo(event.target.value)}
                  placeholder="voce@exemplo.com"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === "email_to" || emailTo === settings?.email_to}
                  onClick={() => run("email_to", () => api.saveNotifications({ email_to: emailTo }), "Destinatário salvo")}
                >
                  Salvar
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Testar envio</Label>
              <Button
                variant="outline"
                size="sm"
                disabled={!google?.connected || busy === "test" || cooldown.active}
                onClick={() => run("test", () => api.testGoogleEmail(emailTo), "E-mail de teste enviado")}
              >
                {busy === "test" ? <Loader2 className="animate-spin" /> : <Send />}
                {cooldown.active ? `Aguarde ${cooldown.remaining}s` : "Enviar e-mail de teste"}
              </Button>
              <p className="text-xs text-muted-foreground">Funciona mesmo com o envio desligado.</p>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <ToggleRow
              icon={<Mail className="size-4" />}
              label="Enviar alertas por e-mail"
              description={
                delivery?.enabled
                  ? "Os pipelines enviam alertas de erro para o destinatário acima."
                  : DELIVERY_REASONS[delivery?.reason ?? ""] ?? "Configure os passos acima para liberar."
              }
              checked={Boolean(settings?.email_enabled)}
              disabled={!delivery?.ready || busy === "email_enabled"}
              onChange={(checked) =>
                run("email_enabled", async () => {
                  const result = await api.saveNotifications({ email_enabled: checked, email_to: emailTo });
                  if (result.refused.length) {
                    toast({ title: "Não foi possível ligar", description: result.refused.join(" · "), variant: "error" });
                  }
                })
              }
            />

            <ToggleRow
              label="Alertar quando um pipeline falhar"
              description="Vale para a notificação do macOS e para o e-mail."
              checked={Boolean(settings?.alert_on_error)}
              disabled={busy === "alert_on_error"}
              onChange={(checked) => run("alert_on_error", () => api.saveNotifications({ alert_on_error: checked }))}
            />

            <ToggleRow
              label="Notificação do macOS"
              description="Aviso local, não depende do Google."
              checked={Boolean(settings?.macos_notification)}
              disabled={busy === "macos_notification"}
              onChange={(checked) => run("macos_notification", () => api.saveNotifications({ macos_notification: checked }))}
            />

            <ToggleRow
              label="Resumo diário de vagas por e-mail"
              description="Envia as vagas novas sem Easy Apply ao fim de cada varredura."
              checked={Boolean(settings?.job_digest_enabled)}
              disabled={!delivery?.ready || busy === "job_digest_enabled"}
              onChange={(checked) => run("job_digest_enabled", () => api.saveNotifications({ job_digest_enabled: checked }))}
            />
          </div>
        </section>

        <Separator />

        {/* Step 4 — calendar */}
        <section className="space-y-3">
          <StepHeader index={4} label="Agenda" done={Boolean(settings?.calendar_enabled)} />

          <div className="space-y-3 rounded-lg border border-border p-3">
            <ToggleRow
              icon={<CalendarDays className="size-4" />}
              label="Criar eventos de entrevista"
              description="Quando uma conversa confirma data e hora, o agente cria o evento na agenda."
              checked={Boolean(settings?.calendar_enabled)}
              disabled={!google?.connected || busy === "calendar_enabled"}
              onChange={(checked) =>
                run("calendar_enabled", async () => {
                  const result = await api.saveNotifications({ calendar_enabled: checked });
                  if (result.refused.length) {
                    toast({ title: "Não foi possível ligar", description: result.refused.join(" · "), variant: "error" });
                  }
                })
              }
            />

            <div className="space-y-1.5">
              <Label htmlFor="calendar-id">ID da agenda</Label>
              <div className="flex gap-2">
                <Input
                  id="calendar-id"
                  value={calendarId}
                  onChange={(event) => setCalendarId(event.target.value)}
                  placeholder="primary"
                  className="max-w-sm font-mono"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === "calendar_id" || calendarId === settings?.calendar_id}
                  onClick={() => run("calendar_id", () => api.saveNotifications({ calendar_id: calendarId }), "Agenda salva")}
                >
                  Salvar
                </Button>
              </div>
            </div>
          </div>
        </section>

        {google?.last_error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {google.last_error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StepHeader({ index, label, done }: { index: number; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "grid size-5 place-items-center rounded-full text-xs font-semibold",
          done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {done ? <CheckCircle2 className="size-3.5" /> : index}
      </span>
      <h4 className="text-sm font-semibold">{label}</h4>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  checked,
  disabled,
  onChange
}: {
  icon?: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
