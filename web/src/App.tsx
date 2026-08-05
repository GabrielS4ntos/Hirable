import * as React from "react";
import { Activity, Briefcase, KeyRound, Moon, Settings2, Sun, UserRound } from "lucide-react";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { ProfileProvider, useProfile } from "@/lib/profile-store";
import { DashboardPage } from "@/pages/DashboardPage";
import { JobsPage } from "@/pages/JobsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { KeysPage } from "@/pages/KeysPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { OnboardingPage } from "@/pages/OnboardingPage";

const NAV = [
  { id: "painel", label: "Painel", icon: Activity, Component: DashboardPage },
  { id: "vagas", label: "Vagas analisadas", icon: Briefcase, Component: JobsPage },
  { id: "perfil", label: "Perfil", icon: UserRound, Component: ProfilePage },
  { id: "configuracoes", label: "Configurações", icon: Settings2, Component: SettingsPage },
  { id: "chaves", label: "Chaves de API", icon: KeyRound, Component: KeysPage }
] as const;

type RouteId = (typeof NAV)[number]["id"];

function useHashRoute(): [RouteId, (id: RouteId) => void] {
  const read = (): RouteId => {
    const hash = window.location.hash.replace(/^#\/?/, "");
    return (NAV.find((item) => item.id === hash)?.id ?? "painel") as RouteId;
  };
  const [route, setRoute] = React.useState<RouteId>(read);

  React.useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return [route, (id: RouteId) => { window.location.hash = `/${id}`; }];
}

function useTheme() {
  const [theme, setTheme] = React.useState<"dark" | "light">(
    () => (localStorage.getItem("theme") as "dark" | "light") || "dark"
  );
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((current) => (current === "dark" ? "light" : "dark")) };
}

export function App() {
  return (
    <ToastProvider>
      <ProfileProvider>
        <AppShell />
      </ProfileProvider>
    </ToastProvider>
  );
}

function AppShell() {
  const [route, navigate] = useHashRoute();
  const { theme, toggle } = useTheme();
  const { onboardingComplete, loading: profileLoading } = useProfile();
  // Polling only starts once onboarding is done: nothing runs before that anyway.
  const status = usePolling(api.status, onboardingComplete ? 5000 : 0);
  const active = NAV.find((item) => item.id === route) ?? NAV[0];
  const running = status.data?.scheduler.running;

  if (onboardingComplete === null && profileLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (onboardingComplete === false) {
    return (
      <TooltipProvider delayDuration={200}>
        <OnboardingPage />
      </TooltipProvider>
    );
  }

  return (
      <TooltipProvider delayDuration={200}>
        <div className="flex min-h-screen flex-col bg-background lg:flex-row">
          <aside className="flex shrink-0 flex-col gap-6 border-b border-border bg-card/40 px-4 py-5 lg:w-64 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  in
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-semibold">LinkedIn Agent</p>
                  <p className="text-xs text-muted-foreground">console local</p>
                </div>
              </div>
              <button
                onClick={toggle}
                aria-label="Alternar tema"
                className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            </div>

            <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {NAV.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === route;
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                      isActive
                        ? "bg-primary/12 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div className="mt-auto hidden space-y-2 text-xs text-muted-foreground lg:block">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    status.error ? "bg-destructive" : running ? "animate-pulse bg-warning" : "bg-success"
                  )}
                />
                {status.error ? "servidor offline" : running ? `executando ${running.pipeline}` : "scheduler ocioso"}
              </div>
              {status.data ? <p className="font-mono">{status.data.timezone}</p> : null}
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
              <div>
                <h1 className="text-lg font-semibold tracking-tight">{active.label}</h1>
                <p className="text-xs text-muted-foreground">
                  {status.data
                    ? `${status.data.keys.gemini} chave(s) Gemini · ${status.data.keys.openrouter} OpenRouter · fallback ${status.data.model_gate.fallback_provider ?? "desativado"}`
                    : "carregando…"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {running ? (
                  <Badge variant="warning" className="gap-1.5">
                    <span className="size-1.5 animate-pulse rounded-full bg-current" />
                    {running.pipeline} em execução
                  </Badge>
                ) : null}
                {status.data?.scheduler.queued.length ? (
                  <Badge variant="secondary">{status.data.scheduler.queued.length} na fila</Badge>
                ) : null}
              </div>
            </header>

            <div className="animate-in-up px-6 py-6" key={route}>
              <active.Component status={status.data} refreshStatus={status.refresh} />
            </div>
          </main>
        </div>
      </TooltipProvider>
  );
}
