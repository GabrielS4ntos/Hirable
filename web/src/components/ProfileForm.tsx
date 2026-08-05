import * as React from "react";
import { Check, FileText, Loader2, Save, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { ApiError, api, type ModelProvider, type ResumeDocument } from "@/lib/api";
import { useCooldown } from "@/hooks/useCooldown";
import { useProfile } from "@/lib/profile-store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ProfileSectionFields } from "@/components/ProfileFields";
import { ResumeUploads } from "@/components/ResumeUploads";
import { ResumeSourcePicker, type ResumeSource } from "@/components/ResumeSourcePicker";
import { sha256Hex } from "@/lib/hash";
import { ProviderCards } from "@/components/ProviderCards";
import { localizedError, profileMetadata, useI18n, type Translate } from "@/lib/i18n";

const MIN_RESUME_CHARS = 40;

const DEMOGRAPHIC_KEYS: Record<string, Parameters<Translate>[0]> = {
  pcd: "profile.demographic.pcd", veterano: "profile.demographic.veteran", genero: "profile.demographic.gender",
  identidade_de_genero: "profile.demographic.genderIdentity", raca_etnia: "profile.demographic.race",
  orientacao_sexual: "profile.demographic.orientation"
};

/**
 * The single profile form, used by both the onboarding and the profile screen.
 *
 * Everything is on one page: paste the résumé, press Preencher to have an agent
 * fill the fields, edit whatever is wrong, then save. Filling never writes —
 * only Salvar does.
 */
export function ProfileForm({ mode, onSaved }: { mode: "onboarding" | "profile"; onSaved?: () => void }) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const { data, loading, refresh, setData } = useProfile();
  const cooldown = useCooldown();

  const [profile, setProfile] = React.useState<Record<string, any>>({});
  const [resumeText, setResumeText] = React.useState("");
  const [resumes, setResumes] = React.useState<ResumeDocument[]>([]);
  const [providers, setProviders] = React.useState<ModelProvider[]>([]);
  const [extracting, setExtracting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [filledFields, setFilledFields] = React.useState<string[]>([]);
  const [missing, setMissing] = React.useState<string[]>([]);
  const [baseline, setBaseline] = React.useState("");
  const [source, setSource] = React.useState<ResumeSource>("text");
  const [textHash, setTextHash] = React.useState("");

  React.useEffect(() => {
    if (!data) return;
    setProfile((current) => (Object.keys(current).length ? current : data.profile));
    setResumeText((current) => current || data.resume_text);
    setBaseline(JSON.stringify({ profile: data.profile, resume_text: data.resume_text }));
  }, [data]);

  React.useEffect(() => {
    api.listResumes().then((result) => setResumes(result.items)).catch(() => {});
    api.listProviders().then((result) => setProviders(result.items)).catch(() => {});
  }, []);

  // Hashing here mirrors what the server records after a run, so "changed since
  // last time" is decided by the same value on both sides.
  React.useEffect(() => {
    let active = true;
    sha256Hex(resumeText).then((hash) => { if (active) setTextHash(hash); });
    return () => { active = false; };
  }, [resumeText]);

  const sections = data?.sections ?? [];
  const hasProvider = providers.some((provider) => provider.role === "primary");
  const isOnboarding = mode === "onboarding";
  const dirty = baseline !== "" && JSON.stringify({ profile, resume_text: resumeText }) !== baseline;

  // Onboarding keeps exactly one file, so it is always the one to read from.
  const onboardingResume = resumes[0] ?? null;
  const lastExtraction = data?.last_extraction ?? null;

  // Re-running over the same résumé costs a model call and returns the same
  // fields, so the button waits for the source to actually change.
  const sourceReady = source === "text" ? resumeText.trim().length >= MIN_RESUME_CHARS : Boolean(onboardingResume);
  const sourceChanged =
    source === "text"
      ? !lastExtraction || lastExtraction.hash !== textHash
      : !lastExtraction || lastExtraction.source !== "file" || lastExtraction.resume_id !== onboardingResume?.id;
  const canExtract = sourceReady && hasProvider && sourceChanged;

  async function fillFromResume() {
    setExtracting(true);
    try {
      const result = await api.extractProfile(
        source === "file" && onboardingResume ? { resume_id: onboardingResume.id } : { resume_text: resumeText }
      );
      // Fields are replaced in place: the user reviews and edits before saving.
      setProfile(result.profile);
      // Text read out of the file is kept so the agents get the same résumé the
      // extraction saw, even when the source was an upload.
      if (result.resume_text) setResumeText(result.resume_text);
      setWarnings(result.warnings || []);
      setFilledFields(collectFilledPaths(result.profile, sections));
      setMissing(result.completeness?.missing || []);
      if (result.last_extraction) setData({ ...(data as any), last_extraction: result.last_extraction });
      toast({
        title: t("profile.filled"),
        description: t("profile.filledDescription"),
        variant: "success"
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) cooldown.start(error.retryAfter ?? 30);
      toast({ title: t("profile.analyzeError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      // Onboarding no longer finishes here: the flag is flipped by the pipeline
      // step, so the first run always passes through scheduling.
      const result = await api.saveProfile({
        profile,
        resume_text: resumeText,
        complete_onboarding: false
      });
      setMissing(result.completeness.missing);

      const payload = await refresh();
      if (payload) setData(payload);
      setBaseline(JSON.stringify({ profile: result.profile, resume_text: resumeText }));

      if (isOnboarding && !result.completeness.complete) {
        // The data was persisted; only the advance is withheld.
        toast({
          title: t("profile.savedIncomplete"),
          description: t("profile.completeFields", { fields: result.completeness.missing.join(", ") }),
          variant: "error"
        });
      } else {
        toast({
          title: isOnboarding ? t("profile.ready") : t("profile.saved"),
          description: t("profile.agentsUseData"),
          variant: "success"
        });
        if (isOnboarding) onSaved?.();
      }
    } catch (error) {
      toast({ title: t("profile.saveError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <div className="h-64 animate-pulse rounded-xl border border-border bg-card/50" />;

  return (
    <div className="space-y-5">
      {!isOnboarding ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("profile.declared")}</CardTitle>
            <CardDescription>
              {t("profile.declaredDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data?.declared_demographics ?? {}).map(([key, value]) => (
                <Badge key={key} variant={value === "nao_declarado" ? "outline" : "default"}>
                  {DEMOGRAPHIC_KEYS[key] ? t(DEMOGRAPHIC_KEYS[key]) : key}: {value === "nao_declarado" ? t("profile.notDeclared") : value}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className={!providers.some((provider) => provider.configured) ? "border-primary/40" : undefined}>
        <CardHeader>
          <CardTitle>{t("profile.providerTitle")}</CardTitle>
          <CardDescription>{t("profile.providerDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProviderCards providers={providers} onChange={setProviders} compact />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            {t("profile.resume")}
          </CardTitle>
          <CardDescription>
            {t("profile.resumeDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isOnboarding ? (
            <ResumeSourcePicker
              source={source}
              onSourceChange={setSource}
              resumeText={resumeText}
              onResumeTextChange={setResumeText}
              resume={onboardingResume}
              onResumeChange={setResumes}
              minChars={MIN_RESUME_CHARS}
            />
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="resume-text">{t("profile.resumeText")}</Label>
              <Textarea
                id="resume-text"
                value={resumeText}
                onChange={(event) => setResumeText(event.target.value)}
                placeholder={t("profile.resumePlaceholder")}
                className="min-h-56 font-mono text-xs leading-relaxed"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                {t("profile.characters", { count: resumeText.trim().length })}
                {sourceReady ? "" : t("profile.minimum", { count: MIN_RESUME_CHARS })}
              </p>
            </div>
          )}

          <div className="space-y-2">
            {/* One button for both sources: what changes is where it reads from. */}
            <Button onClick={fillFromResume} disabled={!canExtract || extracting || cooldown.active}>
              {extracting ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {cooldown.active ? t("profile.wait", { seconds: cooldown.remaining }) : t("profile.fill")}
            </Button>
            {!hasProvider ? (
              <p className="text-xs text-muted-foreground">{t("profile.providerRequired")}</p>
            ) : sourceReady && !sourceChanged ? (
              <p className="text-xs text-muted-foreground">
                {source === "file" ? t("profile.sameFile") : t("profile.sameText")}
              </p>
            ) : null}
          </div>

          {warnings.length ? (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
                <TriangleAlert className="size-4" />
                {t("profile.incompleteResume")}
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!isOnboarding ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("profile.resumeFiles")}</CardTitle>
            <CardDescription>
              {t("profile.resumeFilesDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResumeUploads resumes={resumes} onChange={setResumes} />
          </CardContent>
        </Card>
      ) : null}

      {sections.map((section) => (
        <Card key={section.key} className={cn(section.sensitive && "border-primary/40")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {section.sensitive ? <ShieldCheck className="size-4 text-primary" /> : null}
              {profileMetadata("section", section.key, section.label, locale, "label")}
            </CardTitle>
            {section.description ? <CardDescription>{profileMetadata("section", section.key, section.description, locale, "description")}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            <ProfileSectionFields section={section} profile={profile} onChange={setProfile} highlight={filledFields} />
          </CardContent>
        </Card>
      ))}

      {missing.length ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t("profile.missing", { fields: missing.join(", ") })}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t border-border bg-background/90 px-6 py-3 backdrop-blur">
        <Button onClick={save} disabled={saving || (!isOnboarding && !dirty)}>
          {saving ? <Loader2 className="animate-spin" /> : isOnboarding ? <Check /> : <Save />}
          {isOnboarding ? t("profile.continue") : t("profile.saveChanges")}
        </Button>
        {dirty ? <span className="text-xs text-muted-foreground">{t("profile.unsaved")}</span> : null}
      </div>
    </div>
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
