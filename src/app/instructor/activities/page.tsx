"use client";

/**
 * Recording and reviewing an instructor's own activity.
 *
 * The form is the reason people open this page, so it sits above the log
 * rather than below it. Everything shown is scoped by the server to the signed
 * in instructor — there is no university selector here because there is
 * nothing to select.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  SearchInput,
  Section,
  Select,
  StatusPill,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  inputClass,
} from "@/app/_components/ui";
import { useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate, formatTimeRange } from "@/app/_lib/format";
import { useUniversityToday } from "@/app/_lib/zone";

type ActivityType = {
  id: string;
  code: string;
  label: string;
  isOncePerDay: boolean;
  isDerivedFromWorkingHours: boolean;
};

type Activity = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  status: string;
  remarks: string | null;
  activityType: { code: string; label: string };
};

export default function InstructorActivitiesPage() {
  /* The UNIVERSITY's today, not the browser's — the server judges every day
   * boundary in the university's zone, so a browser a day out offers a date
   * the server then refuses. See `useUniversityToday`. */
  const today = useUniversityToday();
  const toast = useToast();
  const [form, setForm] = useState({
    code: "",
    date: "",
    start: "09:00",
    end: "10:00",
    remarks: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const me = await fetchMe();
    const instructorId = me.user.instructorId;
    if (!instructorId) {
      throw new Error("No instructor profile is linked to this account.");
    }

    const [types, activities] = await Promise.all([
      apiGet<{ activityTypes: ActivityType[] }>(
        "/api/activity-types",
        "Could not load the list of activity types.",
      ),
      apiGet<{
        activities: Activity[];
        timezone: string;
        page: number;
        limit: number;
        total: number;
        hasMore: boolean;
      }>(
        `/api/instructors/${instructorId}/activities?page=${page}`,
        "Could not load your recorded activity.",
      ),
    ]);

    // Opening and closing are recorded from Today against the university's
    // configured window, so they are not free-form options here — that is what
    // keeps them once-per-day rather than something you can log twice.
    const selectable = types.activityTypes.filter((t) => !t.isDerivedFromWorkingHours);

    return {
      instructorId,
      types: selectable,
      activities: activities.activities,
      // University zone for DISPLAY — rendering these instants in UTC is how
      // a 10:00 entry read back as 04:30.
      timezone: activities.timezone ?? "UTC",
      page: activities.page,
      limit: activities.limit,
      total: activities.total,
      hasMore: activities.hasMore,
    };
  }, [page]);

  const { data, error, loading, reload } = useLoad(load, `instructor-activities:${page}`);

  // The select needs a value as soon as the types arrive, without a second
  // render pass that would blank the control momentarily.
  const activeCode = form.code || data?.types[0]?.code || "";

  const visible = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.activities.filter((a) => {
      if (typeFilter && a.activityType.code !== typeFilter) return false;
      if (!needle) return true;
      return (
        a.activityType.label.toLowerCase().includes(needle) ||
        (a.remarks ?? "").toLowerCase().includes(needle) ||
        a.workDate.includes(needle)
      );
    });
  }, [data, query, typeFilter]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setFormError(null);

    if (!form.date) {
      setFormError("Pick the date this activity took place.");
      return;
    }
    if (form.end <= form.start) {
      setFormError("The end time must be after the start time.");
      return;
    }

    setSubmitting(true);
    try {
      await apiSend(
        `/api/instructors/${data.instructorId}/activities`,
        "POST",
        {
          activityTypeCode: activeCode,
          // Wall-clock fields exactly as typed; the SERVER resolves them in
          // the university's timezone. Building an instant here with
          // `new Date(...)` used the BROWSER's zone — an instructor in a
          // Kolkata browser posting to a New-York university silently booked
          // the previous calendar day.
          local: { date: form.date || today, start: form.start, end: form.end },
          remarks: form.remarks || undefined,
        },
        "Could not record that activity just now.",
      );
      toast("success", "Activity recorded.");
      setForm((f) => ({ ...f, remarks: "" }));
      reload();
    } catch (err) {
      // The server's own reason is useful here — "endTime must be after
      // startTime" tells you what to change, where a status code would not.
      setFormError(
        err instanceof Error ? err.message : "Could not record that activity just now.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Activities" />
        <TableSkeleton cols={5} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Activities" />
        <ErrorState message="Unable to load your activity" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  const isFiltered = query.length > 0 || typeFilter.length > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Activities"
        description="Record teaching, learning, support and other work. Only your own records are visible here."
      />

      <Card>
        <CardHeader
          title="Record an activity"
          description="Daily opening and closing are recorded from Today, against your university's configured window."
        />
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Activity" className="lg:col-span-2" required>
                <Select
                  value={activeCode}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                >
                  {data.types.map((t) => (
                    <option key={t.id} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date" required>
                <input
                  type="date"
                  value={form.date || today}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Start" required>
                <input
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="End" required>
                <input
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Remarks" hint="Optional." className="sm:col-span-2 lg:col-span-5">
                <input
                  value={form.remarks}
                  onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>

            {formError ? <Alert tone="danger">{formError}</Alert> : null}

            <Button type="submit" disabled={submitting}>
              {submitting ? "Recording…" : "Record activity"}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Section title="Your records">
        <Card>
          <CardHeader
            title="Recorded activity"
            actions={
              data.total > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <SearchInput
                    label="Search your activity"
                    value={query}
                    onChange={setQuery}
                    placeholder="Search activity or remarks…"
                    className="w-full sm:w-56"
                  />
                  <Select
                    aria-label="Filter by activity type"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="w-auto"
                  >
                    <option value="">All activities</option>
                    {data.types.map((t) => (
                      <option key={t.id} value={t.code}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                  {isFiltered ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setQuery("");
                        setTypeFilter("");
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
          />

          {data.total === 0 ? (
            <EmptyState
              title="Nothing recorded yet"
              description="Use the form above to record your first activity — it appears in your workload immediately."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="No activity matches those filters"
              description="Try a different search term or clear the filters."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setTypeFilter("");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <>
              {/* Desktop: the full record. */}
              <div className="hidden md:block">
                <TableWrap>
                  <Table caption="Your recorded activity">
                    <THead
                      columns={[
                        { label: "Date" },
                        { label: "Activity" },
                        { label: "Time" },
                        { label: "Status" },
                        { label: "Remarks" },
                      ]}
                    />
                    <TBody>
                      {visible.map((a) => (
                        <TR key={a.id}>
                          <TD strong className="tabular whitespace-nowrap">
                            {formatDate(a.workDate)}
                          </TD>
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

              {/* Mobile: date and activity, with the rest as supporting text.
                  A five-column table on a 390px screen is unreadable however
                  it scrolls. */}
              <div className="md:hidden">
                <CardList>
                  {visible.map((a) => (
                    <CardListItem
                      key={a.id}
                      title={a.activityType.label}
                      subtitle={
                        <span className="tabular">
                          {formatDate(a.workDate)} ·{" "}
                          {formatTimeRange(a.startTime, a.endTime, data.timezone)}
                        </span>
                      }
                      meta={a.remarks ? <span className="text-sm text-muted">{a.remarks}</span> : null}
                      trailing={<StatusPill status={a.status} />}
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
      </Section>
    </div>
  );
}
