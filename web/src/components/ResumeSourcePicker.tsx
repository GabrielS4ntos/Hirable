import * as React from "react";
import { CheckCircle2, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { api, type ResumeDocument } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { localizedError, useI18n } from "@/lib/i18n";

const ACCEPTED = ".docx,.txt,.md,.rtf,.pdf";
const MAX_BYTES = 10 * 1024 * 1024;

export type ResumeSource = "text" | "file";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("não foi possível ler o arquivo"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Where the profile extraction reads from, during onboarding.
 *
 * The two ways of providing a résumé are alternatives, not a list to fill in
 * twice, so only one is on screen at a time. Exactly one file is kept here: a
 * second one would raise a question this screen has no reason to ask — which of
 * them describes you — and the profile screen is where a library belongs.
 */
export function ResumeSourcePicker({
  source,
  onSourceChange,
  resumeText,
  onResumeTextChange,
  resume,
  onResumeChange,
  minChars
}: {
  source: ResumeSource;
  onSourceChange: (source: ResumeSource) => void;
  resumeText: string;
  onResumeTextChange: (text: string) => void;
  resume: ResumeDocument | null;
  onResumeChange: (resumes: ResumeDocument[]) => void;
  minChars: number;
}) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  async function upload(files: FileList | File[] | null) {
    const file = Array.from(files || [])[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast({ title: t("resume.tooLarge", { name: file.name }), variant: "error" });
      return;
    }

    setUploading(true);
    try {
      const result = await api.uploadResume({
        filename: file.name,
        label: file.name.replace(/\.[^.]+$/, ""),
        mime_type: file.type,
        content_base64: await readAsBase64(file)
      });
      onResumeChange(result.items);
      toast({
        title: t("resume.uploaded", { name: file.name }),
        description: result.extraction.extracted
          ? t("resume.reading")
          : t("resume.savedWithoutReading", { reason: result.extraction.reason }),
        variant: result.extraction.extracted ? "success" : "default"
      });
    } catch (error) {
      toast({ title: t("resume.uploadFailed"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    if (!resume) return;
    setRemoving(true);
    try {
      onResumeChange((await api.deleteResume(resume.id)).items);
      toast({ title: t("resume.removed"), variant: "success" });
    } catch (error) {
      toast({ title: t("common.error"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border p-0.5" role="tablist">
        {(["text", "file"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={source === option}
            onClick={() => onSourceChange(option)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              source === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option === "text" ? t("resume.sourceText") : t("resume.sourceFile")}
          </button>
        ))}
      </div>

      {source === "text" ? (
        <div className="space-y-1.5">
          <Label htmlFor="resume-text">{t("profile.resumeText")}</Label>
          <Textarea
            id="resume-text"
            value={resumeText}
            onChange={(event) => onResumeTextChange(event.target.value)}
            placeholder={t("profile.resumePlaceholder")}
            className="min-h-56 font-mono text-xs leading-relaxed"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            {t("profile.characters", { count: resumeText.trim().length })}
            {resumeText.trim().length >= minChars ? "" : t("profile.minimum", { count: minChars })}
          </p>
        </div>
      ) : resume ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">{resume.label}</span>
              {resume.indexed ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="size-3" />
                  {t("resume.analyzed")}
                </Badge>
              ) : resume.index_error ? (
                <Badge variant="warning">{t("resume.noAnalysis")}</Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  {t("resume.analyzing")}
                </Badge>
              )}
            </div>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {resume.original_name} · {formatSize(resume.size_bytes)}
            </p>
            {resume.index_error ? <p className="mt-1 text-xs text-warning">{resume.index_error}</p> : null}
            <p className="mt-2 text-xs text-muted-foreground">{t("resume.singleFileHelp")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={remove} disabled={removing}>
            {removing ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {t("resume.replaceFile")}
          </Button>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void upload(event.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border"
          )}
        >
          <Upload className="size-5 text-muted-foreground" />
          <p className="text-sm">
            {t("resume.dropSingle")}{" "}
            <button type="button" onClick={() => inputRef.current?.click()} className="text-primary underline underline-offset-2">
              {t("resume.choose")}
            </button>
            .
          </p>
          <p className="text-xs text-muted-foreground">{t("resume.formats")}</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(event) => void upload(event.target.files)}
          />
          {uploading ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("resume.uploading")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
