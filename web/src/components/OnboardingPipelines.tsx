import * as React from "react";
import { CalendarClock, Check, FileText, Loader2 } from "lucide-react";
import { api, type ResumeDocument } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { PipelineCard } from "@/components/PipelineCard";
import { ResumeUploads } from "@/components/ResumeUploads";
import { localizedError, useI18n } from "@/lib/i18n";

/**
 * Second onboarding step: when the agent runs, and what it has to send.
 *
 * Scheduling appears here rather than being discovered later in settings,
 * because "how often does this thing act on my behalf" is the question a first
 * run should answer before it starts. The résumé library sits next to it for
 * the same reason: the pipelines shown here are exactly the ones that cannot
 * apply or email without a document.
 */
export function OnboardingPipelines({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const pipelines = usePolling(api.listPipelines, 0);
  const [resumes, setResumes] = React.useState<ResumeDocument[]>([]);
  const [finishing, setFinishing] = React.useState(false);

  React.useEffect(() => {
    api.listResumes().then((result) => setResumes(result.items)).catch(() => {});
  }, []);

  async function finish() {
    setFinishing(true);
    try {
      await api.completeOnboarding();
      onFinish();
    } catch (error) {
      toast({ title: t("onboarding.finishError"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setFinishing(false);
    }
  }

  const gate = pipelines.data?.profile_gate ?? null;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            {t("onboarding.resumesTitle")}
          </CardTitle>
          <CardDescription>{t("onboarding.resumesDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResumeUploads resumes={resumes} onChange={setResumes} />
          {!resumes.length ? (
            <p className="mt-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
              {t("onboarding.resumesRequired")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CalendarClock className="size-4" />
          {t("onboarding.scheduleTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.scheduleDescription")}</p>
      </div>

      <div className="space-y-4">
        {pipelines.data?.items.map((schedule) => (
          <PipelineCard key={schedule.pipeline} schedule={schedule} gate={gate} onSaved={pipelines.refresh} />
        ))}
        {pipelines.loading && !pipelines.data ? (
          <div className="h-56 animate-pulse rounded-xl border border-border bg-card/50" />
        ) : null}
      </div>

      <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center gap-3 border-t border-border bg-background/90 px-6 py-3 backdrop-blur">
        <Button onClick={finish} disabled={finishing}>
          {finishing ? <Loader2 className="animate-spin" /> : <Check />}
          {t("onboarding.finish")}
        </Button>
        <Button variant="ghost" onClick={onBack} disabled={finishing}>
          {t("onboarding.back")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("onboarding.changeLater")}</span>
      </div>
    </div>
  );
}
