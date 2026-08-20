/**
 * Loading shapes, sized like the thing that will replace them.
 *
 * Part of the shared UI primitives — see `ui/index.ts`.
 */

import { cx } from "@/app/_components/ui/cx";
import { Card } from "@/app/_components/ui/surfaces";


/* ── Loading ───────────────────────────────────────────────────────────── */

/**
 * Skeletons mirror the shape of what replaces them, so the page does not jump
 * when data lands (§30). A centred spinner would be less work and worse.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-chip bg-sunken", className)} />;
}

export function StatGridSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-5 shadow-card">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-16" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Card>
      <div className="border-b border-line px-5 py-4">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 px-5 py-3.5">
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className={cx("h-4", c === 0 ? "w-40" : "w-16")} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ChartSkeleton({ height = 160 }: { height?: number }) {
  return (
    <Card>
      <div className="border-b border-line px-5 py-4">
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="p-5">
        {/* Uniform bars rather than randomised heights: a skeleton that
            reshuffles on every render reads as the page glitching. */}
        <div className="flex items-end gap-1" style={{ height }}>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-full flex-1" />
          ))}
        </div>
      </div>
    </Card>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>
      <StatGridSkeleton />
      <TableSkeleton />
    </div>
  );
}
