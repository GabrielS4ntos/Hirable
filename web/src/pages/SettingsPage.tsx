import { BellRing, Plug, SlidersHorizontal, Workflow } from "lucide-react";
import { api } from "@/lib/api";
import { ProfileGateBanner } from "@/components/ProfileGateBanner";
import { usePolling } from "@/hooks/usePolling";
import type { PageProps } from "@/lib/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PipelineCard } from "@/components/PipelineCard";
import { GoogleIntegrationCard } from "@/components/GoogleIntegrationCard";
import { LinkedInCard } from "@/components/LinkedInCard";
import { GeneralSettingsCard } from "@/components/GeneralSettingsCard";
import { AlertsCard } from "@/components/AlertsCard";
import { useI18n } from "@/lib/i18n";

/**
 * Settings, in four tabs.
 *
 * This screen used to be six full-height cards in one column, which meant the
 * pipeline schedules — the thing people come here to change — sat below a fold
 * that took several scrolls to reach. Grouping by intent puts each card back at
 * the top of its own page.
 */
export function SettingsPage(_props: PageProps) {
  const { t } = useI18n();
  const pipelines = usePolling(api.listPipelines, 8000);
  const gate = pipelines.data?.profile_gate ?? null;
  const resumeGate = pipelines.data?.resume_gate ?? null;
  const linkedinGate = pipelines.data?.linkedin_gate ?? null;

  const tabs = [
    { value: "integracoes", label: t("settings.tabIntegrations"), icon: Plug },
    { value: "pipelines", label: t("settings.tabPipelines"), icon: Workflow },
    { value: "alertas", label: t("settings.tabAlerts"), icon: BellRing },
    { value: "geral", label: t("settings.tabGeneral"), icon: SlidersHorizontal }
  ];

  return (
    <div className="space-y-5">
      <ProfileGateBanner
        gate={gate}
        resumeGate={resumeGate}
        linkedinGate={linkedinGate}
        onGoToProfile={() => { window.location.hash = "/perfil"; }}
        onGoToSettings={() => { window.location.hash = "/configuracoes"; }}
      />

      <Tabs defaultValue="integracoes">
        <TabsList className="h-auto flex-wrap justify-start gap-1 p-1">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5 px-3 py-1.5">
              <tab.icon className="size-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="integracoes" className="space-y-4">
          <LinkedInCard onChange={pipelines.refresh} />
          <GoogleIntegrationCard />
        </TabsContent>

        <TabsContent value="pipelines" className="space-y-4">
          {pipelines.data?.items.map((schedule) => (
            <PipelineCard key={schedule.pipeline} schedule={schedule} gate={gate} onSaved={pipelines.refresh} />
          ))}
          {pipelines.loading && !pipelines.data ? <SkeletonCard /> : null}
          {pipelines.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {pipelines.error}
            </p>
          ) : null}
        </TabsContent>

        <TabsContent value="alertas">
          <AlertsCard />
        </TabsContent>

        <TabsContent value="geral">
          <GeneralSettingsCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SkeletonCard() {
  return <div className="h-56 animate-pulse rounded-xl border border-border bg-card/50" />;
}
