import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Page controls for the tables that grow without bound — analysed records and
 * run history. Both accumulate for as long as the agent runs, so neither can be
 * "everything, sorted by date" forever.
 *
 * Deliberately just previous/next plus a count. Numbered pages would be more
 * navigation than a log deserves: nobody looks for page 7 of run history, they
 * look at the top or they filter.
 */
export function Pagination({
  offset,
  pageSize,
  total,
  onOffsetChange,
  className
}: {
  offset: number;
  pageSize: number;
  total: number;
  onOffsetChange: (offset: number) => void;
  className?: string;
}) {
  const { t } = useI18n();
  // One page of results does not need controls telling you so.
  if (total <= pageSize) return null;

  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + pageSize, total);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 ${className ?? ""}`}>
      <p className="text-xs text-muted-foreground">{t("pagination.range", { from, to, total })}</p>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={offset <= 0}
          onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
        >
          <ChevronLeft />
          {t("pagination.previous")}
        </Button>
        <span className="px-1 text-xs text-muted-foreground tabular-nums">
          {t("pagination.page", { page, pages })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={to >= total}
          onClick={() => onOffsetChange(offset + pageSize)}
        >
          {t("pagination.next")}
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
