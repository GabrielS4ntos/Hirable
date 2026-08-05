import * as React from "react";
import { CheckCircle2, FileText, Loader2, RefreshCw, Star, Trash2, Upload } from "lucide-react";
import { ApiError, api, type ResumeDocument } from "@/lib/api";
import { useCooldown } from "@/hooks/useCooldown";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { localizedError, useI18n } from "@/lib/i18n";

const ACCEPTED = ".docx,.txt,.md,.rtf,.pdf";
const MAX_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("não foi possível ler o arquivo"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

/**
 * Résumé files. The document itself stays on disk and is what gets attached to
 * an email; on upload it is summarized once into a compact index, which is what
 * decides later which résumé fits a given job — at no cost per job.
 */
export function ResumeUploads({ resumes, onChange }: { resumes: ResumeDocument[]; onChange: (items: ResumeDocument[]) => void }) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const cooldown = useCooldown();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  async function upload(files: FileList | File[] | null) {
    const list = Array.from(files || []);
    if (!list.length) return;

    setUploading(true);
    try {
      for (const file of list) {
        if (file.size > MAX_BYTES) {
          toast({ title: t("resume.tooLarge", { name: file.name }), variant: "error" });
          continue;
        }
        const result = await api.uploadResume({
          filename: file.name,
          label: file.name.replace(/\.[^.]+$/, ""),
          mime_type: file.type,
          content_base64: await readAsBase64(file)
        });
        onChange(result.items);
        toast({
          title: t("resume.uploaded", { name: file.name }),
          description: result.extraction.extracted
            ? t("resume.reading")
            : t("resume.savedWithoutReading", { reason: result.extraction.reason }),
          variant: result.extraction.extracted ? "success" : "default"
        });
      }
    } catch (error) {
      toast({ title: t("resume.uploadFailed"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function act(id: string, action: () => Promise<{ items: ResumeDocument[] }>, title?: string) {
    setBusy(id);
    try {
      onChange((await action()).items);
      if (title) toast({ title, variant: "success" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) cooldown.start(error.retryAfter ?? 30);
      toast({ title: t("common.error"), description: localizedError(error, t, locale), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
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
          {t("resume.drop")}{" "}
          <button type="button" onClick={() => inputRef.current?.click()} className="text-primary underline underline-offset-2">
            {t("resume.choose")}
          </button>
          .
        </p>
        <p className="text-xs text-muted-foreground">
          {t("resume.formats")}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
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

      {resumes.length ? (
        <div className="space-y-2">
          {resumes.map((resume) => (
            <div key={resume.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <Input
                      value={resume.label}
                      onChange={(event) => onChange(resumes.map((item) => (item.id === resume.id ? { ...item, label: event.target.value } : item)))}
                      onBlur={(event) => void act(resume.id, () => api.updateResume(resume.id, { label: event.target.value }))}
                      className="h-8 max-w-64"
                      aria-label={t("resume.label")}
                    />
                    {resume.is_default ? <Badge variant="default">{t("resume.default")}</Badge> : null}
                    {resume.indexed ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="size-3" />
                        {t("resume.analyzed")}
                      </Badge>
                    ) : resume.index_error ? (
                      <Badge variant="secondary">{t("resume.noAnalysis")}</Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <Loader2 className="size-3 animate-spin" />
                        {t("resume.analyzing")}
                      </Badge>
                    )}
                  </div>

                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {resume.original_name} · {formatSize(resume.size_bytes)}
                    {resume.use_count ? ` · ${t("resume.used", { count: resume.use_count })}` : ""}
                  </p>

                  {resume.indexed ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {resume.headline ? <span className="text-xs text-muted-foreground">{resume.headline} ·</span> : null}
                      {resume.technologies.slice(0, 8).map((technology) => (
                        <Badge key={technology} variant="outline">
                          {technology}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  {resume.index_error ? <p className="mt-1 text-xs text-muted-foreground">{resume.index_error}</p> : null}
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title={resume.is_default ? t("resume.alreadyDefault") : t("resume.useDefault")}
                    disabled={resume.is_default || busy === resume.id}
                    onClick={() => void act(resume.id, () => api.updateResume(resume.id, { is_default: true }), t("resume.defaultUpdated"))}
                  >
                    <Star className={resume.is_default ? "fill-current text-primary" : ""} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t("resume.reanalyze")}
                    disabled={busy === resume.id || cooldown.active}
                    onClick={() => void act(resume.id, () => api.reindexResume(resume.id), t("resume.reanalyzed"))}
                  >
                    {busy === resume.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t("common.remove")}
                    className="text-muted-foreground hover:text-destructive"
                    disabled={busy === resume.id}
                    onClick={() => void act(resume.id, () => api.deleteResume(resume.id), t("resume.removed"))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {resumes.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          {t("resume.multipleHelp")}
        </p>
      ) : null}

      <Label className="sr-only">{t("resume.plural")}</Label>
    </div>
  );
}
