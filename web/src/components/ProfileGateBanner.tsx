import { FileWarning, TriangleAlert, UserPen } from "lucide-react";
import type { ProfileGate, ResumeGate } from "@/lib/api";
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
  onGoToProfile
}: {
  gate?: ProfileGate | null;
  resumeGate?: ResumeGate | null;
  onGoToProfile?: () => void;
}) {
  const { t } = useI18n();

  const profileBlocked = Boolean(gate && !gate.ready);
  const resumeBlocked = Boolean(resumeGate && !resumeGate.ready);
  if (!profileBlocked && !resumeBlocked) return null;

  // An incomplete profile blocks strictly more than a missing résumé, so it is
  // the one worth naming when both are open.
  const Icon = profileBlocked ? TriangleAlert : FileWarning;
  const title = profileBlocked ? t("gate.title") : t("gate.resumeTitle");
  const description = profileBlocked ? t("gate.description") : t("gate.resumeDescription");
  const cta = profileBlocked ? t("gate.cta") : t("gate.resumeCta");

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-warning" />
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
      {onGoToProfile ? (
        <Button size="sm" onClick={onGoToProfile}>
          <UserPen />
          {cta}
        </Button>
      ) : null}
    </div>
  );
}
