import { ProfileForm } from "@/components/ProfileForm";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/**
 * First run. Same form as the profile screen, so nothing the user learns here
 * has to be relearned later — only the framing and the final button differ.
 */
export function OnboardingPage() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
            in
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{t("onboarding.title")}</h1>
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
              {t("onboarding.description")}
            </p>
          </div>
        </header>

        <ProfileForm mode="onboarding" />
      </div>
    </div>
  );
}
