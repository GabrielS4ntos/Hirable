import * as React from "react";
import { BellRing, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { api, type AlertEvent, type AutoFixState, type CliAgent, type NotificationSettings } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { localizedError, useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { CliAgentCards } from "@/components/CliAgentCards";

const DEDUPE_PRESETS = [0, 30, 120, 360, 1440];

/**
 * Alert throttling and auto-fix.
 *
 * The two belong together: the throttle decides how often the user hears about a
 * failure, and the auto-fix decides whether something tries to repair it before
 * that message goes out.
 */
export function AlertsCard() {
  const toast = useToast();
  const { t, locale } = useI18n();
  const [settings, setSettings] = React.useState<NotificationSettings | null>(null);
  const [agents, setAgents] = React.useState<CliAgent[]>([]);
  const [autoFix, setAutoFix] = React.useState<AutoFixState | null>(null);
  const [alerts, setAlerts] = React.useState<AlertEvent[]>([]);
  const [dedupe, setDedupe] = React.useState<string>("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [integrations, cliAgents, recent] = await Promise.all([
      api.getIntegrations(),
      api.listCliAgents(),
      api.listAlerts(20).catch(() => ({ items: [], dedupe_minutes: 0 }))
    ]);
    setSettings(integrations.notifications);
    setDedupe(String(integrations.notifications.alert_dedupe_minutes));
    setAgents(cliAgents.items);
    setAutoFix(cliAgents.auto_fix);
    setAlerts(recent.items);
  }, []);

  React.useEffect(() => { load().catch(() => {}); }, [load]);

  async function save(key: string, patch: Partial<NotificationSettings>) {
    setBusy(key);
    try {
      const result = await api.saveNotifications(patch);
      setSettings(result.notifications);
      if (result.refused.length) {
        toast({ title: t("alerts.refused"), description: result.refused.join(" · "), variant: "error" });
      }
    } catch (error) {
      toast({ title: t("alerts.saveError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  const suppressedTotal = alerts.reduce((sum, alert) => sum + (alert.occurrences - alert.notified_count), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" />
          {t("alerts.title")}
        </CardTitle>
        <CardDescription>{t("alerts.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="dedupe-minutes">{t("alerts.window")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="dedupe-minutes"
              type="number"
              min={0}
              max={1440}
              value={dedupe}
              onChange={(event) => setDedupe(event.target.value)}
              onBlur={() => {
                const minutes = Number(dedupe);
                if (Number.isFinite(minutes) && minutes !== settings?.alert_dedupe_minutes) {
                  save("alert_dedupe_minutes", { alert_dedupe_minutes: minutes });
                }
              }}
              className="w-28 font-mono"
            />
            <div className="flex flex-wrap gap-1">
              {DEDUPE_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => { setDedupe(String(minutes)); save("alert_dedupe_minutes", { alert_dedupe_minutes: minutes }); }}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {minutes === 0 ? t("alerts.everyOne") : t("alerts.minutes", { count: minutes })}
                </button>
              ))}
            </div>
            {busy === "alert_dedupe_minutes" ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("alerts.windowHelp")}</p>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Wrench className="size-4" />
                {t("alerts.autoFix")}
              </p>
              <p className="text-xs text-muted-foreground">
                {autoFix?.ready ? t("alerts.autoFixHelp") : t("alerts.autoFixBlocked")}
              </p>
            </div>
            <Switch
              checked={Boolean(settings?.auto_fix_enabled)}
              disabled={!autoFix?.ready || busy === "auto_fix_enabled"}
              onCheckedChange={(checked) => save("auto_fix_enabled", { auto_fix_enabled: checked })}
              aria-label={t("alerts.autoFix")}
            />
          </div>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            {t("alerts.sandboxNote")}
          </p>

          <CliAgentCards
            agents={agents}
            onChange={(items) => {
              setAgents(items);
              // Turning the primary agent off also turns auto-fix off server-side.
              load().catch(() => {});
            }}
          />
        </div>

        {alerts.length ? (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{t("alerts.recent")}</p>
                {suppressedTotal > 0 ? (
                  <Badge variant="outline">{t("alerts.suppressedTotal", { count: suppressedTotal })}</Badge>
                ) : null}
              </div>
              <div className="space-y-1.5">
                {alerts.slice(0, 8).map((alert) => (
                  <div key={alert.fingerprint} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
                    <Badge variant={alert.level === "error" ? "destructive" : "outline"}>{alert.command || "-"}</Badge>
                    <span className="min-w-40 flex-1 truncate text-muted-foreground">{alert.message}</span>
                    <span className="font-mono text-muted-foreground">
                      {t("alerts.occurrences", { count: alert.occurrences })} · {t("alerts.emails", { count: alert.notified_count })}
                    </span>
                    <span className="font-mono text-muted-foreground">{formatDateTime(alert.last_seen_at, locale)}</span>
                    {alert.auto_fix_status ? <Badge variant="outline">{alert.auto_fix_status}</Badge> : null}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
