import * as React from "react";
import { FileText, Loader2, RotateCcw, Save, ShieldCheck, Sparkles } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { useCooldown } from "@/hooks/useCooldown";
import { useProfile } from "@/lib/profile-store";
import { formatFullDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ProfileSectionFields } from "@/components/ProfileFields";

const DEMOGRAPHIC_LABELS: Record<string, string> = {
  pcd: "PCD",
  veterano: "Veterano",
  genero: "Gênero",
  identidade_de_genero: "Identidade de gênero",
  raca_etnia: "Raça/etnia",
  orientacao_sexual: "Orientação sexual"
};

export function ProfilePage() {
  const toast = useToast();
  const { data, loading, refresh, setData } = useProfile();

  const [profile, setProfile] = React.useState<Record<string, any>>({});
  const [resumeText, setResumeText] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [extracting, setExtracting] = React.useState(false);
  const [baseline, setBaseline] = React.useState("");
  const cooldown = useCooldown();

  React.useEffect(() => {
    if (!data) return;
    setProfile(data.profile);
    setResumeText(data.resume_text);
    setBaseline(JSON.stringify({ profile: data.profile, resume_text: data.resume_text }));
  }, [data]);

  const dirty = baseline !== "" && JSON.stringify({ profile, resume_text: resumeText }) !== baseline;

  async function save() {
    setSaving(true);
    try {
      await api.saveProfile({ profile, resume_text: resumeText });
      const payload = await refresh();
      if (payload) setData(payload);
      toast({ title: "Perfil salvo", description: "Vale para a próxima execução dos agentes.", variant: "success" });
    } catch (error) {
      toast({ title: "Erro ao salvar", description: (error as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function reextract() {
    setExtracting(true);
    try {
      const result = await api.extractProfile(resumeText);
      // Only fills what is still empty, so manual corrections are never overwritten.
      setProfile((current) => mergeKeepingEdits(current, result.profile));
      toast({
        title: "Campos vazios preenchidos",
        description: "Suas edições manuais foram mantidas.",
        variant: "success"
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) cooldown.start(error.retryAfter ?? 30);
      toast({ title: "Não foi possível analisar", description: (error as Error).message, variant: "error" });
    } finally {
      setExtracting(false);
    }
  }

  async function resetOnboarding() {
    try {
      await api.resetOnboarding();
      const payload = await refresh();
      if (payload) setData(payload);
      toast({ title: "Onboarding reaberto", variant: "success" });
    } catch (error) {
      toast({ title: "Erro", description: (error as Error).message, variant: "error" });
    }
  }

  if (loading && !data) return <div className="h-64 animate-pulse rounded-xl border border-border bg-card/50" />;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Dados usados pelos agentes</CardTitle>
            <CardDescription>
              Concluído em {formatFullDateTime(data?.onboarding_completed_at)} · última alteração{" "}
              {formatFullDateTime(data?.updated_at)}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={resetOnboarding}>
              <RotateCcw />
              Refazer onboarding
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Salvar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data?.declared_demographics ?? {}).map(([key, value]) => (
              <Badge key={key} variant={value === "nao_declarado" ? "outline" : "default"}>
                {DEMOGRAPHIC_LABELS[key] ?? key}: {value === "nao_declarado" ? "não declarado" : value}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Campos não declarados fazem o agente recusar vagas exclusivas daquele grupo e responder "prefiro não
            informar" nos formulários.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            Currículo
          </CardTitle>
          <CardDescription>Enviado aos agentes junto com os campos estruturados abaixo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="profile-resume" className="sr-only">
              Currículo
            </Label>
            <Textarea
              id="profile-resume"
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              className="min-h-48 font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={reextract}
            disabled={extracting || cooldown.active || resumeText.trim().length < 40}
          >
            {extracting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {cooldown.active ? `Aguarde ${cooldown.remaining}s` : "Preencher campos vazios pelo currículo"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Preencher só altera o formulário. As mudanças valem depois de clicar em Salvar.
          </p>
        </CardContent>
      </Card>

      {(data?.sections ?? []).map((section) => (
        <Card key={section.key} className={cn(section.sensitive && "border-primary/40")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {section.sensitive ? <ShieldCheck className="size-4 text-primary" /> : null}
              {section.label}
            </CardTitle>
            {section.description ? <CardDescription>{section.description}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            <ProfileSectionFields section={section} profile={profile} onChange={setProfile} />
          </CardContent>
        </Card>
      ))}

      <div className="flex items-center gap-3 pb-4">
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Salvar alterações
        </Button>
        {dirty ? <span className="text-xs text-muted-foreground">Há alterações não salvas.</span> : null}
      </div>
    </div>
  );
}

/** Fills only empty destinations, so a manual correction is never clobbered. */
function mergeKeepingEdits(current: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
  const isEmpty = (value: any) =>
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);

  const merged: Record<string, any> = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = mergeKeepingEdits(current?.[key] || {}, value);
    } else if (isEmpty(current?.[key]) && !isEmpty(value)) {
      merged[key] = value;
    }
  }
  return merged;
}
