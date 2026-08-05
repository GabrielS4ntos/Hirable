import * as React from "react";
import { ArrowDownToLine, Check, ExternalLink, KeyRound, Loader2, Plus, Zap } from "lucide-react";
import { api, type ModelProvider } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
 * Model providers as cards.
 *
 * Roles are the whole point of the layout: the first provider configured becomes
 * the primary, the second automatically becomes its fallback, and any further
 * one stays idle until the user gives it a role.
 */
export function ProviderCards({
  providers,
  onChange,
  compact = false
}: {
  providers: ModelProvider[];
  onChange: (items: ModelProvider[]) => void;
  compact?: boolean;
}) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const [editing, setEditing] = React.useState<ModelProvider | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const configuredCount = providers.filter((provider) => provider.configured).length;

  async function setRole(provider: ModelProvider, role: string) {
    setBusy(provider.id);
    try {
      const result = await api.updateProvider(provider.id, { role });
      onChange(result.items);
    } catch (error) {
      toast({ title: t("provider.roleError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className={cn("grid gap-3", compact ? "sm:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-3")}>
        {providers.map((provider) => {
          const role = ROLE_STYLE[provider.role] ?? ROLE_STYLE.none;
          const RoleIcon = role.icon;
          return (
            <div
              key={provider.id}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-4 transition-colors",
                provider.role === "primary" ? "border-success/50 bg-success/5" : "border-border",
                !provider.configured && "opacity-90"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <ProviderLogo provider={provider.id} className="size-7 text-foreground" />
                  <div className="leading-tight">
                    <p className="text-sm font-semibold">{provider.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {provider.model || provider.default_model}
                    </p>
                  </div>
                </div>
                {provider.configured ? (
                  <Badge variant={role.variant} className="gap-1">
                    {RoleIcon ? <RoleIcon className="size-3" /> : null}
                    {t(role.key)}
                  </Badge>
                ) : null}
              </div>

              {provider.configured ? (
                <p className="text-xs text-muted-foreground">
                  {t("provider.activeKeys", { count: provider.active_key_count })}
                  {provider.supports_multiple_keys && provider.active_key_count > 1 ? t("provider.rotation") : ""}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("provider.noKey")}{" "}
                  <a
                    href={provider.docs_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary underline underline-offset-2"
                  >
                    {t("provider.getKey")}
                    <ExternalLink className="ml-0.5 inline size-3" />
                  </a>
                </p>
              )}

              <div className="mt-auto flex flex-col items-stretch gap-1.5">
                {provider.configured && provider.role !== "primary" ? (
                  <Button size="sm" variant="ghost" disabled={busy === provider.id} onClick={() => setRole(provider, "primary")}>
                    {busy === provider.id ? <Loader2 className="animate-spin" /> : <Zap />}
                    {t("provider.makePrimary")}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled>
                    <Zap />
                    {provider.role === "primary" ? t("provider.currentPrimary") : t("provider.makePrimary")}
                  </Button>
                )}

                {provider.configured && provider.role === "none" && configuredCount > 2 ? (
                  <Button size="sm" variant="ghost" disabled={busy === provider.id} onClick={() => setRole(provider, "fallback")}>
                    <ArrowDownToLine />
                    {t("provider.useFallback")}
                  </Button>
                ) : null}

                <Button size="sm" variant={provider.configured ? "outline" : "default"} onClick={() => setEditing(provider)}>
                  {provider.configured ? <Plus /> : <KeyRound />}
                  {provider.configured ? t("provider.addKey") : t("provider.configure")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <ProviderDialog
        provider={editing}
        onClose={() => setEditing(null)}
        onSaved={(items) => {
          onChange(items);
          setEditing(null);
        }}
      />
    </>
  );
}

function ProviderDialog({
  provider,
  onClose,
  onSaved
}: {
  provider: ModelProvider | null;
  onClose: () => void;
  onSaved: (items: ModelProvider[]) => void;
}) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const [secret, setSecret] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [model, setModel] = React.useState("");
  const [customModel, setCustomModel] = React.useState("");
  const [makePrimary, setMakePrimary] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!provider) return;
    setSecret("");
    setLabel(`${provider.label} ${provider.key_count + 1}`);
    setModel(provider.model || provider.default_model);
    setCustomModel("");
    // The very first provider is the primary anyway; no need to ask.
    setMakePrimary(provider.role === "primary");
  }, [provider]);

  if (!provider) return null;

  const isCustom = model === "__custom__";
  const effectiveModel = isCustom ? customModel.trim() : model;

  async function save() {
    setSaving(true);
    try {
      const result = await api.createKey({
        provider: provider!.id,
        label: label.trim() || provider!.label,
        secret: secret.trim(),
        model: effectiveModel,
        make_primary: makePrimary
      });
      toast({ title: t("provider.configured", { provider: provider!.label }), variant: "success" });
      onSaved(result.providers ?? []);
    } catch (error) {
      toast({ title: t("provider.saveError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(provider)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(30rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderLogo provider={provider.id} className="size-6 text-foreground" />
            {provider.label}
          </DialogTitle>
          <DialogDescription>
            {t("provider.secretDescription")}{" "}
            <a href={provider.docs_url} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
              {t("provider.whereKey")}
              <ExternalLink className="ml-0.5 inline size-3" />
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="provider-secret">{t("provider.apiKey")}</Label>
            <Input
              id="provider-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={provider.key_hint}
              autoComplete="off"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-label">{t("provider.nickname")}</Label>
            <Input id="provider-label" value={label} onChange={(event) => setLabel(event.target.value)} />
            {provider.supports_multiple_keys ? (
              <p className="text-xs text-muted-foreground">
                {t("provider.multipleKeys")}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-model">{t("provider.model")}</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="provider-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {provider.models.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">{t("provider.otherModel")}</SelectItem>
              </SelectContent>
            </Select>
            {isCustom ? (
              <Input
                value={customModel}
                onChange={(event) => setCustomModel(event.target.value)}
                placeholder={t("provider.modelPlaceholder")}
                className="font-mono"
                autoFocus
              />
            ) : null}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t("provider.useAsPrimary")}</p>
              <p className="text-xs text-muted-foreground">{t("provider.primaryDescription")}</p>
            </div>
            <Switch checked={makePrimary} onCheckedChange={setMakePrimary} aria-label={t("provider.useAsPrimary")} />
          </div>
        </div>

        <Button onClick={save} disabled={saving || secret.trim().length < 8 || !effectiveModel}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
          {t("common.save")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
