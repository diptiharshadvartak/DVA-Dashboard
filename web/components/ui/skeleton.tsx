// Lightweight loading placeholders. These are intentionally dependency-free and
// purely presentational — they render instantly (no data fetching) so the App
// Router can show them via loading.tsx the moment a navigation starts, instead
// of freezing on the previous page until the server component's queries resolve.

import { cn } from '@/lib/utils';

/** A single shimmer block. Compose these into page-shaped skeletons. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-ink-100', className)} />;
}

/** Page heading: title + subtitle, matching the px-7 py-7 page header. */
function HeaderSkeleton() {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72 mt-2" />
      </div>
      <Skeleton className="h-9 w-32 rounded-lg" />
    </div>
  );
}

/** A KPI card placeholder matching components/ui/kpi-card.tsx. */
function KpiCardSkeleton() {
  return (
    <div className="bg-white border border-ink-200/70 rounded-xl p-4 flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-7 rounded-md" />
      </div>
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

/** A grid of KPI card placeholders. */
function KpiGridSkeleton({ kpis, cols }: { kpis: number; cols: number }) {
  const colClass =
    cols === 6 ? 'grid-cols-6' : cols === 3 ? 'grid-cols-3' : cols === 2 ? 'grid-cols-2' : 'grid-cols-4';
  return (
    <div className={cn('grid gap-3 mb-6', colClass)}>
      {Array.from({ length: kpis }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** A card-framed table placeholder: header strip + N rows. */
function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="bg-white border border-ink-200/70 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-ink-200/70 flex items-center gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-24 ml-auto" />
      </div>
      <div className="divide-y divide-ink-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-4">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Full-page skeleton matching the common layout used by most (app) routes:
 * a header, an optional KPI grid, and a table. Tune the shape per route via props.
 */
export function PageSkeleton({
  maxWidth = '1400px',
  kpis = 4,
  cols = 4,
  rows = 8,
  table = true,
}: {
  maxWidth?: string;
  kpis?: number;
  cols?: number;
  rows?: number;
  table?: boolean;
}) {
  return (
    <div className="px-7 py-7" style={{ maxWidth }}>
      <HeaderSkeleton />
      {kpis > 0 && <KpiGridSkeleton kpis={kpis} cols={cols} />}
      {table && <TableSkeleton rows={rows} />}
    </div>
  );
}

/** Chart-grid skeleton for the Reports page (KPIs + a grid of chart cards). */
export function ChartsSkeleton({ charts = 6 }: { charts?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: charts }).map((_, i) => (
        <div key={i} className="bg-white border border-ink-200/70 rounded-xl p-4">
          <Skeleton className="h-4 w-40 mb-4" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
