"use client";

/**
 * The university list, as an enterprise comparison table rather than a
 * config browser (§13 of the NIAT brief). Identity and working-hours
 * configuration come from `/api/universities`; headcount, hours and
 * deliverables are merged in from the SAME rollup-backed
 * `/api/admin/overview` the platform Overview page already uses — one real
 * number, read twice, never recomputed here.
 *
 * ── Why the hours column says "Recorded", not "Working" ───────────────────
 * Working Hours counts time spent WITH STUDENTS, and that answer lives on
 * each entry's deliverable — or, when an entry carries none, on its category.
 * `/api/admin/overview` reads the daily rollup, which stores MINUTES; neither
 * of those two facts survives into it, so a student-facing total cannot be
 * recovered from this response at all. What the rollup does hold is every
 * recorded productive minute, and that is what this column reports, under
 * that name. It was labelled "Working hours" before, which promised a figure
 * this endpoint has never carried. The student-facing view of the network
 * reads the entries themselves — see `/api/admin/network`.
 *
 * ── Why utilization is not on this screen ─────────────────────────────────
 * Recorded minutes over the configured working-day capacity says nothing
 * about students: a week of back-to-back internal meetings scores exactly
 * like a week of lectures, and the ratio runs past 100% routinely besides.
 * The network tile that led on it and the per-university meter are both gone.
 * What the table compares now is headcount, hours actually recorded, and
 * deliverables completed — three figures that mean the same thing on every
 * row.
 *
 * NOTE ON SCOPE: the brief also asks for Status, Risk, Deliverable health and
 * Last-activity columns. None of those four fields exist anywhere in the API
 * — confirmed by reading both `/api/universities` and `/api/admin/overview`
 * end to end. Adding them would mean either a backend change (out of scope
 * for a presentation-layer pass) or fabricated numbers (explicitly
 * forbidden). They are left out rather than faked; see DESIGN.md.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  ButtonLink,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  StatTile,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  type SortDirection,
} from "@/app/_components/ui";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatHours } from "@/app/_lib/format";
import { IconPlus } from "@/app/_components/icons";

type University = {
  id: string;
  name: string;
  code: string;
  slug: string;
  timezone: string;
  _count: { instructors: number; managers: number };
};

type Overview = {
  totalUniversities: number;
  totalManagers: number;
  totalInstructors: number;
  totalDeliverables: number;
};

type OverviewRow = {
  universityId: string;
  productiveHours: number;
  deliverables: number;
};

type Row = University & {
  instructors: number;
  managers: number;
  /**
   * Hours, from every productive minute the rollup recorded.
   *
   * NULL while the stored metrics are being migrated. Nullable rather than a
   * number with a flag beside it, because a number that must not be printed and
   * a number that may be printed should not have the same type — the compiler
   * is what stops the second render site being missed.
   */
  recordedHours: number | null;
  deliverables: number;
};

