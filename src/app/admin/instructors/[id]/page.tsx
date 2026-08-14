"use client";

/**
 * Drill-down steps 3–5: instructor → date → activity (§28).
 */

import { use, useCallback, useState } from "react";
import {
  Breadcrumb,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusPill,
  Table,
  TableWrap,
  TBody,
  TD,
  THead,
} from "@/app/_components/ui";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatDate, formatTimeRange } from "@/app/_lib/format";

type Day = {
  date: string;
  isWorkingDay: boolean;
  nonWorkingReason: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number | null;
  hasData: boolean;
  openingLogged: boolean;
  closingLogged: boolean;
};
type Activity = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  remarks: string | null;
  activityType: { code: string; label: string };
};

export default function AdminInstructorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);

  const load = useCallback(async () => {
    const inst = await apiGet<{ instructor: { user: { name: string }; universityId: string } }>(
      `/api/instructors/${id}`,
      "Could not load this instructor.",
    );
    const analytics = await apiGet<{ analytics: { instructors: Array<{ instructorId: string; days: Day[] }> } }>(
      `/api/universities/${inst.instructor.universityId}/analytics`,
      "Could not load workload for this instructor.",
    ).catch(() => null);

    const mine = analytics?.analytics.instructors.find((x) => x.instructorId === id);

    return { name: inst.instructor.user.name, days: mine?.days ?? [] };
  }, [id]);

  const { data, error, loading, reload } = useLoad(load, id);

  async function openDay(date: string) {
    setSelectedDate(date);
    setActivitiesLoading(true);
    try {
      const body = await apiGet<{ activities: Activity[] }>(
        `/api/instructors/${id}/activities?from=${date}&to=${date}`,
        "Could not load activity for that day.",
      );
      setActivities(body.activities);
    } catch {
      setActivities([]);
    } finally {
      setActivitiesLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-64" />
        <Card padded>
          <Skeleton className="h-48 w-full" />
        </Card>
      </div>
    );
  }
  if (error || !data) return <ErrorState message="Unable to load this instructor" detail={error ?? undefined} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.name}
        breadcrumb={<Breadcrumb items={[{ label: "Instructors", href: "/admin/instructors" }, { label: data.name }]} />}
      />

      <Card>
        <CardHeader title="Days" description="Select a day to see its activity." />
        {data.days.length === 0 ? (
          <EmptyState title="No days in this period" />
        ) : (
          <TableWrap>
            <Table caption="Daily breakdown for this instructor">
              <THead
                columns={[
                  { label: "Date" },
                  { label: "Working" },
                  { label: "Capacity", align: "right" },
                  { label: "Recorded", align: "right" },
                  { label: "Unutilized", align: "right" },
                  { label: "Open / close" },
                ]}
              />
              <TBody>
                {data.days.map((d) => (
                  <tr
                    key={d.date}
                    className={`cursor-pointer transition-colors ${
                      selectedDate === d.date ? "bg-primary-subtle" : "hover:bg-hovered"
                    }`}
                    onClick={() => openDay(d.date)}
                  >
                    <TD strong>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDay(d.date);
                        }}
                        className="tabular text-primary hover:underline"
                      >
                        {formatDate(d.date)}
                      </button>
                    </TD>
                    <TD>{d.isWorkingDay ? "Yes" : (d.nonWorkingReason ?? "No")}</TD>
                    <TD align="right">{d.capacityHours}</TD>
                    <TD align="right">{d.productiveHours}</TD>
                    <TD align="right">
                      {d.unutilizedHours === null ? (
                        <span className="text-warning">No data</span>
                      ) : (
                        d.unutilizedHours
                      )}
                    </TD>
                    <TD>
                      {d.openingLogged ? "✓" : "—"} / {d.closingLogged ? "✓" : "—"}
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {selectedDate ? (
        <Card>
          <CardHeader title={`Activity on ${formatDate(selectedDate)}`} />
          {activitiesLoading ? (
            <div className="p-5">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : activities.length === 0 ? (
            <EmptyState
              title="No activity recorded"
              description="This is missing data, not zero hours worked."
            />
          ) : (
            <CardList>
              {activities.map((a) => (
                <CardListItem
                  key={a.id}
                  title={a.activityType.label}
                  subtitle={
                    <span className="tabular">
                      {formatTimeRange(a.startTime, a.endTime, "UTC")}
                      {a.remarks ? ` · ${a.remarks}` : ""}
                    </span>
                  }
                  trailing={<StatusPill status={a.status} />}
                />
              ))}
            </CardList>
          )}
        </Card>
      ) : null}
    </div>
  );
}
