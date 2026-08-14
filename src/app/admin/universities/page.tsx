"use client";

/**
 * The university list, as an enterprise comparison table rather than a
 * config browser (§13 of the NEXTWAVE brief). Identity and working-hours
 * configuration come from `/api/universities`; utilization and compliance
 * are merged in from the SAME rollup-backed `/api/admin/overview` the
 * platform Overview page already uses — one real number, read twice, never
 * recomputed here.
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
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Meter,
  PageHeader,
  Pagination,
  SearchInput,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  complianceTone,
  utilizationTone,
  type SortDirection,
} from "@/app/_components/ui";
import { apiGet, useLoad } from "@/app/_lib/api";
import { IconPlus } from "@/app/_components/icons";

type University = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  _count: { instructors: number; managers: number };
};

type OverviewRow = {
  universityId: string;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
};

type Row = University & {
  instructors: number;
  managers: number;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
};

type UniversitiesResponse = {
  rows: Row[];
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
      apiGet<{ universities: OverviewRow[] }>(
        "/api/admin/overview",
        "Could not load performance metrics.",
      ).catch(() => ({ universities: [] as OverviewRow[] })),
    ]);

    const perf = new Map(overview.universities.map((u) => [u.universityId, u]));

    const rows = universities.universities.map((u) => {
      const p = perf.get(u.id);
      return {
        ...u,
        instructors: u._count.instructors,
        managers: u._count.managers,
        utilizationPct: p?.utilizationPct ?? null,
        openingCompliancePct: p?.openingCompliancePct ?? null,
        closingCompliancePct: p?.closingCompliancePct ?? null,
      };
    });

    return {
      rows,
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
    const filtered = data.rows.filter(
      (u) => !needle || u.name.toLowerCase().includes(needle) || u.slug.includes(needle),
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
        <TableSkeleton cols={6} />
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
        description="Every tenant on the network, with current-period performance."
        actions={actions}
      />

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
                      { label: "Instructors", align: "right", sortKey: "instructors" },
                      { label: "Managers", align: "right", sortKey: "managers" },
                      { label: "Utilization", sortKey: "utilizationPct" },
                      { label: "Opening" },
                      { label: "Closing" },
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
                        <TD align="right">{u.instructors}</TD>
                        <TD align="right">{u.managers}</TD>
                        <TD>
                          <Meter value={u.utilizationPct} tone={utilizationTone(u.utilizationPct)} />
                        </TD>
                        <TD>
                          <Badge tone={complianceTone(u.openingCompliancePct)}>
                            {u.openingCompliancePct === null ? "—" : `${u.openingCompliancePct}%`}
                          </Badge>
                        </TD>
                        <TD>
                          <Badge tone={complianceTone(u.closingCompliancePct)}>
                            {u.closingCompliancePct === null ? "—" : `${u.closingCompliancePct}%`}
                          </Badge>
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
                    meta={<Meter value={u.utilizationPct} tone={utilizationTone(u.utilizationPct)} />}
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
