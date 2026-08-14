"use client";

/**
 * Activity review across the manager's university.
 *
 * Renamed "Workload" in navigation (§17), because that is the question this
 * page answers — not "here is a table" but "what has been recorded". Filters
 * are compact and resettable (§46); nothing here totals or judges anything the
 * server did not already compute.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchInput,
  Select,
  StatusPill,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
} from "@/app/_components/ui";
import { PeriodSelector, periodQuery, type Period } from "@/app/_components/interactive";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate, formatTimeRange } from "@/app/_lib/format";

type Activity = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  status: string;
  remarks: string | null;
  activityType: { code: string; label: string };
  instructor: { id: string; employeeCode: string | null; user: { name: string; email: string } };
};

export default function ManagerActivitiesPage() {
  const [period, setPeriod] = useState<Period | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) throw new Error("No university is linked to this account.");
    const body = await apiGet<{ activities: Activity[]; timezone: string }>(
      `/api/universities/${me.user.universityId}/activities${periodQuery(period)}`,
      "Could not load recorded activity.",
    );
    // Timezone rides along for DISPLAY — these instants rendered as UTC read
    // a 10:00 Kolkata class back as 04:30.
    return { activities: body.activities, timezone: body.timezone ?? "UTC" };
  }, [period]);

  const { data, error, loading, reload } = useLoad(
    load,
    period ? `${period.from}:${period.to}` : "default",
  );

  const types = useMemo(() => {
    if (!data) return [];
    return [...new Map(data.activities.map((a) => [a.activityType.code, a.activityType.label])).entries()];
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.activities.filter((a) => {
      if (typeFilter && a.activityType.code !== typeFilter) return false;
      if (!needle) return true;
      return (
        a.instructor.user.name.toLowerCase().includes(needle) ||
        (a.remarks ?? "").toLowerCase().includes(needle)
      );
    });
  }, [data, query, typeFilter]);

  const isFiltered = query.length > 0 || typeFilter.length > 0;

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workload" actions={<PeriodSelector value={period} onChange={setPeriod} />} />
        <TableSkeleton cols={6} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workload" />
        <ErrorState message="Unable to load recorded activity" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workload"
        description="Recorded activity across your university, including daily opening and closing."
        actions={<PeriodSelector value={period} onChange={setPeriod} />}
      />

      {data.activities.length > 0 ? (
        <FilterBar onClear={() => { setQuery(""); setTypeFilter(""); }} isFiltered={isFiltered}>
          <SearchInput
            label="Search activity"
            value={query}
            onChange={setQuery}
            placeholder="Search instructor or remarks…"
            className="w-full sm:w-64"
          />
          <Select
            aria-label="Activity type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-auto"
          >
            <option value="">All activity types</option>
            {types.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </FilterBar>
      ) : null}

      <Card>
        <CardHeader title={`${rows.length} of ${data.activities.length} record${data.activities.length === 1 ? "" : "s"}`} />
        {data.activities.length === 0 ? (
          <EmptyState
            title="No activity recorded yet"
            description="This is missing data, not zero hours worked — instructors record activity from their own dashboard."
          />
        ) : rows.length === 0 ? (
          <EmptyState title="No activity matches those filters" />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <Table caption="Recorded activity across the university">
                  <THead
                    columns={[
                      { label: "Date" },
                      { label: "Instructor" },
                      { label: "Activity" },
                      { label: "Time" },
                      { label: "Status" },
                      { label: "Remarks" },
                    ]}
                  />
                  <TBody>
                    {rows.map((a) => (
                      <TR key={a.id}>
                        <TD className="tabular whitespace-nowrap">{formatDate(a.workDate)}</TD>
                        <TD strong>{a.instructor.user.name}</TD>
                        <TD>{a.activityType.label}</TD>
                        <TD className="tabular whitespace-nowrap">
                          {formatTimeRange(a.startTime, a.endTime, data.timezone)}
                        </TD>
                        <TD>
                          <StatusPill status={a.status} />
                        </TD>
                        <TD>{a.remarks ?? "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>
            <div className="md:hidden">
              <CardList>
                {rows.map((a) => (
                  <CardListItem
                    key={a.id}
                    title={a.instructor.user.name}
                    subtitle={
                      <span className="tabular">
                        {a.activityType.label} · {formatDate(a.workDate)}
                      </span>
                    }
                    trailing={<StatusPill status={a.status} />}
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
