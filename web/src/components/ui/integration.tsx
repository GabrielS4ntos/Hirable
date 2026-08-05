import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shared shell for the settings screen.
 *
 * Every card here answers the same three questions — what is this, is it
 * working, what do I do about it — so they should not each invent their own
 * answer. Before this existed the LinkedIn card showed a coloured dot and the
 * Google card showed badges, which made two identical concepts look unrelated.
 */

export type IntegrationTone = "ok" | "pending" | "error" | "idle";

const DOT: Record<IntegrationTone, string> = {
  ok: "bg-success",
  pending: "bg-primary animate-pulse",
  error: "bg-destructive",
  idle: "bg-muted-foreground/50"
};

const TEXT: Record<IntegrationTone, string> = {
  ok: "text-success",
  pending: "text-primary",
  error: "text-destructive",
  idle: "text-muted-foreground"
};

/** Dot plus label. One status shape for every integration. */
export function StatusPill({ tone, label, className }: { tone: IntegrationTone; label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2 py-0.5 text-xs font-medium",
        TEXT[tone],
        className
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * An integration card: icon, name, status, description, then whatever the
 * integration needs. `attention` lifts the border when the user has to act.
 */
export function IntegrationCard({
  icon,
  title,
  description,
  status,
  attention = false,
  children,
  className
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  status?: React.ReactNode;
  attention?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn(attention && "border-primary/45", className)}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <CardTitle className="flex items-center gap-2">
            {/* Always the brand white, in both themes: these read as product
                tiles, and a chip that flips to dark reads as a disabled button. */}
            {icon ? (
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white text-brand-blue shadow-sm">
                {icon}
              </span>
            ) : null}
            {title}
          </CardTitle>
          {status ? <div className="flex flex-wrap items-center gap-1.5">{status}</div> : null}
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}

/** A numbered step inside a card; the number becomes a check once satisfied. */
export function StepHeader({ index, label, done }: { index: number; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
          done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {done ? <CheckCircle2 className="size-3.5" /> : index}
      </span>
      <h4 className="text-sm font-semibold">{label}</h4>
    </div>
  );
}

/** Grouping inside a card, so sections read as sections and not as loose rows. */
export function SettingsGroup({
  title,
  description,
  children,
  className
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3 rounded-lg border border-border/70 p-3.5", className)}>
      {title ? (
        <div className="space-y-0.5">
          <h4 className="text-sm font-semibold">{title}</h4>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Label, help text and a control on the right. The row shape for a setting. */
export function SettingRow({
  icon,
  label,
  description,
  control,
  className
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-48 flex-1 space-y-0.5">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
        </p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
