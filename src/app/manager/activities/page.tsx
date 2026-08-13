"use client";

import { useEffect, useState } from "react";
import {
  Badge, Card, EmptyState, ErrorState, PageHeader, Table, TableSkeleton,
  TableWrap, TBody, TD, THead, TR,
} from "@/app/_components/ui";

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

const time = (iso: string) => new Date(iso).toISOString().slice(11, 16);

export default function ManagerActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) return setError("Your session has expired.");
        const me = await meRes.json();
        const res = await fetch(`/api/universities/${me.user.universityId}/activities`);
        if (!res.ok) return setError(`Could not load activities (HTTP ${res.status})`);
        setActivities((await res.json()).activities);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div>
        <PageHeader title="Activity review" />
        <TableSkeleton cols={6} />
      </div>
    );
  }
  if (error) return <ErrorState message={error} />;

  return (
    <div>
      <PageHeader
        title="Activity review"
        description="Recorded activity across your university, including daily opening and closing."
      />
      <Card>
        {activities.length === 0 ? (
          <EmptyState
            title="No activity recorded yet"
            description="This is missing data, not zero hours worked — instructors record activity from their own dashboard."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead
                columns={[
                  { label: "Date" }, { label: "Instructor" }, { label: "Activity" },
                  { label: "Time (UTC)" }, { label: "Status" }, { label: "Remarks" },
                ]}
              />
              <TBody>
                {activities.map((a) => (
                  <TR key={a.id}>
                    <TD className="tabular">{new Date(a.workDate).toISOString().slice(0, 10)}</TD>
                    <TD strong>{a.instructor.user.name}</TD>
                    <TD>{a.activityType.label}</TD>
                    <TD className="tabular">{time(a.startTime)}–{time(a.endTime)}</TD>
                    <TD><Badge tone={a.status === "COMPLETED" ? "success" : "neutral"}>{a.status}</Badge></TD>
                    <TD>{a.remarks ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
