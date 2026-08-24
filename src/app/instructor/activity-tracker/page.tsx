"use client";

/**
 * An instructor's own activity workspace.
 *
 * ── Scope comes from the session ───────────────────────────────────────────
 * The list calls `/api/activities` with no instructor filter. A self-scoped
 * caller is pinned to their own `instructorId` inside `instructorOwnedWhere`,
 * so this page cannot be pointed at a colleague even by editing the request.
 * Logging goes through the same route the app already used, which authorises
 * the target with `assertCanReadInstructor` — an instructor may only ever be
 * the subject of their own record.
 *
 * ── Why there is no edit or delete HERE ────────────────────────────────────
 * `ActivityLog` was an append-only ledger when this page was written — no
 * route exposed update or delete at all. That stopped being true: an
 * instructor who typed 14:00 for 04:00 had no recourse and a permanently wrong
 * figure, so `PATCH`/`DELETE /api/instructors/:id/activities/:activityId` now
 * exist, and the property that mattered is preserved by the audit trail
 * instead — every edit and removal records what the row held before.
 *
 * This page still offers neither, and that is now a choice about WHERE rather
 * than whether: correction belongs beside the sentence that produced the row,
 * on the work log, which is also the only place the today-only rule can be
 * expressed honestly. A pencil here would be a second, thinner way to do
 * something that screen does properly.
 *
 * ── Deliverable quantity ───────────────────────────────────────────────────
 * Quantity lives on `DeliverableLog`, against a named deliverable — never on
 * the activity row. So logging DELIVERABLE work optionally records a quantity
 * against one of the instructor's real deliverables through the existing logs
 * endpoint. With no deliverables assigned, the field is not shown at all
 * rather than offered and silently dropped.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
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
import { Dialog, useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDateShort, formatHours, humanizeCode } from "@/app/_lib/format";
import { useUniversityToday } from "@/app/_lib/zone";

type Activity = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  status: string;
  remarks: string | null;
  activityType: { code: string; label: string; countsAsProductive: boolean };
  university: { timezone: string };
};

type Response = {
  activities: Activity[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

type Deliverable = { id: string; title: string };

type Mode = "week" | "month" | "custom";

const DELIVERABLE_CODE = "DELIVERABLE";

function clock(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
}

/** Monday of the week containing `iso`, matching the reporting calendar. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export default function InstructorActivityTrackerPage() {
  const toast = useToast();
  /* The UNIVERSITY's today, not the browser's — the server judges every day
   * boundary in the university's zone, so a browser a day out offers a date
   * the server then refuses. See `useUniversityToday`. */
  const today = useUniversityToday();

  const [mode, setMode] = useState<Mode>("week");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [activityType, setActivityType] = useState("");
  const [page, setPage] = useState(1);

  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [types, setTypes] = useState<Array<{ code: string; label: string }>>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);

  const [logging, setLogging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    activityTypeCode: "",
    date: today,
    start: "09:00",
    end: "17:00",
    remarks: "",
    deliverableId: "",
    quantity: "",
  });

  useEffect(() => {
    void (async () => {
      const me = await fetchMe();
      const id = me.user.instructorId;
      setInstructorId(id);
      const [t, d] = await Promise.all([
        apiGet<{ activityTypes: Array<{ code: string; label: string; isDerivedFromWorkingHours: boolean }> }>(
          "/api/activity-types",
          "Could not load activity types.",
        ).catch(() => ({ activityTypes: [] })),
        id
          ? apiGet<{ deliverables: Deliverable[] }>(
              `/api/instructors/${id}/deliverables`,
              "Could not load your deliverables.",
            ).catch(() => ({ deliverables: [] as Deliverable[] }))
          : Promise.resolve({ deliverables: [] as Deliverable[] }),
      ]);
      // Opening and closing are derived from the university's working hours;
      // offering them here would let someone log a routine the system computes.
      setTypes(t.activityTypes.filter((x) => !x.isDerivedFromWorkingHours));
      setDeliverables(d.deliverables ?? []);
    })();
  }, []);

  const period = useMemo(() => {
    if (mode === "week") {
      const start = mondayOf(today);
      const end = new Date(`${start}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 6);
      return { from: start, to: end.toISOString().slice(0, 10) };
    }
    if (mode === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
    return { from, to };
  }, [mode, from, to, today]);

  const load = useCallback(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: "50",
      from: period.from,
      to: period.to,
    });
    if (activityType) params.set("activityType", activityType);
    // No instructorId: the server pins a self-scoped caller to their own rows.
    return apiGet<Response>(`/api/activities?${params}`, "Could not load your activity.");
  }, [page, period, activityType]);

  const { data, error, loading, reload } = useLoad(
    load,
    `instructor-activity:${page}:${period.from}:${period.to}:${activityType}`,
  );

  const submit = useCallback(async () => {
    if (!instructorId) return;
    if (!form.activityTypeCode) {
      toast("danger", "Choose an activity type.");
      return;
    }
    if (form.end <= form.start) {
      toast("danger", "The end time must be after the start time.");
      return;
    }
    setBusy(true);
    try {
      await apiSend(
        `/api/instructors/${instructorId}/activities`,
        "POST",
        {
          activityTypeCode: form.activityTypeCode,
          local: { date: form.date, start: form.start, end: form.end },
          ...(form.remarks.trim() ? { remarks: form.remarks.trim() } : {}),
        },
        "Could not log this activity.",
      );

      // Quantity is a separate, existing record against a named deliverable.
      // Only sent when the instructor actually chose one.
      if (form.activityTypeCode === DELIVERABLE_CODE && form.deliverableId && form.quantity) {
        const hours =
          (Number(form.end.slice(0, 2)) * 60 +
            Number(form.end.slice(3)) -
            Number(form.start.slice(0, 2)) * 60 -
            Number(form.start.slice(3))) /
          60;
        await apiSend(
          `/api/instructors/${instructorId}/deliverables/${form.deliverableId}/logs`,
          "POST",
          {
            workDate: form.date,
            quantityCompleted: Number(form.quantity),
            hoursSpent: Math.round(hours * 100) / 100,
            ...(form.remarks.trim() ? { remarks: form.remarks.trim() } : {}),
          },
          "The activity was logged, but the deliverable quantity was not.",
        );
      }

      toast("success", "Activity logged.");
      setLogging(false);
      setForm((f) => ({ ...f, remarks: "", quantity: "", deliverableId: "" }));
      reload();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not log this activity.");
    } finally {
      setBusy(false);
    }
  }, [instructorId, form, toast, reload]);

  const rows = data?.activities ?? [];
  const isDeliverable = form.activityTypeCode === DELIVERABLE_CODE;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Activity Tracker"
        description="Everything you have logged. Records are append-only, so log carefully."
        actions={
          <Button type="button" onClick={() => setLogging(true)}>
            Log activity
          </Button>
        }
      />

      {error ? <ErrorState message="Unable to load your activity" detail={error} onRetry={reload} /> : null}

      <Card>
        <CardHeader
          title={
            data
              ? `${data.total} record${data.total === 1 ? "" : "s"} · ${period.from} to ${period.to}`
              : "Your activity"
          }
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["week", "Current Week"],
                    ["month", "Current Month"],
                    ["custom", "Custom Date Range"],
                  ] as Array<[Mode, string]>
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={mode === value ? "primary" : "secondary"}
                    onClick={() => {
                      setMode(value);
                      setPage(1);
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {mode === "custom" ? (
                <>
                  <Field label="From">
                    <input
                      type="date"
                      value={from}
                      max={to}
                      onChange={(e) => {
                        setFrom(e.target.value);
                        setPage(1);
                      }}
                      aria-label="From date"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="To">
                    <input
                      type="date"
                      value={to}
                      min={from}
                      onChange={(e) => {
                        setTo(e.target.value);
                        setPage(1);
                      }}
                      aria-label="To date"
                      className={inputClass}
                    />
                  </Field>
                </>
              ) : null}
              <Field label="Activity type">
                <Select
                  value={activityType}
                  onChange={(e) => {
                    setActivityType(e.target.value);
                    setPage(1);
                  }}
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
          <TableSkeleton cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing logged in this period"
            description="Use “Log activity” to record what you worked on, or widen the date range."
          />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <Table caption="Your logged activity, newest first">
                  <THead
                    columns={[
                      { label: "Date" },
                      { label: "Activity" },
                      { label: "Start" },
                      { label: "End" },
                      { label: "Duration", align: "right" },
                      { label: "Remarks" },
                    ]}
                  />
                  <TBody>
                    {rows.map((a) => (
                      <TR key={a.id}>
                        <TD>
                          <span className="tabular">{formatDateShort(a.workDate)}</span>
                        </TD>
                        <TD strong>
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
                    title={humanizeCode(a.activityType.code)}
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

      <p className="text-xs text-subtle">
        Records are corrected on your work log, and only for today. Ask your manager to change
        anything from an earlier day.
      </p>

      <Dialog open={logging} onClose={() => setLogging(false)} title="Log activity">
        <div className="space-y-3">
          <Field label="Activity type">
            <Select
              value={form.activityTypeCode}
              onChange={(e) => setForm({ ...form, activityTypeCode: e.target.value })}
            >
              <option value="">Choose…</option>
              {types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Date">
            {/* `min` as well as `max`. Capping at today stopped a future date
                but still offered every past one, which the server refuses —
                a date field whose options include days that cannot be saved
                is a field that exists to waste somebody's typing. */}
            <input
              type="date"
              value={form.date}
              min={today}
              max={today}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className={inputClass}
            />
          </Field>

          <div className="flex gap-3">
            <Field label="Start" className="flex-1">
              <input
                type="time"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="End" className="flex-1">
              <input
                type="time"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>

          {/* Only for deliverable work, and only when there is a real
              deliverable to book against. */}
          {isDeliverable && deliverables.length > 0 ? (
            <>
              <Field label="Deliverable">
                <Select
                  value={form.deliverableId}
                  onChange={(e) => setForm({ ...form, deliverableId: e.target.value })}
                >
                  <option value="">Don&apos;t record a quantity</option>
                  {deliverables.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.deliverableId ? (
                <Field label="Quantity completed">
                  <input
                    type="number"
                    min={0}
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              ) : null}
            </>
          ) : null}

          {isDeliverable && deliverables.length === 0 ? (
            <p className="text-xs text-subtle">
              You have no deliverables assigned, so there is nothing to record a quantity against.
              The hours will still be logged.
            </p>
          ) : null}

          <Field label="Remarks">
            <input
              type="text"
              value={form.remarks}
              maxLength={500}
              placeholder="Optional"
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              className={inputClass}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setLogging(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={busy}>
              {busy ? "Logging…" : "Log activity"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
