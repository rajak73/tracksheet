"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader,
  Table, TableSkeleton, TableWrap, TBody, TD, THead, TR,
} from "@/app/_components/ui";
import { StaffForm } from "@/app/_components/StaffForm";

type Instructor = {
  id: string;
  employeeCode: string | null;
  user: { name: string; email: string; isActive: boolean };
};

export default function ManagerInstructorsPage() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/instructors");
      if (!res.ok) return setError(`Could not load instructors (HTTP ${res.status})`);
      setInstructors((await res.json()).instructors);
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Instructors" description="Instructors in your university." />
        <TableSkeleton cols={4} />
      </div>
    );
  }
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Instructors"
        description="The list is scoped by the server to your university."
      />

      <Card>
        <CardHeader
          title="Add an instructor"
          description="New instructors join your university automatically — the tenant comes from your session, never from this form."
        />
        <CardBody>
          <StaffForm endpoint="/api/instructors" roleLabel="instructor" onCreated={load} />
        </CardBody>
      </Card>

      <Card>
        {instructors.length === 0 ? (
          <EmptyState
            title="No instructors yet"
            description="Add your first instructor using the form above — they can sign in immediately."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead columns={[{ label: "Instructor" }, { label: "Email" }, { label: "ID" }, { label: "Status" }]} />
              <TBody>
                {instructors.map((i) => (
                  <TR key={i.id}>
                    <TD strong>{i.user.name}</TD>
                    <TD>{i.user.email}</TD>
                    <TD>{i.employeeCode ?? "—"}</TD>
                    <TD>
                      <Badge tone={i.user.isActive ? "success" : "neutral"}>
                        {i.user.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
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
