import * as React from "react";
import { LogOut, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { api, type LinkedInPayload } from "@/lib/api";
import { formatFullDateTime } from "@/lib/format";
import { localizedError, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

/** Stands in for the empty channel, which Radix cannot represent. */
const BUNDLED = "bundled";

const DOT: Record<string, string> = {
  connected: "bg-success",
  pending: "bg-warning animate-pulse",
  expired: "bg-destructive",
  disconnected: "bg-destructive"
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
    <Card className={cn(!connected && "border-primary/40")}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className={cn("size-2.5 shrink-0 rounded-full", DOT[state] ?? DOT.disconnected)} aria-hidden="true" />
          {t("linkedin.title")}
          <span className={cn("text-sm font-normal", connected ? "text-success" : state === "pending" ? "text-warning" : "text-destructive")}>
            {t(`linkedin.state.${state}` as "linkedin.state.connected")}
          </span>
        </CardTitle>
        <CardDescription>
          {state === "pending" ? t("linkedin.pendingDescription") : t("linkedin.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {connected ? (
          <p className="text-sm text-muted-foreground">
            {session?.account_name ? <span className="font-medium text-foreground">{session.account_name}</span> : null}
            {session?.account_name ? " · " : ""}
            {t("linkedin.since", { when: formatFullDateTime(session?.connected_at ?? null, locale) })}
          </p>
        ) : null}

        {state === "expired" && session?.last_reason ? (
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

        <div className="space-y-1.5">
          <Label htmlFor="linkedin-channel">{t("linkedin.browser")}</Label>
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
          <p className="text-xs text-muted-foreground">{t("linkedin.browserHelp")}</p>
        </div>

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          {t("linkedin.privacyNote")}
        </p>
      </CardContent>
    </Card>
  );
}
