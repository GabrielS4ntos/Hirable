import * as React from "react";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { api, type ApiKey, type ModelProvider } from "@/lib/api";
import { ProviderCards } from "@/components/ProviderCards";
import type { PageProps } from "@/lib/page";
import { usePolling } from "@/hooks/usePolling";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { localizedError, useI18n } from "@/lib/i18n";

export function KeysPage({ refreshStatus }: PageProps) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const c = locale === "en" ? {
    providers: "Model providers", providersHelp: "The primary receives all calls; the fallback takes over on quota failures. With two configured providers, choosing the primary automatically defines the other as fallback.",
    newKey: "New key", newKeyHelp: "Keys are stored only in local SQLite (file permission 600). Providers with multiple keys use round-robin rotation.",
    provider: "Provider", nickname: "Nickname", nicknamePlaceholder: "personal account", key: "Key", add: "Add",
    saved: "Key saved", savedHelp: "Pipelines will use this key on their next run.", saveError: "Could not save key",
    active: "active", primary: "primary", fallback: "fallback", disabled: "Key disabled", enabled: "Key enabled", removed: "Key removed",
    empty: "No keys registered. Add one here to configure this provider.", uses: "Uses", lastUse: "Last use", activeHeading: "Active",
    error: "error", enableKey: "Enable key", removeKey: "Remove key"
  } : {
    providers: "Providers de modelo", providersHelp: "O principal recebe todas as chamadas; o fallback assume quando ele falha por cota. Com dois providers configurados, escolher o principal define o outro como fallback automaticamente.",
    newKey: "Nova chave", newKeyHelp: "As chaves ficam somente no SQLite local (arquivo com permissão 600). Providers com várias chaves usam rodízio.",
    provider: "Provedor", nickname: "Apelido", nicknamePlaceholder: "conta pessoal", key: "Chave", add: "Adicionar",
    saved: "Chave salva", savedHelp: "Os pipelines já usam esta chave na próxima execução.", saveError: "Erro ao salvar chave",
    active: "ativa(s)", primary: "principal", fallback: "fallback", disabled: "Chave desativada", enabled: "Chave ativada", removed: "Chave removida",
    empty: "Nenhuma chave cadastrada. Adicione uma aqui para configurar este provider.", uses: "Usos", lastUse: "Último uso", activeHeading: "Ativa",
    error: "erro", enableKey: "Ativar chave", removeKey: "Remover chave"
  };
  const keys = usePolling(api.listKeys, 0);
  const [provider, setProvider] = React.useState<string>("gemini");
  const [label, setLabel] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [providers, setProviders] = React.useState<ModelProvider[]>([]);

  React.useEffect(() => {
    api.listProviders().then((result) => setProviders(result.items)).catch(() => {});
  }, []);

  const items = keys.data?.items ?? [];

  async function addKey(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.createKey({ provider, label: label || `${provider} ${items.length + 1}`, secret });
      keys.setData(result);
      setLabel("");
      setSecret("");
      refreshStatus();
      toast({ title: c.saved, description: c.savedHelp, variant: "success" });
    } catch (error) {
      toast({ title: c.saveError, description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function mutate(action: Promise<{ items: ApiKey[] }>, message: string) {
    try {
      keys.setData(await action);
      refreshStatus();
      toast({ title: message, variant: "success" });
    } catch (error) {
      toast({ title: t("common.error"), description: localizedError(error, t, locale), variant: "error" });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{c.providers}</CardTitle>
          <CardDescription>{c.providersHelp}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProviderCards providers={providers} onChange={setProviders} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4" />
            {c.newKey}
          </CardTitle>
          <CardDescription>{c.newKeyHelp}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addKey} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[10rem_1fr_2fr_auto]">
            <div className="space-y-1.5">
              <Label>{c.provider}</Label>
              <Select value={provider} onValueChange={(value) => setProvider(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="key-label">{c.nickname}</Label>
              <Input
                id="key-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={c.nicknamePlaceholder}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="key-secret">{c.key}</Label>
              <Input
                id="key-secret"
                type="password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="AIza… / sk-or-…"
                autoComplete="off"
                required
                minLength={8}
                className="font-mono"
              />
            </div>

            <div className="flex items-end">
              <Button type="submit" disabled={saving || secret.length < 8} className="w-full sm:w-auto">
                {saving ? <Loader2 className="animate-spin" /> : <Plus />}
                {c.add}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {providers.map((provider) => (
        <KeyTable
          key={provider.id}
          title={provider.label}
          description={`${items.filter((item) => item.provider === provider.id && item.enabled).length} ${c.active}${
            provider.role === "primary" ? ` · ${c.primary}` : provider.role === "fallback" ? ` · ${c.fallback}` : ""
          }`}
          items={items.filter((item) => item.provider === provider.id)}
          onToggle={(item) => mutate(api.updateKey(item.id, { enabled: !item.enabled }), item.enabled ? c.disabled : c.enabled)}
          onDelete={(item) => mutate(api.deleteKey(item.id), c.removed)}
          copy={c}
          locale={locale}
        />
      ))}
    </div>
  );
}

function KeyTable({
  title,
  description,
  items,
  onToggle,
  onDelete,
  copy,
  locale
}: {
  title: string;
  description: string;
  items: ApiKey[];
  onToggle: (item: ApiKey) => void;
  onDelete: (item: ApiKey) => void;
  copy: { empty: string; nickname: string; key: string; uses: string; lastUse: string; activeHeading: string; error: string; enableKey: string; removeKey: string };
  locale: "pt-BR" | "en";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{copy.nickname}</TableHead>
                <TableHead>{copy.key}</TableHead>
                <TableHead className="w-24">{copy.uses}</TableHead>
                <TableHead className="w-32">{copy.lastUse}</TableHead>
                <TableHead className="w-24">{copy.activeHeading}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {item.label}
                    {item.last_error ? (
                      <Badge variant="destructive" className="ml-2">
                        {copy.error}
                      </Badge>
                    ) : null}
                    {item.last_error ? (
                      <p className="mt-0.5 line-clamp-1 text-xs text-destructive">{item.last_error}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.masked}</TableCell>
                  <TableCell className="font-mono tabular-nums">{item.use_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(item.last_used_at, locale)}</TableCell>
                  <TableCell>
                    <Switch
                      checked={item.enabled}
                      onCheckedChange={() => onToggle(item)}
                      aria-label={`${copy.enableKey} ${item.label}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(item)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`${copy.removeKey} ${item.label}`}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
