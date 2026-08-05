import * as React from "react";
import { ArrowDownToLine, Check, ExternalLink, Loader2, Plug, Settings2, Zap } from "lucide-react";
import { api, type CliAgent } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ProviderLogo } from "@/components/ProviderLogo";
import { localizedError, useI18n } from "@/lib/i18n";

const ROLE_STYLE: Record<string, { key: "provider.primary" | "provider.fallback" | "provider.none"; variant: "success" | "default" | "outline"; icon: React.ElementType | null }> = {
  primary: { key: "provider.primary", variant: "success", icon: Zap },
  fallback: { key: "provider.fallback", variant: "default", icon: ArrowDownToLine },
  none: { key: "provider.none", variant: "outline", icon: null }
};

/**
 * Coding-agent CLIs, laid out exactly like the model providers: the first one
 * enabled becomes the primary, the second its fallback, and any further one
 * stays idle until it is given a role.
 */
export function CliAgentCards({ agents, onChange }: { agents: CliAgent[]; onChange: (items: CliAgent[]) => void }) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const [editing, setEditing] = React.useState<CliAgent | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [probe, setProbe] = React.useState<Record<string, { available: boolean; detail: string }>>({});

  const enabledCount = agents.filter((agent) => agent.enabled).length;

  async function patch(agent: CliAgent, body: Parameters<typeof api.saveCliAgent>[1]) {
    setBusy(agent.id);
    try {
      const result = await api.saveCliAgent(agent.id, body);
      onChange(result.items);
    } catch (error) {
      toast({ title: t("cliAgent.saveError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function runProbe(agent: CliAgent) {
    setBusy(agent.id);
    try {
      const result = await api.probeCliAgent(agent.id);
      setProbe((current) => ({ ...current, [agent.id]: result }));
    } catch (error) {
      setProbe((current) => ({ ...current, [agent.id]: { available: false, detail: localizedError(error, t, locale) } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {agents.map((agent) => {
          const role = ROLE_STYLE[agent.role] ?? ROLE_STYLE.none;
          const RoleIcon = role.icon;
          const check = probe[agent.id];
          return (
            <div
              key={agent.id}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-4 transition-colors",
                agent.role === "primary" ? "border-success/50 bg-success/5" : "border-border"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <ProviderLogo provider={agent.id} className="size-7 text-foreground" />
                  <div className="leading-tight">
                    <p className="text-sm font-semibold">{agent.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">{agent.command}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {agent.enabled ? (
                    <Badge variant={role.variant} className="gap-1">
                      {RoleIcon ? <RoleIcon className="size-3" /> : null}
                      {t(role.key)}
                    </Badge>
                  ) : null}
                  <Switch
                    checked={agent.enabled}
                    disabled={busy === agent.id}
                    onCheckedChange={(checked) => patch(agent, { enabled: checked })}
                    aria-label={agent.label}
                  />
                </div>
              </div>

              {check ? (
                <p className={cn("text-xs", check.available ? "text-success" : "text-destructive")}>
                  {check.available ? t("cliAgent.available", { detail: check.detail }) : check.detail}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {agent.last_run_at
                    ? t("cliAgent.lastRun", { status: agent.last_status || "-", count: agent.run_count })
                    : t("cliAgent.installHint", { hint: agent.install_hint })}
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" disabled={busy === agent.id} onClick={() => runProbe(agent)}>
                  {busy === agent.id ? <Loader2 className="animate-spin" /> : <Plug />}
                  {t("cliAgent.test")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(agent)}>
                  <Settings2 />
                  {t("cliAgent.command")}
                </Button>
                {agent.enabled && agent.role !== "primary" ? (
                  <Button size="sm" variant="ghost" disabled={busy === agent.id} onClick={() => patch(agent, { role: "primary" })}>
                    <Zap />
                    {t("provider.makePrimary")}
                  </Button>
                ) : null}
                {agent.enabled && agent.role === "none" && enabledCount > 2 ? (
                  <Button size="sm" variant="ghost" disabled={busy === agent.id} onClick={() => patch(agent, { role: "fallback" })}>
                    <ArrowDownToLine />
                    {t("provider.useFallback")}
                  </Button>
                ) : null}
                {agent.docs_url ? (
                  <Button asChild size="sm" variant="ghost">
                    <a href={agent.docs_url} target="_blank" rel="noreferrer noopener">
                      <ExternalLink />
                      {t("cliAgent.docs")}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <CliAgentDialog agent={editing} onClose={() => setEditing(null)} onSaved={(items) => { onChange(items); setEditing(null); }} />
    </>
  );
}

function CliAgentDialog({
  agent,
  onClose,
  onSaved
}: {
  agent: CliAgent | null;
  onClose: () => void;
  onSaved: (items: CliAgent[]) => void;
}) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const [command, setCommand] = React.useState("");
  const [args, setArgs] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!agent) return;
    setCommand(agent.command);
    setArgs(JSON.stringify(agent.args_template));
  }, [agent]);

  if (!agent) return null;

  async function save() {
    setSaving(true);
    try {
      const result = await api.saveCliAgent(agent!.id, { command, args_template: args });
      toast({ title: t("cliAgent.saved"), variant: "success" });
      onSaved(result.items);
    } catch (error) {
      toast({ title: t("cliAgent.saveError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(agent)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(34rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderLogo provider={agent.id} className="size-6 text-foreground" />
            {agent.label}
          </DialogTitle>
          <DialogDescription>{t("cliAgent.commandDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cli-command">{t("cliAgent.executable")}</Label>
            <Input id="cli-command" value={command} onChange={(event) => setCommand(event.target.value)} className="font-mono" />
            <p className="text-xs text-muted-foreground">{t("cliAgent.executableHelp")}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cli-args">{t("cliAgent.arguments")}</Label>
            <Input id="cli-args" value={args} onChange={(event) => setArgs(event.target.value)} className="font-mono" />
            <p className="text-xs text-muted-foreground">{t("cliAgent.argumentsHelp")}</p>
          </div>
        </div>

        <Button onClick={save} disabled={saving || !command.trim()}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
          {t("common.save")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
