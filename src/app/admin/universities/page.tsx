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

export default function AdminUniversitiesPage() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({
    key: "name",
    direction: "asc",
  });

  const load = useCallback(async (): Promise<Row[]> => {
    const [universities, overview] = await Promise.all([
      apiGet<{ universities: University[] }>("/api/universities", "Could not load universities."),
      apiGet<{ universities: OverviewRow[] }>(
        "/api/admin/overview",
        "Could not load performance metrics.",
      ).catch(() => ({ universities: [] as OverviewRow[] })),
    ]);

    const perf = new Map(overview.universities.map((u) => [u.universityId, u]));

    return universities.universities.map((u) => {
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
  }, []);

  const { data, error, loading, reload } = useLoad(load, "admin-universities");

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    const filtered = data.filter(
      (u) => !needle || u.name.toLowerCase().includes(needle) || u.slug.includes(needle),
    );
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Universities"
        description="Every tenant on the network, with current-period performance."
        actions={actions}
      />

      {data.length > 4 ? (
        <SearchInput
          label="Search universities"
          value={query}
          onChange={setQuery}
          placeholder="Search by name or code…"
          className="max-w-sm"
        />
      ) : null}

      <Card>
        <CardHeader title={`${rows.length} of ${data.length} universit${data.length === 1 ? "y" : "ies"}`} />
        {data.length === 0 ? (
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
      </Card>
    </div>
  );
}
