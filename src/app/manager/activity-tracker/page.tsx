"use client";

/**
 * A manager's activity explorer: what their own roster actually logged.
 *
 * Same endpoint as the admin's, deliberately — `GET /api/activities` already
 * derives roster scope from the session through `narrowManager`, so this page
 * sends no `managerId` and could not widen if it tried. There is no second
 * activity engine and no manager-specific query.
 *
 * The university and manager filters the admin gets are absent here on purpose:
 * a manager operates inside exactly one of each, so offering the controls would
 * imply a choice that does not exist.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  inputClass,
} from "@/app/_components/ui";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatDateShort, formatHours, humanizeCode } from "@/app/_lib/format";

type Activity = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  status: string;
  remarks: string | null;
  activityType: { code: string; label: string; countsAsProductive: boolean };
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  university: { timezone: string };
};

type Response = {
  activities: Activity[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

function clock(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
}

export default function ManagerActivityTrackerPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [activityType, setActivityType] = useState("");

  const [roster, setRoster] = useState<Array<{ id: string; name: string }>>([]);
  const [types, setTypes] = useState<Array<{ code: string; label: string }>>([]);

  useEffect(() => {
    void (async () => {
      const [r, t] = await Promise.all([
        apiGet<{ instructors: Array<{ id: string; user: { name: string } }> }>(
          "/api/instructors?limit=200",
          "Could not load your roster.",
        ).catch(() => ({ instructors: [] })),
        apiGet<{ activityTypes: Array<{ code: string; label: string }> }>(
          "/api/activity-types",
          "Could not load activity types.",
        ).catch(() => ({ activityTypes: [] })),
      ]);
      setRoster(r.instructors.map((i) => ({ id: i.id, name: i.user.name })));
      setTypes(t.activityTypes);
    })();
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (search.trim()) params.set("search", search.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (instructorId) params.set("instructorId", instructorId);
    if (activityType) params.set("activityType", activityType);
    return apiGet<Response>(`/api/activities?${params}`, "Could not load activity records.");
  }, [page, search, from, to, instructorId, activityType]);

  const { data, error, loading, reload } = useLoad(
    load,
    `manager-activity:${page}:${search}:${from}:${to}:${instructorId}:${activityType}`,
  );

  const resetTo = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const rows = data?.activities ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Activity Tracker"
        description="Every activity your instructors logged, as they logged it."
      />

      {error ? (
        <ErrorState message="Unable to load activity records" detail={error} onRetry={reload} />
      ) : null}

      <Card>
        <CardHeader
          title={data ? `${data.total} record${data.total === 1 ? "" : "s"}` : "Records"}
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <SearchInput
                label="Search"
                value={search}
                onChange={resetTo(setSearch)}
                placeholder="Name, employee ID or remarks…"
                className="w-full sm:w-52"
              />
              <Field label="From">
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => resetTo(setFrom)(e.target.value)}
                  aria-label="From date"
                  className={inputClass}
                />
              </Field>
              <Field label="To">
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => resetTo(setTo)(e.target.value)}
                  aria-label="To date"
                  className={inputClass}
                />
              </Field>
              <Field label="Instructor">
                <Select
                  value={instructorId}
                  onChange={(e) => resetTo(setInstructorId)(e.target.value)}
                  className="min-w-40"
                >
                  <option value="">Everyone on my roster</option>
                  {roster.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Activity type">
                <Select
                  value={activityType}
                  onChange={(e) => resetTo(setActivityType)(e.target.value)}
                  className="min-w-36"
                >
                  <option value="">All</option>
                  {types.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          }
        />

        {loading && !data ? (
          <TableSkeleton cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No activity matches these filters"
            description="Widen the date range or clear a filter. This is every record your roster has logged."
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <TableWrap>
                <Table caption="Activity logged by your roster, newest first">
                  <THead
                    columns={[
                      { label: "Date" },
                      { label: "Instructor" },
                      { label: "Activity type" },
                      { label: "Start" },
                      { label: "End" },
                      { label: "Duration", align: "right" },
                      { label: "Status" },
                    ]}
                  />
                  <TBody>
                    {rows.map((a) => (
                      <TR key={a.id}>
                        <TD>
                          <span className="tabular">{formatDateShort(a.workDate)}</span>
                        </TD>
                        <TD strong>
                          <Link
                            href={`/manager/instructors/${a.instructorId}/report`}
                            className="font-medium text-primary hover:underline"
                          >
                            {a.instructorName}
                          </Link>
                          <span className="tabular block text-xs text-muted">
                            {a.employeeCode ?? "—"}
                          </span>
                        </TD>
                        <TD>
                          <Badge tone={a.activityType.countsAsProductive ? "neutral" : "warning"}>
                            {humanizeCode(a.activityType.code)}
                          </Badge>
                        </TD>
                        <TD>
                          <span className="tabular">{clock(a.startTime, a.university.timezone)}</span>
                        </TD>
                        <TD>
                          <span className="tabular">{clock(a.endTime, a.university.timezone)}</span>
                        </TD>
                        <TD align="right">
                          <span className="tabular">{formatHours(a.durationHours)}</span>
                        </TD>
                        <TD>
                          <Badge tone={a.status === "COMPLETED" ? "success" : "neutral"}>
                            {humanizeCode(a.status)}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            <div className="lg:hidden">
              <CardList>
                {rows.map((a) => (
                  <CardListItem
                    key={a.id}
                    href={`/manager/instructors/${a.instructorId}/report`}
                    title={`${a.instructorName} · ${humanizeCode(a.activityType.code)}`}
                    subtitle={
                      `${formatDateShort(a.workDate)} · ` +
                      `${clock(a.startTime, a.university.timezone)}–${clock(a.endTime, a.university.timezone)}` +
                      (a.remarks ? ` · ${a.remarks}` : "")
                    }
                    trailing={
                      <span className="tabular text-sm text-content">
                        {formatHours(a.durationHours)}
                      </span>
                    }
                  />
                ))}
              </CardList>
            </div>

            <Pagination
              page={data!.page}
              limit={data!.limit}
              total={data!.total}
              hasMore={data!.hasMore}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