type UniversitiesResponse = {
  rows: Row[];
  /** Set only while the stored metrics cannot be believed. See `STORED_METRICS`. */
  storedMetricsNote: string | null;
  overview: Overview | null;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export default function AdminUniversitiesPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({
    key: "name",
    direction: "asc",
  });

  const setQueryAndResetPage = useCallback((next: string) => {
    setQuery(next);
    setPage(1);
  }, []);

  const load = useCallback(async (): Promise<UniversitiesResponse> => {
    const params = new URLSearchParams({ page: String(page) });
    if (query.trim()) params.set("search", query.trim());
    // Only the "name" column's sort is understood by the server — see
    // src/app/api/universities/route.ts's SORTABLE_FIELDS. Everything else
    // sorts client-side over whatever page is currently loaded.
    if (sort.key === "name") {
      params.set("sort", "name");
      params.set("order", sort.direction);
    }

    const [universities, overview] = await Promise.all([
      apiGet<{
        universities: University[];
        page: number;
        limit: number;
        total: number;
        hasMore: boolean;
      }>(`/api/universities?${params.toString()}`, "Could not load universities."),
      apiGet<{
        overview: (Overview & { storedMetrics?: { available: false; note: string } }) | null;
        universities: OverviewRow[];
      }>("/api/admin/overview", "Could not load performance metrics.").catch(() => ({
        overview: null,
        universities: [] as OverviewRow[],
      })),
    ]);

    const perf = new Map(overview.universities.map((u) => [u.universityId, u]));
    /* Absent means usable. The flag only ever says NO — a response that has not
       been marked is one whose figures were never in question, and defaulting
       the other way would blank every screen the moment a route was missed. */
    const metricsUsable = overview.overview?.storedMetrics?.available !== false;

    const rows = universities.universities.map((u) => {
      const p = perf.get(u.id);
      return {
        ...u,
        instructors: u._count.instructors,
        managers: u._count.managers,
        /* Never `?? 0`. A stale figure and an absent one are both unknown,
           and rendering either as zero states that no work was recorded — which
           a reader acts on. See `STORED_METRICS`. */
        recordedHours: metricsUsable ? (p?.productiveHours ?? null) : null,
        deliverables: p?.deliverables ?? 0,
      };
    });

    return {
      rows,
      /* Carried to the render so the page can SAY why a column is empty. A
         cell reading "Unavailable" with nothing explaining it invites the
         reader to assume a bug and go looking for the number elsewhere. */
      storedMetricsNote: metricsUsable ? null : (overview.overview?.storedMetrics?.note ?? null),
      overview: overview.overview ?? null,
      page: universities.page,
      limit: universities.limit,
      total: universities.total,
      hasMore: universities.hasMore,
    };
  }, [page, query, sort]);

  // Only the params that actually change the request belong in the key: page,
  // the search query, and — only for the server-backed "name" column — the
  // sort direction. Toggling sort on any other column re-sorts client-side
  // over the page already in memory and must not trigger a refetch.
  const sortKeyPart = sort.key === "name" ? `name:${sort.direction}` : "";
  const { data, error, loading, reload } = useLoad(
    load,
    `admin-universities:${page}:${query.trim()}:${sortKeyPart}`,
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    // The server already matched name, code AND slug (see the route's `where`),
    // so this second pass has to match on the same three. Filtering on name and
    // slug alone threw away rows the server found by code — and the box says
    // "name or code", which is also what the Code column invites you to type.
    const filtered = data.rows.filter(
      (u) =>
        !needle ||
        u.name.toLowerCase().includes(needle) ||
        u.code.toLowerCase().includes(needle) ||
        u.slug.toLowerCase().includes(needle),
    );
    // The server already returned the page sorted by name when that's the
    // active sort — re-sorting it here would be redundant at best and could
    // disagree with the server's collation at worst.
    if (sort.key === "name") return filtered;
    return [...filtered].sort((a, b) => {
      const key = sort.key as keyof Row;
      const av = a[key];
      const bv = b[key];
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [data, query, sort]);

  function toggleSort(key: string) {
    setSort((s) => ({ key, direction: s.key === key && s.direction === "asc" ? "desc" : "asc" }));
    setPage(1);
  }

  const actions = (
    <ButtonLink href="/admin/universities/new">
      <IconPlus size={16} />
      New university
    </ButtonLink>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Universities" actions={actions} />
        <TableSkeleton cols={7} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Universities" actions={actions} />
        <ErrorState message="Unable to load universities" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  // Mirrors the admin instructors page: `total` now reflects the search
  // filter (it's server-side), so a search with zero matches must NOT read
  // as "no universities exist" — only an unfiltered zero does.
  const isEmpty = data.total === 0 && !query.trim();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Universities"
        description="Overview of all universities."
        actions={actions}
      />

      {data.storedMetricsNote ? (
        <Alert tone="warning" title="Recorded hours are unavailable">
          {data.storedMetricsNote}
        </Alert>
      ) : null}

      {/* Network totals. Every figure is the API's own aggregate — nothing here
          is summed in the browser, so these cards and the table below cannot
          disagree. Three counts and no percentage: the fourth card ranked the
          whole network by utilization, a ratio of recorded minutes to capacity
          that is blind to whether anyone was in front of students. This
          response carries no student-facing total to put in its place, so the
          card is gone rather than refilled with a number that answers a
          different question. */}
      {data.overview ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label="Total universities" value={data.overview.totalUniversities} />
          <StatTile label="Total managers" value={data.overview.totalManagers} />
          <StatTile label="Total instructors" value={data.overview.totalInstructors} />
        </div>
      ) : null}

      {data.total > 4 || query.trim() ? (
        <SearchInput
          label="Search universities"
          value={query}
          onChange={setQueryAndResetPage}
          placeholder="Search by name or code…"
          className="max-w-sm"
        />
      ) : null}

      <Card>
        <CardHeader title={`${rows.length} of ${data.total} universit${data.total === 1 ? "y" : "ies"}`} />
        {isEmpty ? (
          <EmptyState
            title="No universities yet"
            description="Create the first university to start tracking instructor workload."
            action={<ButtonLink href="/admin/universities/new">Create a university</ButtonLink>}
          />
        ) : rows.length === 0 ? (
          <EmptyState title="No university matches that search" />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <Table caption="Universities on the network">
                  <THead
                    sort={sort}
                    onSort={toggleSort}
                    columns={[
                      { label: "University", sortKey: "name" },
                      { label: "Code" },
                      { label: "Managers", align: "right", sortKey: "managers" },
                      { label: "Instructors", align: "right", sortKey: "instructors" },
                      // The hours column inherits the sort the utilization
                      // column used to carry, so ranking the network by effort
                      // still works — against a measured quantity of time now,
                      // rather than against a percentage of capacity.
                      { label: "Recorded hours", align: "right", sortKey: "recordedHours" },
                      { label: "Deliverables", align: "right" },
                      { label: "Action" },
                    ]}
                  />
                  <TBody>
                    {rows.map((u) => (
                      <TR key={u.id}>
                        <TD strong>
                          <ButtonLink
                            href={`/admin/universities/${u.id}`}
                            variant="ghost"
                            size="sm"
                            className="h-auto !px-0 !py-0 font-medium text-primary hover:underline"
                          >
                            {u.name}
                          </ButtonLink>
                          <span className="ml-2 text-xs text-subtle">{u.timezone}</span>
                        </TD>
                        <TD>
                          <span className="tabular text-muted">{u.code}</span>
                        </TD>
                        <TD align="right">{u.managers}</TD>
                        <TD align="right">{u.instructors}</TD>
                        <TD align="right">
                          {u.recordedHours === null ? (
                            <span className="text-subtle">Unavailable</span>
                          ) : (
                            <span className="tabular">{formatHours(u.recordedHours)}</span>
                          )}
                        </TD>
                        <TD align="right">
                          <span className="tabular">{u.deliverables}</span>
                        </TD>
                        <TD>
                          <ButtonLink
                            href={`/admin/universities/${u.id}`}
                            variant="secondary"
                            size="sm"
                            aria-label={`Open ${u.name}`}
                          >
                            View →
                          </ButtonLink>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>
            <div className="md:hidden">
              <CardList>
                {rows.map((u) => (
                  <CardListItem
                    key={u.id}
                    href={`/admin/universities/${u.id}`}
                    title={u.name}
                    subtitle={`${u.instructors} instructors · ${u.timezone}`}
                    // The card carries the same figure the desktop row does —
                    // hours recorded — where a utilization meter used to sit.
                    // Two surfaces, one number, and it is a quantity of time
                    // rather than a percentage of a capacity nobody asked
                    // about.
                    meta={
                      <span className="tabular text-sm text-muted">
                        {u.recordedHours === null
                          ? "Hours unavailable"
                          : `${formatHours(u.recordedHours)} recorded`}
                      </span>
                    }
                  />
                ))}
              </CardList>
            </div>
          </>
        )}
        <Pagination
          page={data.page}
          limit={data.limit}
          total={data.total}
          hasMore={data.hasMore}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
