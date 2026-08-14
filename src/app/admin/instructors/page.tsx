"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  StatusPill,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
} from "@/app/_components/ui";
import Link from "next/link";
import { apiGet, useLoad } from "@/app/_lib/api";

type Instructor = {
  id: string;
  universityId: string;
  employeeCode: string | null;
  user: { name: string; email: string; isActive: boolean };
  university: { name: string; timezone: string };
};

export default function AdminInstructorsPage() {
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const body = await apiGet<{ instructors: Instructor[] }>(
      "/api/instructors",
      "Could not load instructors.",
    );
    return body.instructors;
  }, []);

  const { data, error, loading, reload } = useLoad(load, "admin-instructors");

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return data;
    return data.filter(
      (i) =>
        i.user.name.toLowerCase().includes(needle) ||
        i.user.email.toLowerCase().includes(needle) ||
        i.university.name.toLowerCase().includes(needle),
    );
  }, [data, query]);

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Instructors" description="Every instructor across all universities." />
        <TableSkeleton cols={5} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Instructors" />
        <ErrorState message="Unable to load instructors" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <PageHeader title="Instructors" description="Every instructor across all universities." />
      <Card>
        <CardHeader
          title={`${data.length} instructor${data.length === 1 ? "" : "s"}`}
          actions={
            data.length > 5 ? (
              <SearchInput
                label="Search instructors"
                value={query}
                onChange={setQuery}
                placeholder="Search by name, email or university…"
                className="w-full sm:w-64"
              />
            ) : null
          }
        />
        {data.length === 0 ? (
          <EmptyState
            title="No instructors yet"
            description="Instructors are added by their university's manager."
          />
        ) : rows.length === 0 ? (
          <EmptyState title="No instructor matches that search" />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <Table caption="Instructors across every university">
                  <THead
                    columns={[
                      { label: "Instructor" },
                      { label: "Email" },
                      { label: "Employee code" },
                      { label: "University" },
                      { label: "Status" },
                    ]}
                  />
                  <TBody>
                    {rows.map((i) => (
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
            </div>
            <div className="md:hidden">
              <CardList>
                {rows.map((i) => (
                  <CardListItem
                    key={i.id}
                    href={`/admin/instructors/${i.id}`}
                    title={i.user.name}
                    subtitle={i.university.name}
                    trailing={<StatusPill status={i.user.isActive ? "ACTIVE" : "INACTIVE"} />}
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
