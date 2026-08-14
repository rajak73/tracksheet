"use client";

import { useCallback, useState } from "react";
import {
  Badge,
  Card,
  CardBody,
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
import { StaffForm } from "@/app/_components/StaffForm";
import { apiGet, useLoad } from "@/app/_lib/api";

type Instructor = {
  id: string;
  employeeCode: string | null;
  user: { name: string; email: string; isActive: boolean };
};

type InstructorsResponse = {
  instructors: Instructor[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export default function ManagerInstructorsPage() {
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
      "Could not load your instructors.",
    );
  }, [page, query]);

  const { data, error, loading, reload } = useLoad(load, `manager-instructors:${page}:${query}`);
  const rows = data?.instructors ?? [];

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Instructors" description="Instructors in your university." />
        <TableSkeleton cols={4} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Instructors" />
        <ErrorState message="Unable to load instructors" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  const isEmpty = data.total === 0 && !query.trim();

  return (
    <div className="space-y-6">
      <PageHeader title="Instructors" description="The list is scoped by the server to your university." />

      <Card>
        <CardHeader
          title="Add an instructor"
          description="New instructors join your university automatically — the tenant comes from your session, never from this form."
        />
        <CardBody>
          <StaffForm endpoint="/api/instructors" roleLabel="instructor" onCreated={reload} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`${data.total} instructor${data.total === 1 ? "" : "s"}`}
          actions={
            data.total > 5 || query.trim() ? (
              <SearchInput
                label="Search instructors"
                value={query}
                onChange={setQueryAndResetPage}
                placeholder="Search by name, email or code…"
                className="w-full sm:w-64"
              />
            ) : null
          }
        />
        {isEmpty ? (
          <EmptyState
            title="No instructors yet"
            description="Add your first instructor using the form above — they can sign in immediately."
          />
        ) : rows.length === 0 ? (
          <EmptyState title="No instructor matches that search" />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <Table caption="Instructors in your university">
                  <THead
                    columns={[
                      { label: "Instructor" },
                      { label: "Email" },
                      { label: "Employee code" },
                      { label: "Status" },
                    ]}
                  />
                  <TBody>
                    {rows.map((i) => (
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
            </div>
            <div className="md:hidden">
              <CardList>
                {rows.map((i) => (
                  <CardListItem
                    key={i.id}
                    title={i.user.name}
                    subtitle={i.user.email}
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
