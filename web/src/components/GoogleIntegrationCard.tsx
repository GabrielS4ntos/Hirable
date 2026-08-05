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
import { localizedError, useI18n } from "@/lib/i18n";

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
  const { t, locale } = useI18n();
  const en = locale === "en";
  const c = en ? {
    connectedToast: "Google account connected", error: "Error", authorize: "Authorize in the opened tab", authorizeHelp: "Return here after granting access.", startError: "Could not start",
    title: "Google (Gmail and Calendar)", connected: "connected", disconnected: "not connected", deliveryOn: "delivery on", deliveryOff: "delivery off",
    description: "Used to send email alerts and create interview events in your calendar. Pipelines send no email until it is configured and enabled here.",
    cloudCredential: "Google Cloud credential", clientSaved: "OAuth client saved", howTo: "How to get it (2 minutes)",
    gcp1a: "Open", gcpConsole: "Google Cloud Console → Credentials", gcp1b: "and select or create a project.",
    gcp2: "Under APIs & Services → Library, enable the Gmail API and Google Calendar API.", gcp3: "Configure the consent screen as External and add your email under Test users.",
    gcp4: "Under Create credentials → OAuth client ID, choose Desktop app.", gcp5: "Download the JSON and paste it below. The loopback redirect is handled automatically.",
    redirect: "Redirect used:", officialDocs: "official documentation", oauthJson: "OAuth client JSON", credentialSaved: "Credential saved", saveCredential: "Save credential",
    connectAccount: "Connect account", account: "connected account", since: "since", noRefresh: "No refresh token: reconnect so access does not expire.",
    missingScopes: "Missing permissions:", reconnectGrant: "Reconnect to grant them.", reconnect: "Reconnect", accountDisconnected: "Account disconnected", disconnect: "Disconnect",
    waiting: "Waiting for authorization…", connectGoogle: "Connect with Google", connectHelp: "Opens Google's consent screen. The token returns to the app automatically; you do not need to copy a code.",
    emailAlerts: "Email alerts", recipient: "Destination email", recipientSaved: "Recipient saved", save: "Save", testDelivery: "Test delivery", testSent: "Test email sent",
    wait: "Wait", sendTest: "Send test email", testWhenOff: "Works even when delivery is off.", sendAlerts: "Send email alerts", sendingHelp: "Pipelines send error alerts to the recipient above.",
    configureAbove: "Complete the steps above to enable it.", enableError: "Could not enable", pipelineFailure: "Alert when a pipeline fails", pipelineFailureHelp: "Applies to macOS notifications and email.",
    macos: "macOS notification", macosHelp: "Local alert; does not depend on Google.", digest: "Daily job digest by email", digestHelp: "Sends new jobs without Easy Apply after each scan.",
    calendar: "Calendar", createEvents: "Create interview events", createEventsHelp: "When a conversation confirms a date and time, the agent creates the calendar event.",
    calendarId: "Calendar ID", calendarSaved: "Calendar saved"
  } : {
    connectedToast: "Conta Google conectada", error: "Erro", authorize: "Autorize na aba aberta", authorizeHelp: "Volte aqui depois de conceder o acesso.", startError: "Não foi possível iniciar",
    title: "Google (Gmail e Agenda)", connected: "conectado", disconnected: "não conectado", deliveryOn: "envio ligado", deliveryOff: "envio desligado",
    description: "Usado para enviar alertas por e-mail e criar eventos de entrevista na sua agenda. Enquanto não estiver configurado e ligado aqui, os pipelines não enviam nenhum e-mail.",
    cloudCredential: "Credencial do Google Cloud", clientSaved: "Client OAuth salvo", howTo: "Como obter (2 minutos)",
    gcp1a: "Abra o", gcpConsole: "Console do Google Cloud → Credenciais", gcp1b: "e selecione ou crie um projeto.",
    gcp2: "Em APIs e serviços → Biblioteca, ative a Gmail API e a Google Calendar API.", gcp3: "Configure a tela de consentimento como Externo e adicione seu e-mail em Usuários de teste.",
    gcp4: "Em Criar credenciais → ID do cliente OAuth, escolha App para computador.", gcp5: "Baixe o JSON e cole o conteúdo abaixo. O redirect de loopback é tratado automaticamente.",
    redirect: "Redirect usado:", officialDocs: "documentação oficial", oauthJson: "JSON do client OAuth", credentialSaved: "Credencial salva", saveCredential: "Salvar credencial",
    connectAccount: "Conectar conta", account: "conta conectada", since: "desde", noRefresh: "Sem refresh token: reconecte para o acesso não expirar.",
    missingScopes: "Faltam permissões:", reconnectGrant: "Reconecte para conceder.", reconnect: "Reconectar", accountDisconnected: "Conta desconectada", disconnect: "Desconectar",
    waiting: "Aguardando autorização…", connectGoogle: "Conectar com o Google", connectHelp: "Abre a tela de consentimento do Google. O token volta sozinho para o app; você não precisa copiar nenhum código.",
    emailAlerts: "Alertas por e-mail", recipient: "E-mail de destino", recipientSaved: "Destinatário salvo", save: "Salvar", testDelivery: "Testar envio", testSent: "E-mail de teste enviado",
    wait: "Aguarde", sendTest: "Enviar e-mail de teste", testWhenOff: "Funciona mesmo com o envio desligado.", sendAlerts: "Enviar alertas por e-mail", sendingHelp: "Os pipelines enviam alertas de erro para o destinatário acima.",
    configureAbove: "Configure os passos acima para liberar.", enableError: "Não foi possível ligar", pipelineFailure: "Alertar quando um pipeline falhar", pipelineFailureHelp: "Vale para a notificação do macOS e para o e-mail.",
    macos: "Notificação do macOS", macosHelp: "Aviso local, não depende do Google.", digest: "Resumo diário de vagas por e-mail", digestHelp: "Envia as vagas novas sem Easy Apply ao fim de cada varredura.",
    calendar: "Agenda", createEvents: "Criar eventos de entrevista", createEventsHelp: "Quando uma conversa confirma data e hora, o agente cria o evento na agenda.",
    calendarId: "ID da agenda", calendarSaved: "Agenda salva"
  };
  const deliveryReasons: Record<string, string> = en ? {
    client_oauth_nao_configurado: "Paste the OAuth client JSON to begin.", conta_google_nao_conectada: "Connect a Google account.",
    destinatario_nao_definido: "Set the email address that will receive alerts.", envio_desativado_pelo_usuario: "Everything is ready — enable delivery.", storage_indisponivel: "Local database unavailable."
  } : DELIVERY_REASONS;
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
        toast({ title: c.connectedToast, description: payload.google.account_email, variant: "success" });
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
      toast({ title: c.error, description: localizedError(error, t, locale), variant: "error" });
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
      toast({ title: c.authorize, description: c.authorizeHelp });
    } catch (error) {
      toast({ title: c.startError, description: localizedError(error, t, locale), variant: "error" });
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
          {c.title}
          {google?.connected ? (
            <Badge variant="success">{c.connected}</Badge>
          ) : (
            <Badge variant="outline">{c.disconnected}</Badge>
          )}
          {delivery?.enabled ? <Badge variant="success">{c.deliveryOn}</Badge> : <Badge variant="secondary">{c.deliveryOff}</Badge>}
        </CardTitle>
        <CardDescription>
          {c.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Step 1 — OAuth client */}
        <section className="space-y-3">
          <StepHeader index={1} label={c.cloudCredential} done={Boolean(google?.client_configured)} />

          {google?.client_configured ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" />
              {c.clientSaved} <code className="font-mono text-xs">{google.client_id_hint}</code>
            </p>
          ) : null}

          <details className="rounded-md border border-border bg-muted/30 p-3 text-sm" open={!google?.client_configured}>
            <summary className="cursor-pointer font-medium">{c.howTo}</summary>
            <ol className="mt-2 list-inside list-decimal space-y-1.5 text-muted-foreground">
              <li>
                {c.gcp1a}{" "}
                <a href={GCP_CREDENTIALS_URL} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
                  {c.gcpConsole}
                </a>{" "}
                {c.gcp1b}
              </li>
              <li>{c.gcp2}</li><li>{c.gcp3}</li><li>{c.gcp4}</li><li>{c.gcp5}</li>
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">
              {c.redirect} <code className="font-mono">{data?.redirect_uri}</code> ·{" "}
              <a href={GCP_OAUTH_DOCS_URL} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
                {c.officialDocs}
                <ExternalLink className="ml-0.5 inline size-3" />
              </a>
            </p>
          </details>

          <div className="space-y-1.5">
            <Label htmlFor="oauth-client">{c.oauthJson}</Label>
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
                }, c.credentialSaved)
              }
            >
              {busy === "client" ? <Loader2 className="animate-spin" /> : null}
              {c.saveCredential}
            </Button>
          </div>
        </section>

        <Separator />

        {/* Step 2 — connect the account */}
        <section className="space-y-3">
          <StepHeader index={2} label={c.connectAccount} done={Boolean(google?.connected)} />

          {google?.connected ? (
            <div className="space-y-2">
              <p className="text-sm">
                <span className="font-medium">{google.account_email || c.account}</span>{" "}
                <span className="text-muted-foreground">· {c.since} {formatFullDateTime(google.connected_at, locale)}</span>
              </p>
              {!google.has_refresh_token ? (
                <p className="flex items-center gap-1.5 text-xs text-warning">
                  <TriangleAlert className="size-3.5" />
                  {c.noRefresh}
                </p>
              ) : null}
              {missingScopes.length ? (
                <p className="flex items-center gap-1.5 text-xs text-warning">
                  <TriangleAlert className="size-3.5" />
                  {c.missingScopes} {missingScopes.join(", ")}. {c.reconnectGrant}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={connect} disabled={busy === "connect"}>
                  {busy === "connect" ? <Loader2 className="animate-spin" /> : <Plug />}
                  {c.reconnect}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={busy === "disconnect"}
                  onClick={() => run("disconnect", api.disconnectGoogle, c.accountDisconnected)}
                >
                  <Link2Off />
                  {c.disconnect}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Button size="sm" onClick={connect} disabled={!google?.client_configured || busy === "connect"}>
                {busy === "connect" || awaitingConsent ? <Loader2 className="animate-spin" /> : <Plug />}
                {awaitingConsent ? c.waiting : c.connectGoogle}
              </Button>
              <p className="text-xs text-muted-foreground">
                {c.connectHelp}
              </p>
            </div>
          )}
        </section>

        <Separator />

        {/* Step 3 — delivery */}
        <section className="space-y-4">
          <StepHeader index={3} label={c.emailAlerts} done={Boolean(delivery?.enabled)} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="email-to">{c.recipient}</Label>
              <div className="flex gap-2">
                <Input
                  id="email-to"
                  type="email"
                  value={emailTo}
                  onChange={(event) => setEmailTo(event.target.value)}
                  placeholder={en ? "you@example.com" : "você@exemplo.com"}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === "email_to" || emailTo === settings?.email_to}
                  onClick={() => run("email_to", () => api.saveNotifications({ email_to: emailTo }), c.recipientSaved)}
                >
                  {c.save}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{c.testDelivery}</Label>
              <Button
                variant="outline"
                size="sm"
                disabled={!google?.connected || busy === "test" || cooldown.active}
                onClick={() => run("test", () => api.testGoogleEmail(emailTo), c.testSent)}
              >
                {busy === "test" ? <Loader2 className="animate-spin" /> : <Send />}
                {cooldown.active ? `${c.wait} ${cooldown.remaining}s` : c.sendTest}
              </Button>
              <p className="text-xs text-muted-foreground">{c.testWhenOff}</p>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <ToggleRow
              icon={<Mail className="size-4" />}
              label={c.sendAlerts}
              description={
                delivery?.enabled
                  ? c.sendingHelp
                  : deliveryReasons[delivery?.reason ?? ""] ?? c.configureAbove
              }
              checked={Boolean(settings?.email_enabled)}
              disabled={!delivery?.ready || busy === "email_enabled"}
              onChange={(checked) =>
                run("email_enabled", async () => {
                  const result = await api.saveNotifications({ email_enabled: checked, email_to: emailTo });
                  if (result.refused.length) {
                    toast({ title: c.enableError, description: result.refused.join(" · "), variant: "error" });
                  }
                })
              }
            />

            <ToggleRow
              label={c.pipelineFailure}
              description={c.pipelineFailureHelp}
              checked={Boolean(settings?.alert_on_error)}
              disabled={busy === "alert_on_error"}
              onChange={(checked) => run("alert_on_error", () => api.saveNotifications({ alert_on_error: checked }))}
            />

            <ToggleRow
              label={c.macos}
              description={c.macosHelp}
              checked={Boolean(settings?.macos_notification)}
              disabled={busy === "macos_notification"}
              onChange={(checked) => run("macos_notification", () => api.saveNotifications({ macos_notification: checked }))}
            />

            <ToggleRow
              label={c.digest}
              description={c.digestHelp}
              checked={Boolean(settings?.job_digest_enabled)}
              disabled={!delivery?.ready || busy === "job_digest_enabled"}
              onChange={(checked) => run("job_digest_enabled", () => api.saveNotifications({ job_digest_enabled: checked }))}
            />
          </div>
        </section>

        <Separator />

        {/* Step 4 — calendar */}
        <section className="space-y-3">
          <StepHeader index={4} label={c.calendar} done={Boolean(settings?.calendar_enabled)} />

          <div className="space-y-3 rounded-lg border border-border p-3">
            <ToggleRow
              icon={<CalendarDays className="size-4" />}
              label={c.createEvents}
              description={c.createEventsHelp}
              checked={Boolean(settings?.calendar_enabled)}
              disabled={!google?.connected || busy === "calendar_enabled"}
              onChange={(checked) =>
                run("calendar_enabled", async () => {
                  const result = await api.saveNotifications({ calendar_enabled: checked });
                  if (result.refused.length) {
                    toast({ title: c.enableError, description: result.refused.join(" · "), variant: "error" });
                  }
                })
              }
            />

            <div className="space-y-1.5">
              <Label htmlFor="calendar-id">{c.calendarId}</Label>
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
                  onClick={() => run("calendar_id", () => api.saveNotifications({ calendar_id: calendarId }), c.calendarSaved)}
                >
                  {c.save}
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
