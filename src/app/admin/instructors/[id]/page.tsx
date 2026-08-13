"use client";

import { use, useEffect, useState } from "react";
import {
  Badge, Breadcrumb, Card, CardHeader, EmptyState, ErrorState, PageHeader,
  Skeleton, Table, TableWrap, TBody, TD, THead,
} from "@/app/_components/ui";

type Day = {
  date: string; isWorkingDay: boolean; nonWorkingReason: string | null;
  capacityHours: number; productiveHours: number; unutilizedHours: number | null;
  hasData: boolean; openingLogged: boolean; closingLogged: boolean;
};
type Activity = {
  id: string; startTime: string; endTime: string; status: string;
  remarks: string | null; activityType: { code: string; label: string };
};

const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);

/** Drill-down steps 3–5: instructor → date → activity. */
export default function AdminInstructorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [name, setName] = useState("");
  const [days, setDays] = useState<Day[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const iRes = await fetch(`/api/instructors/${id}`);
        if (!iRes.ok) return setError(`Could not load instructor (HTTP ${iRes.status})`);
        const inst = (await iRes.json()).instructor;
        setName(inst.user.name);

        const aRes = await fetch(`/api/universities/${inst.universityId}/analytics`);
        if (aRes.ok) {
          const analytics = (await aRes.json()).analytics;
          const mine = analytics.instructors.find((x: { instructorId: string }) => x.instructorId === id);
          if (mine) setDays(mine.days);
        }
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function openDay(date: string) {
    setSelectedDate(date);
    const res = await fetch(`/api/instructors/${id}/activities?from=${date}&to=${date}`);
    if (res.ok) setActivities((await res.json()).activities);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-64" />
        <Card padded><Skeleton className="h-48 w-full" /></Card>
      </div>
    );
  }
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={name}
        breadcrumb={<Breadcrumb items={[{ label: "Instructors", href: "/admin/instructors" }, { label: name }]} />}
      />

      <Card>
        <CardHeader title="Days" description="Select a day to see its activity." />
        {days.length === 0 ? (
          <EmptyState title="No days in this period" />
        ) : (
          <TableWrap>
            <Table>
              <THead
                columns={[
                  { label: "Date" }, { label: "Working" }, { label: "Capacity", align: "right" },
                  { label: "Productive", align: "right" }, { label: "Unutilized", align: "right" },
                  { label: "Open / Close" },
                ]}
              />
              <TBody>
                {days.map((d) => (
                  <tr
                    key={d.date}
                    className={`transition-colors ${selectedDate === d.date ? "bg-primary-subtle" : "hover:bg-hovered"}`}
                  >
                    <TD strong>
                      <button onClick={() => openDay(d.date)} className="tabular text-primary hover:underline">
                        {d.date}
                      </button>
                    </TD>
                    <TD>{d.isWorkingDay ? "Yes" : (d.nonWorkingReason ?? "No")}</TD>
                    <TD align="right">{d.capacityHours}</TD>
                    <TD align="right">{d.productiveHours}</TD>
                    <TD align="right">
                      {d.unutilizedHours === null ? <span className="text-warning">no data</span> : d.unutilizedHours}
                    </TD>
                    <TD>{d.openingLogged ? "✓" : "—"} / {d.closingLogged ? "✓" : "—"}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {selectedDate ? (
        <Card>
          <CardHeader title={`Activity on ${selectedDate}`} />
          {activities.length === 0 ? (
            <EmptyState
              title="No activity recorded"
              description="This is missing data, not zero hours worked."
            />
          ) : (
            <ul className="divide-y divide-line">
              {activities.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-content">{a.activityType.label}</p>
                    <p className="tabular mt-0.5 text-sm text-muted">
                      {hhmm(a.startTime)}–{hhmm(a.endTime)} UTC{a.remarks ? ` · ${a.remarks}` : ""}
                    </p>
                  </div>
                  <Badge tone={a.status === "COMPLETED" ? "success" : "neutral"}>{a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
