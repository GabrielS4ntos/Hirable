import { TriangleAlert, UserPen } from "lucide-react";
import type { ProfileGate } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/**
 * Shown wherever a pipeline could be armed or started. The server refuses these
 * actions on its own; this only explains why the controls are disabled.
 */
export function ProfileGateBanner({ gate, onGoToProfile }: { gate: ProfileGate | null | undefined; onGoToProfile?: () => void }) {
  const { t } = useI18n();
  if (!gate || gate.ready) return null;

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="min-w-56 flex-1 space-y-1">
        <p className="text-sm font-semibold">{t("gate.title")}</p>
        <p className="text-sm text-muted-foreground">{t("gate.description")}</p>
        {gate.missing.length ? (
          <p className="text-xs text-muted-foreground">{t("gate.missing", { count: gate.missing.length })}</p>
        ) : null}
      </div>
      {onGoToProfile ? (
        <Button size="sm" onClick={onGoToProfile}>
          <UserPen />
          {t("gate.cta")}
        </Button>
      ) : null}
    </div>
  );
}
