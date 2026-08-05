import * as React from "react";
import { ArrowRight, Check, FileText, Loader2, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { useCooldown } from "@/hooks/useCooldown";
import { useProfile } from "@/lib/profile-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ProfileSectionFields } from "@/components/ProfileFields";
import { cn } from "@/lib/utils";

const MIN_RESUME_CHARS = 40;

/**
 * First-run flow: paste the resume, let the agent pre-fill everything, review and
 * confirm. Nothing runs automatically until this is finished, because the agents
 * need the declared facts — especially the sensitive ones — to decide safely.
 */
export function OnboardingPage() {
  const toast = useToast();
  const { data, refresh, setData } = useProfile();

  const [step, setStep] = React.useState<"resume" | "review">("resume");
  const [resumeText, setResumeText] = React.useState("");
  const [profile, setProfile] = React.useState<Record<string, any>>({});
  const [extracting, setExtracting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [filledFields, setFilledFields] = React.useState<string[]>([]);
  const [missing, setMissing] = React.useState<string[]>([]);
  const cooldown = useCooldown();

  React.useEffect(() => {
    if (!data) return;
    setResumeText((current) => current || data.resume_text);
    setProfile((current) => (Object.keys(current).length ? current : data.profile));
  }, [data]);

  const canExtract = resumeText.trim().length >= MIN_RESUME_CHARS;
  const sections = data?.sections ?? [];

  async function handleExtract() {
    setExtracting(true);
    try {
      const result = await api.extractProfile(resumeText);
      setProfile(result.profile);
      setWarnings(result.warnings || []);
      setFilledFields(collectFilledPaths(result.profile, sections));
      setMissing(result.completeness?.missing || []);
      setStep("review");
      toast({
        title: "Campos preenchidos",
        description: "Revise tudo antes de concluir. O agente só extrai o que está escrito no texto.",
        variant: "success"
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) cooldown.start(error.retryAfter ?? 30);
      toast({ title: "Não foi possível analisar o currículo", description: (error as Error).message, variant: "error" });
    } finally {
      setExtracting(false);
    }
  }

  async function handleFinish() {
    setSaving(true);
    try {
      const result = await api.saveProfile({ profile, resume_text: resumeText, complete_onboarding: true });
      setMissing(result.completeness.missing);
      const payload = await refresh();
      if (payload) setData(payload);

      if (result.completeness.complete) {
        toast({ title: "Onboarding concluído", description: "Os agentes já usam estes dados.", variant: "success" });
      } else {
        // The data was persisted anyway; only the completion flag was withheld.
        toast({
          title: "Dados salvos, mas faltam campos",
          description: `Preencha para concluir: ${result.completeness.missing.join(", ")}`,
          variant: "error"
        });
      }
    } catch (error) {
      toast({ title: "Erro ao concluir", description: (error as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    setSaving(true);
    try {
      await api.saveProfile({ profile, resume_text: resumeText });
      toast({ title: "Rascunho salvo", variant: "success" });
    } catch (error) {
      toast({ title: "Erro ao salvar", description: (error as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
            in
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Vamos configurar seu perfil</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Os agentes usam estes dados para avaliar vagas, responder mensagens e preencher formulários. Leva
              dois minutos.
            </p>
          </div>
        </header>

        <ol className="mb-8 flex items-center gap-3 text-sm">
          <StepPill index={1} label="Currículo" active={step === "resume"} done={step === "review"} />
          <div className="h-px flex-1 bg-border" />
          <StepPill index={2} label="Revisão" active={step === "review"} done={false} />
        </ol>

        {step === "resume" ? (
          <Card className="animate-in-up">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4" />
                Cole o texto do seu currículo
              </CardTitle>
              <CardDescription>
                Copie o conteúdo do seu currículo (PDF, Word ou LinkedIn) e cole aqui. O agente vai ler o texto e
                preencher os campos do perfil para você revisar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="resume">Currículo</Label>
                <Textarea
                  id="resume"
                  value={resumeText}
                  onChange={(event) => setResumeText(event.target.value)}
                  placeholder="Cole aqui o texto completo do currículo…"
                  className="min-h-72 font-mono text-xs leading-relaxed"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {resumeText.trim().length} caracteres
                  {canExtract ? "" : ` · mínimo ${MIN_RESUME_CHARS} para continuar`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleExtract} disabled={!canExtract || extracting || cooldown.active}>
                  {extracting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  {cooldown.active ? `Aguarde ${cooldown.remaining}s` : "Preencher"}
                </Button>
                <Button variant="ghost" onClick={() => setStep("review")} disabled={extracting}>
                  Preencher manualmente
                  <ArrowRight />
                </Button>
              </div>

              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Preencher apenas sugere os campos para você revisar — nada é gravado até você salvar. O texto colado
                é tratado como dado, nunca como instrução, e fica somente no seu banco local.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="animate-in-up space-y-5">
            {warnings.length ? (
              <Card className="border-warning/40">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <TriangleAlert className="size-4 text-warning" />
                    O currículo não trazia tudo
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {sections.map((section) => (
              <Card key={section.key} className={cn(section.sensitive && "border-primary/40")}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {section.sensitive ? <ShieldCheck className="size-4 text-primary" /> : null}
                    {section.label}
                  </CardTitle>
                  {section.description ? <CardDescription>{section.description}</CardDescription> : null}
                </CardHeader>
                <CardContent>
                  <ProfileSectionFields
                    section={section}
                    profile={profile}
                    onChange={setProfile}
                    highlight={filledFields}
                  />
                </CardContent>
              </Card>
            ))}

            {missing.length ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Faltam campos obrigatórios: {missing.join(", ")}
              </p>
            ) : null}

            <Separator />

            <div className="flex flex-wrap items-center gap-3 pb-10">
              <Button onClick={handleFinish} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Check />}
                Concluir onboarding
              </Button>
              <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
                Salvar rascunho
              </Button>
              <Button variant="ghost" onClick={() => setStep("resume")} disabled={saving}>
                Voltar ao currículo
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepPill({ index, label, active, done }: { index: number; label: string; active: boolean; done: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          "grid size-6 place-items-center rounded-full text-xs font-semibold",
          done ? "bg-success text-success-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {done ? <Check className="size-3.5" /> : index}
      </span>
      <span className={cn("font-medium", active || done ? "text-foreground" : "text-muted-foreground")}>{label}</span>
      {done ? <Badge variant="success">ok</Badge> : null}
    </li>
  );
}

/** Paths the extraction actually filled, so the review can highlight them. */
function collectFilledPaths(profile: Record<string, any>, sections: { key: string; fields: { key: string }[] }[]) {
  const flat = ["identity", "professional", "work_eligibility", "demographics"];
  const paths: string[] = [];
  for (const section of sections) {
    for (const field of section.fields) {
      const value = flat.includes(section.key) ? profile?.[section.key]?.[field.key] : profile?.[field.key];
      const empty =
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
      if (!empty) paths.push(`${section.key}.${field.key}`);
    }
  }
  return paths;
}
