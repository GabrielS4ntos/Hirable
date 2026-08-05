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

export function KeysPage({ refreshStatus }: PageProps) {
  const toast = useToast();
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
      toast({ title: "Chave salva", description: "Os pipelines já usam esta chave na próxima execução.", variant: "success" });
    } catch (error) {
      toast({ title: "Erro ao salvar chave", description: (error as Error).message, variant: "error" });
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
      toast({ title: "Erro", description: (error as Error).message, variant: "error" });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Providers de modelo</CardTitle>
          <CardDescription>
            O principal recebe todas as chamadas; o fallback assume quando ele falha por cota. Com dois providers
            configurados, escolher o principal define o outro como fallback automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProviderCards providers={providers} onChange={setProviders} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4" />
            Nova chave
          </CardTitle>
          <CardDescription>
            As chaves ficam no SQLite local (arquivo com permissão 600) e têm prioridade sobre{" "}
            <code className="font-mono text-xs">secrets/.env</code>. Chaves Gemini são usadas em round-robin; a
            OpenRouter é o fallback quando todas as Gemini falham por cota.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addKey} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[10rem_1fr_2fr_auto]">
            <div className="space-y-1.5">
              <Label>Provedor</Label>
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
              <Label htmlFor="key-label">Apelido</Label>
              <Input
                id="key-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="conta pessoal"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="key-secret">Chave</Label>
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
                Adicionar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {providers.map((provider) => (
        <KeyTable
          key={provider.id}
          title={provider.label}
          description={`${items.filter((item) => item.provider === provider.id && item.enabled).length} ativa(s)${
            provider.role === "primary" ? " · principal" : provider.role === "fallback" ? " · fallback" : ""
          }`}
          items={items.filter((item) => item.provider === provider.id)}
          onToggle={(item) => mutate(api.updateKey(item.id, { enabled: !item.enabled }), item.enabled ? "Chave desativada" : "Chave ativada")}
          onDelete={(item) => mutate(api.deleteKey(item.id), "Chave removida")}
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
  onDelete
}: {
  title: string;
  description: string;
  items: ApiKey[];
  onToggle: (item: ApiKey) => void;
  onDelete: (item: ApiKey) => void;
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
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma chave cadastrada. O agente cai para as variáveis de ambiente em{" "}
            <code className="font-mono text-xs">secrets/.env</code>.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Apelido</TableHead>
                <TableHead>Chave</TableHead>
                <TableHead className="w-24">Usos</TableHead>
                <TableHead className="w-32">Último uso</TableHead>
                <TableHead className="w-24">Ativa</TableHead>
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
                        erro
                      </Badge>
                    ) : null}
                    {item.last_error ? (
                      <p className="mt-0.5 line-clamp-1 text-xs text-destructive">{item.last_error}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.masked}</TableCell>
                  <TableCell className="font-mono tabular-nums">{item.use_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(item.last_used_at)}</TableCell>
                  <TableCell>
                    <Switch
                      checked={item.enabled}
                      onCheckedChange={() => onToggle(item)}
                      aria-label={`Ativar chave ${item.label}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(item)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remover chave ${item.label}`}
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
