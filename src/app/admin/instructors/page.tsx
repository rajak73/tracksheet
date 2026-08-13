"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge, Card, EmptyState, ErrorState, PageHeader, Table, TableSkeleton,
  TableWrap, TBody, TD, THead, TR,
} from "@/app/_components/ui";

type Instructor = {
  id: string;
  universityId: string;
  employeeCode: string | null;
  user: { name: string; email: string; isActive: boolean };
  university: { name: string; timezone: string };
};

export default function AdminInstructorsPage() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/instructors");
        if (!res.ok) return setError(`Could not load instructors (HTTP ${res.status})`);
        setInstructors((await res.json()).instructors);
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
        <PageHeader title="Instructors" description="Every instructor across all universities." />
        <TableSkeleton cols={5} />
      </div>
    );
  }
  if (error) return <ErrorState message={error} />;

  return (
    <div>
      <PageHeader title="Instructors" description="Every instructor across all universities." />
      <Card>
        {instructors.length === 0 ? (
          <EmptyState
            title="No instructors yet"
            description="Instructors are added by their university's manager."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead columns={[{ label: "Instructor" }, { label: "Email" }, { label: "ID" }, { label: "University" }, { label: "Status" }]} />
              <TBody>
                {instructors.map((i) => (
                  <TR key={i.id}>
                    <TD strong>
                      <Link href={`/admin/instructors/${i.id}`} className="text-primary hover:underline">
                        {i.user.name}
                      </Link>
                    </TD>
                    <TD>{i.user.email}</TD>
                    <TD>{i.employeeCode ?? "—"}</TD>
                    <TD>{i.university.name}</TD>
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
