import { api } from "@/lib/api";
import { ProfileGateBanner } from "@/components/ProfileGateBanner";
import { usePolling } from "@/hooks/usePolling";
import type { PageProps } from "@/lib/page";
import { PipelineCard } from "@/components/PipelineCard";
import { GoogleIntegrationCard } from "@/components/GoogleIntegrationCard";
import { GeneralSettingsCard } from "@/components/GeneralSettingsCard";
import { AlertsCard } from "@/components/AlertsCard";

export function SettingsPage(_props: PageProps) {
  const pipelines = usePolling(api.listPipelines, 8000);
  const gate = pipelines.data?.profile_gate ?? null;
  const resumeGate = pipelines.data?.resume_gate ?? null;

  return (
    <div className="space-y-6">
      <ProfileGateBanner gate={gate} resumeGate={resumeGate} onGoToProfile={() => { window.location.hash = "/perfil"; }} />

      <GoogleIntegrationCard />

      <AlertsCard />

      <GeneralSettingsCard />

      <div className="space-y-4">
        {pipelines.data?.items.map((schedule) => (
          <PipelineCard key={schedule.pipeline} schedule={schedule} gate={gate} onSaved={pipelines.refresh} />
        ))}
        {pipelines.loading && !pipelines.data ? <SkeletonCard /> : null}
        {pipelines.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {pipelines.error}
          </p>
        ) : null}
      </div>

    </div>
  );
}

function SkeletonCard() {
  return <div className="h-56 animate-pulse rounded-xl border border-border bg-card/50" />;
}
