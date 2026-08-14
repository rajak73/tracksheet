"use client";

import { useCallback, useState } from "react";
import {
  Badge,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
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

type InstructorsResponse = {
  instructors: Instructor[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export default function AdminInstructorsPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const setQueryAndResetPage = useCallback((next: string) => {
    setQuery(next);
    setPage(1);
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (query.trim()) params.set("search", query.trim());
    return apiGet<InstructorsResponse>(
      `/api/instructors?${params.toString()}`,
      "Could not load instructors.",
    );
  }, [page, query]);

  const { data, error, loading, reload } = useLoad(load, `admin-instructors:${page}:${query}`);
  const rows = data?.instructors ?? [];

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

  const isEmpty = data.total === 0 && !query.trim();

  return (
    <div className="space-y-4">
      <PageHeader title="Instructors" description="Every instructor across all universities." />
      <Card>
        <CardHeader
          title={`${data.total} instructor${data.total === 1 ? "" : "s"}`}
          actions={
            data.total > 5 || query.trim() ? (
              <SearchInput
                label="Search instructors"
                value={query}
                onChange={setQueryAndResetPage}
                placeholder="Search by name, email or university…"
                className="w-full sm:w-64"
              />
            ) : null
          }
        />
        {isEmpty ? (
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
        <Pagination
          page={data.page}
          limit={data.limit}
          total={data.total}
          hasMore={data.hasMore}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
