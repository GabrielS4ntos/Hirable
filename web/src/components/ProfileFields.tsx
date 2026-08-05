import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ProfileField, ProfileSection, ProfileValue } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { profileMetadata, useI18n } from "@/lib/i18n";
import { optionKey } from "@/lib/option-key";

type Profile = Record<string, any>;

const FLAT_SECTIONS = ["identity", "professional", "work_eligibility", "demographics"];

function readValue(profile: Profile, section: ProfileSection, field: ProfileField) {
  return FLAT_SECTIONS.includes(section.key) ? profile?.[section.key]?.[field.key] : profile?.[field.key];
}

function writeValue(profile: Profile, section: ProfileSection, field: ProfileField, value: ProfileValue): Profile {
  if (FLAT_SECTIONS.includes(section.key)) {
    return { ...profile, [section.key]: { ...(profile[section.key] || {}), [field.key]: value } };
  }
  return { ...profile, [field.key]: value };
}

/**
 * Renders one schema section. The schema comes from the server, so the onboarding
 * and the profile screen always show exactly the fields the agents consume.
 */
export function ProfileSectionFields({
  section,
  profile,
  onChange,
  highlight = []
}: {
  section: ProfileSection;
  profile: Profile;
  onChange: (next: Profile) => void;
  highlight?: string[];
}) {
  const { locale } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {section.fields.map((field) => {
        const value = readValue(profile, section, field);
        const isWide = field.type === "record_list" || field.type === "years_map" || field.type === "string_list";
        const isHighlighted = highlight.includes(`${section.key}.${field.key}`);
        return (
          <div key={field.key} className={cn("space-y-1.5", isWide && "sm:col-span-2")}>
            <Label htmlFor={`${section.key}-${field.key}`} className="flex items-center gap-1.5">
              {profileMetadata("field", field.key, field.label, locale)}
              {field.required ? <span className="text-destructive">*</span> : null}
            </Label>
            <FieldControl
              id={`${section.key}-${field.key}`}
              field={field}
              sectionKey={section.key}
              value={value}
              highlighted={isHighlighted}
              onChange={(next) => onChange(writeValue(profile, section, field, next))}
            />
            {field.hint ? <p className="text-xs text-muted-foreground">{profileMetadata("hint", field.key, field.hint, locale)}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function FieldControl({
  id,
  field,
  sectionKey,
  value,
  onChange,
  highlighted
}: {
  id: string;
  field: ProfileField;
  sectionKey: string;
  value: any;
  onChange: (value: ProfileValue) => void;
  highlighted?: boolean;
}) {
  const { t, locale } = useI18n();
  const ring = highlighted ? "border-primary/60 ring-1 ring-primary/30" : "";

  switch (field.type) {
    case "number":
      return (
        <Input
          id={id}
          type="number"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
          className={ring}
        />
      );

    case "tristate":
      return <TristateControl id={id} value={value ?? null} onChange={onChange} highlighted={highlighted} />;

    case "enum":
      return (
        <Select value={value || "__empty__"} onValueChange={(next) => onChange(next === "__empty__" ? "" : next)}>
          <SelectTrigger id={id} className={ring}>
            <SelectValue placeholder={t("profile.notDeclared")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__empty__">{t("profile.notDeclared")}</SelectItem>
            {(field.options || []).map((option) => (
              <SelectItem key={option} value={option}>
                {profileMetadata("option", option, option, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "string_list":
      return (
        <Input
          id={id}
          value={Array.isArray(value) ? value.join(", ") : ""}
          onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
          placeholder={locale === "en" ? "Separate with commas" : "Separe por vírgulas"}
          className={ring}
        />
      );

    case "enum_or_text":
      return <EnumOrTextControl id={id} field={field} value={value ?? ""} onChange={onChange} highlighted={highlighted} />;

    case "years_map":
      return <YearsMapControl value={value || {}} onChange={onChange} />;

    case "record_list":
      return <RecordListControl sectionKey={sectionKey} field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />;

    default:
      return <Input id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={ring} />;
  }
}

/**
 * Three explicit states. "Não informar" is a real, selectable answer: it is what
 * keeps the agent from declaring anything on the user's behalf.
 */
function TristateControl({
  id,
  value,
  onChange,
  highlighted
}: {
  id: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  highlighted?: boolean;
}) {
  const { t } = useI18n();
  const options = [
    { value: null, label: t("profile.notDeclared") },
    { value: true, label: t("common.yes") },
    { value: false, label: t("common.no") }
  ] as const;
  return (
    <div id={id} role="radiogroup" className={cn("inline-flex rounded-md border border-input p-0.5", highlighted && "border-primary/60")}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded px-3 py-1 text-sm font-medium transition-colors",
              active ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A curated list plus an "Outro" escape hatch. These categories never cover
 * everyone, so the free-text option is part of the design, not a fallback.
 */
function EnumOrTextControl({
  id,
  field,
  value,
  onChange,
  highlighted
}: {
  id: string;
  field: ProfileField;
  value: string;
  onChange: (value: ProfileValue) => void;
  highlighted?: boolean;
}) {
  const { t, locale } = useI18n();
  const options = field.options || [];
  // Matched the way the server canonicalises it: a value that is one of the
  // options with different casing or accents is that option, not free text.
  const matched = options.find((option) => optionKey(option) === optionKey(value));
  const isOther = Boolean(value) && !matched;
  const [showText, setShowText] = React.useState(isOther);
  // Focus belongs to the person who just picked "Other…", never to a saved
  // value: autoFocus on mount scrolls the browser to this field, which landed
  // people in the middle of the profile form every time they opened it.
  const [focusText, setFocusText] = React.useState(false);

  React.useEffect(() => {
    if (isOther) setShowText(true);
  }, [isOther]);

  const selected = showText ? "__other__" : matched || "__empty__";

  return (
    <div className="space-y-2">
      <Select
        value={selected}
        onValueChange={(next) => {
          if (next === "__other__") {
            setShowText(true);
            setFocusText(true);
            return;
          }
          setShowText(false);
          setFocusText(false);
          onChange(next === "__empty__" ? "" : next);
        }}
      >
        <SelectTrigger id={id} className={highlighted ? "border-primary/60 ring-1 ring-primary/30" : undefined}>
          <SelectValue placeholder={t("profile.notDeclared")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">{t("profile.notDeclared")}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {profileMetadata("option", option, option, locale)}
            </SelectItem>
          ))}
          <SelectItem value="__other__">{locale === "en" ? "Other…" : "Outro…"}</SelectItem>
        </SelectContent>
      </Select>

      {showText ? (
        <Input
          value={isOther ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={locale === "en" ? "Describe" : "Descreva"}
          autoFocus={focusText}
        />
      ) : null}
    </div>
  );
}

function YearsMapControl({ value, onChange }: { value: Record<string, number>; onChange: (value: ProfileValue) => void }) {
  const { t, locale } = useI18n();
  const entries = Object.entries(value);
  const [draftKey, setDraftKey] = React.useState("");
  const [draftYears, setDraftYears] = React.useState("");

  const add = () => {
    const key = draftKey.trim();
    const years = Number(draftYears);
    if (!key || !Number.isFinite(years)) return;
    onChange({ ...value, [key]: years });
    setDraftKey("");
    setDraftYears("");
  };

  return (
    <div className="space-y-2">
      {entries.length ? (
        <div className="flex flex-wrap gap-2">
          {entries.map(([technology, years]) => (
            <span key={technology} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
              <span className="font-medium">{technology}</span>
              <span className="font-mono text-muted-foreground">{years}a</span>
              <button
                type="button"
                onClick={() => {
                  const next = { ...value };
                  delete next[technology];
                  onChange(next);
                }}
                className="text-muted-foreground transition-colors hover:text-destructive"
                aria-label={`${t("common.remove")} ${technology}`}
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Input
          value={draftKey}
          onChange={(event) => setDraftKey(event.target.value)}
          placeholder={locale === "en" ? "Technology" : "Tecnologia"}
          className="max-w-52"
          onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), add())}
        />
        <Input
          type="number"
          min={0}
          max={60}
          value={draftYears}
          onChange={(event) => setDraftYears(event.target.value)}
          placeholder={locale === "en" ? "Years" : "Anos"}
          className="max-w-24"
          onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), add())}
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!draftKey.trim() || draftYears === ""}>
          <Plus />
          {t("common.add")}
        </Button>
      </div>
    </div>
  );
}

function RecordListControl({
  sectionKey,
  field,
  value,
  onChange
}: {
  sectionKey: string;
  field: ProfileField;
  value: Record<string, any>[];
  onChange: (value: ProfileValue) => void;
}) {
  const { t, locale } = useI18n();
  const itemFields = field.item_fields || [];

  const updateItem = (index: number, key: string, next: ProfileValue) => {
    const items = value.map((item, position) => (position === index ? { ...item, [key]: next } : item));
    onChange(items);
  };

  return (
    <div className="space-y-3">
      {value.map((item, index) => (
        <div key={index} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">#{index + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onChange(value.filter((_, position) => position !== index))}
              className="text-muted-foreground hover:text-destructive"
              aria-label={`${t("common.remove")} item ${index + 1}`}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {itemFields.map((subField) => (
              <div key={subField.key} className="space-y-1.5">
                <Label className="text-xs">{profileMetadata("subfield", subField.key, subField.label, locale, sectionKey)}</Label>
                {subField.type === "string_list" ? (
                  <Input
                    value={Array.isArray(item[subField.key]) ? item[subField.key].join(", ") : ""}
                    onChange={(event) =>
                      updateItem(index, subField.key, event.target.value.split(",").map((v) => v.trim()).filter(Boolean))
                    }
                    placeholder={locale === "en" ? "Separate with commas" : "Separe por vírgulas"}
                  />
                ) : (
                  <Input
                    value={item[subField.key] ?? ""}
                    onChange={(event) => updateItem(index, subField.key, event.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, Object.fromEntries(itemFields.map((sub) => [sub.key, sub.type === "string_list" ? [] : ""]))])}
      >
        <Plus />
        {t("common.add")}
      </Button>
    </div>
  );
}
