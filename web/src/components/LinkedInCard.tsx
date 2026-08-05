import * as React from "react";
import { Briefcase, LogOut, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { api, type LinkedInPayload } from "@/lib/api";
import { formatFullDateTime } from "@/lib/format";
import { localizedError, useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { IntegrationCard, SettingsGroup, StatusPill, type IntegrationTone } from "@/components/ui/integration";

/** Stands in for the empty channel, which Radix cannot represent. */
const BUNDLED = "bundled";

const TONE: Record<string, IntegrationTone> = {
  connected: "ok",
  pending: "pending",
  expired: "error",
  disconnected: "error"
};

/**
 * The LinkedIn session, connected from here instead of from a terminal.
 *
 * Pressing Conectar opens a real browser window on this machine; the password
 * and any two-step challenge are typed there, by the user. This screen only
 * watches for the result — it never sees, fills or stores a credential.
 */
export function LinkedInCard({ onChange }: { onChange?: () => void } = {}) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const [data, setData] = React.useState<LinkedInPayload | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const payload = await api.getLinkedIn().catch(() => null);
    if (payload) setData(payload);
    return payload;
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  // While the login window is open, the state changes outside this page.
  React.useEffect(() => {
    if (!data?.pending) return;
    const timer = setInterval(() => {
      void load().then((payload) => {
        if (payload && !payload.pending) onChange?.();
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [data?.pending, load, onChange]);

  async function run(action: string, fn: () => Promise<unknown>, successTitle?: string) {
    setBusy(action);
    try {
      await fn();
      await load();
      onChange?.();
      if (successTitle) toast({ title: successTitle, variant: "success" });
    } catch (error) {
      toast({ title: t("linkedin.actionError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  const session = data?.session;
  const state = data?.pending ? "pending" : (session?.state ?? "disconnected");
  const connected = state === "connected";

  return (
    <IntegrationCard
      icon={<Briefcase className="size-4" />}
      title={t("linkedin.title")}
      description={state === "pending" ? t("linkedin.pendingDescription") : t("linkedin.description")}
      attention={!connected}
      status={<StatusPill tone={TONE[state] ?? "error"} label={t(`linkedin.state.${state}` as "linkedin.state.connected")} />}
    >
      {connected && session ? (
        <p className="text-sm text-muted-foreground">
          {session.account_name ? <span className="font-medium text-foreground">{session.account_name}</span> : null}
          {session.account_name ? " · " : ""}
          {t("linkedin.since", { when: formatFullDateTime(session.connected_at, locale) })}
        </p>
      ) : null}

      {state === "expired" ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {t("linkedin.expiredHint")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!connected ? (
          <Button disabled={busy !== null || data?.pending} onClick={() => run("connect", api.connectLinkedIn, t("linkedin.opening"))}>
            <Plug />
            {state === "expired" ? t("linkedin.reconnect") : t("linkedin.connect")}
          </Button>
        ) : null}

        <Button variant="outline" disabled={busy !== null || data?.pending} onClick={() => run("verify", api.verifyLinkedIn)}>
          <RefreshCw className={busy === "verify" ? "animate-spin" : undefined} />
          {t("linkedin.verify")}
        </Button>

        {connected ? (
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm(t("linkedin.logoutConfirm"))) return;
              void run("logout", api.logoutLinkedIn, t("linkedin.loggedOut"));
            }}
          >
            <LogOut />
            {t("linkedin.logout")}
          </Button>
        ) : null}
      </div>

      <SettingsGroup title={t("linkedin.browser")} description={t("linkedin.browserHelp")}>
        <Select
          // Radix treats an empty string as "no selection", so the bundled
          // Chromium travels under a sentinel and is mapped back on save.
          value={data?.channel ? data.channel : BUNDLED}
          onValueChange={(value) =>
            run("channel", () => api.saveConfig({ "browser.channel": value === BUNDLED ? "" : value }))
          }
        >
          <SelectTrigger id="linkedin-channel" className="max-w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BUNDLED}>{t("linkedin.browserBundled")}</SelectItem>
            <SelectItem value="chrome">Google Chrome</SelectItem>
            <SelectItem value="msedge">Microsoft Edge</SelectItem>
          </SelectContent>
        </Select>
        <Label htmlFor="linkedin-channel" className="sr-only">{t("linkedin.browser")}</Label>
      </SettingsGroup>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        {t("linkedin.privacyNote")}
      </p>
    </IntegrationCard>
  );
}
