"use client";

/**
 * An instructor's own account details.
 *
 * Everything here is read-only, and deliberately so. University, manager,
 * employee code and account status are organisational facts: changing a
 * university would invalidate every historical record pointing at the old
 * tenant, and letting someone pick their own manager would make the roster
 * boundary meaningless. Those are admin actions, so this page shows them and
 * says who to ask rather than offering a control that would be refused.
 *
 * "Unassigned" is shown plainly when nobody currently manages this instructor —
 * an admin may have removed them from a roster, which changes nothing about
 * their account or their history.
 */

import { useCallback } from "react";
import {
  Badge,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Section,
  TableSkeleton,
} from "@/app/_components/ui";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";

type Instructor = {
  id: string;
  employeeCode: string | null;
  managerId: string | null;
  manager: { id: string; employeeCode: string | null; user: { name: string; email: string } } | null;
  user: { name: string; email: string; isActive: boolean };
  university: { id: string; name: string; timezone: string };
};

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-5 py-3 last:border-0">
      <div>
        <p className="text-sm text-muted">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-subtle">{hint}</p> : null}
      </div>
      <div className="text-right text-sm font-medium text-content">{value}</div>
    </div>
  );
}

export default function InstructorSettingsPage() {
  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.instructorId) throw new Error("No instructor profile is linked to your account.");
    const { instructor } = await apiGet<{ instructor: Instructor }>(
      `/api/instructors/${me.user.instructorId}`,
      "Could not load your profile.",
    );
    return instructor;
  }, []);

  const { data, error, loading, reload } = useLoad(load, "instructor-settings");

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Your account details." />

      {error ? <ErrorState message="Unable to load your profile" detail={error} onRetry={reload} /> : null}
      {loading && !data ? <TableSkeleton cols={2} /> : null}

      {data ? (
        <>
          <Section title="Profile">
            <Card>
              <Row label="Name" value={data.user.name} />
              <Row label="Email" value={data.user.email} />
              <Row
                label="Employee code"
                value={<span className="tabular">{data.employeeCode ?? "—"}</span>}
                hint="Set by your administrator"
              />
              <Row
                label="Status"
                value={
                  <Badge tone={data.user.isActive ? "success" : "neutral"}>
                    {data.user.isActive ? "Active" : "Deactivated"}
                  </Badge>
                }
              />
            </Card>
          </Section>

          <Section
            title="Organisation"
            description="These are managed by your administrator and cannot be changed here."
          >
            <Card>
              <Row
                label="University"
                value={data.university.name}
                hint={`Times are shown in ${data.university.timezone}`}
              />
              <Row
                label="Manager"
                value={
                  data.manager ? (
                    <>
                      {data.manager.user.name}
                      {data.manager.employeeCode ? (
                        <span className="tabular ml-2 font-normal text-muted">
                          {data.manager.employeeCode}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <Badge tone="neutral">Unassigned</Badge>
                  )
                }
                hint={
                  data.manager
                    ? "Ask your administrator to change who you report to"
                    : "Nobody currently manages you. Your work and history are unaffected."
                }
              />
            </Card>
          </Section>

          <Section title="Account">
            <Card>
              <CardHeader title="Signing in" />
              <p className="px-5 pb-5 text-sm text-muted">
                Your session is managed by NIAT. To change your password or if you think
                somebody else has access to your account, contact your administrator — they can
                reset it for you.
              </p>
            </Card>
          </Section>
        </>
      ) : null}
    </div>
  );
}
