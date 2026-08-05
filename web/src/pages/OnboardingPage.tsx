import * as React from "react";
import { ProfileForm } from "@/components/ProfileForm";
import { OnboardingPipelines } from "@/components/OnboardingPipelines";
import { useProfile } from "@/lib/profile-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

type Step = "profile" | "pipelines";

/**
 * First run, in two steps: who you are, then when the agent acts.
 *
 * The profile step is the same form as the profile screen — nothing learned
 * here has to be relearned later — and the pipeline step exists so the first
 * run ends with the user having seen, and chosen, how often something acts on
 * their behalf.
 */
export function OnboardingPage() {
  const { locale, setLocale, t } = useI18n();
  const { refresh, setData } = useProfile();
  const [step, setStep] = React.useState<Step>("profile");

  const steps: { id: Step; label: string }[] = [
    { id: "profile", label: t("onboarding.stepProfile") },
    { id: "pipelines", label: t("onboarding.stepPipelines") }
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
            in
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {step === "profile" ? t("onboarding.title") : t("onboarding.pipelinesTitle")}
              </h1>
              <div className="flex rounded-md border border-border p-0.5" aria-label={t("language.label")}>
                {(["pt-BR", "en"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setLocale(option)}
                    className={cn("rounded px-2 py-1 text-xs font-medium", locale === option ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                  >
                    {option === "pt-BR" ? "PT" : "EN"}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {step === "profile" ? t("onboarding.description") : t("onboarding.pipelinesDescription")}
            </p>

            <ol className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              {steps.map((item, index) => {
                const active = item.id === step;
                const done = index < steps.findIndex((entry) => entry.id === step);
                return (
                  <li key={item.id} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "grid size-5 place-items-center rounded-full border text-[11px] font-semibold",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : done
                            ? "border-success bg-success/15 text-success"
                            : "border-border text-muted-foreground"
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className={active ? "font-medium" : "text-muted-foreground"}>{item.label}</span>
                    {index < steps.length - 1 ? <span className="text-muted-foreground">›</span> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </header>

        {step === "profile" ? (
          <ProfileForm mode="onboarding" onSaved={() => setStep("pipelines")} />
        ) : (
          <OnboardingPipelines
            onBack={() => setStep("profile")}
            onFinish={async () => {
              // Flipping the flag is what hands the user to the full console.
              const payload = await refresh();
              if (payload) setData(payload);
            }}
          />
        )}
      </div>
    </div>
  );
}
