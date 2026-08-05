import { FileWarning, PlugZap, TriangleAlert, UserPen } from "lucide-react";
import type { LinkedInGate, ProfileGate, ResumeGate } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/**
 * Shown wherever a pipeline could be armed or started. The server refuses these
 * actions on its own; this only explains why the controls are disabled.
 *
 * The two gates share one banner because they share one fix — both are resolved
 * on the profile screen, and stacking two warnings for one destination would
 * read as two separate problems.
 */
export function ProfileGateBanner({
  gate,
  resumeGate,
  linkedinGate,
  onGoToProfile,
  onGoToSettings
}: {
  gate?: ProfileGate | null;
  resumeGate?: ResumeGate | null;
  linkedinGate?: LinkedInGate | null;
  onGoToProfile?: () => void;
  onGoToSettings?: () => void;
}) {
  const { t } = useI18n();

  const profileBlocked = Boolean(gate && !gate.ready);
  const resumeBlocked = Boolean(resumeGate && !resumeGate.ready);
  const linkedinBlocked = Boolean(linkedinGate && !linkedinGate.ready);
  if (!profileBlocked && !resumeBlocked && !linkedinBlocked) return null;

  // A missing LinkedIn session stops everything, including scanning, so it wins
  // the headline; an incomplete profile blocks more than a missing résumé.
  const Icon = linkedinBlocked ? PlugZap : profileBlocked ? TriangleAlert : FileWarning;
  const title = linkedinBlocked ? t("gate.linkedinTitle") : profileBlocked ? t("gate.title") : t("gate.resumeTitle");
  const description = linkedinBlocked
    ? (linkedinGate?.reason ?? t("gate.linkedinDescription"))
    : profileBlocked
      ? t("gate.description")
      : t("gate.resumeDescription");
  const cta = linkedinBlocked ? t("gate.linkedinCta") : profileBlocked ? t("gate.cta") : t("gate.resumeCta");
  const action = linkedinBlocked ? onGoToSettings : onGoToProfile;

  return (
    <div className="bg-brand-soft flex flex-wrap items-start gap-3 rounded-xl border border-primary/40 px-4 py-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-56 flex-1 space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
        {profileBlocked && gate?.missing.length ? (
          <p className="text-xs text-muted-foreground">{t("gate.missing", { count: gate.missing.length })}</p>
        ) : null}
        {profileBlocked && resumeBlocked ? (
          <p className="text-xs text-muted-foreground">{t("gate.alsoResume")}</p>
        ) : null}
      </div>
      {action ? (
        <Button size="sm" onClick={action}>
          {linkedinBlocked ? <PlugZap /> : <UserPen />}
          {cta}
        </Button>
      ) : null}
    </div>
  );
}
