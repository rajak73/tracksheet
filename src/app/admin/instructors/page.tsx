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
import { ManagerAssign, useManagerCache } from "@/app/_components/ManagerAssign";
import { CategoryPicker, type InstructorCategory } from "@/app/_components/CategoryPicker";

type Instructor = {
  id: string;
  universityId: string;
  employeeCode: string | null;
  user: { name: string; email: string; isActive: boolean };
  university: { name: string; timezone: string };
  manager: { id: string; employeeCode: string | null; name: string } | null;
  /** What they teach — the column the client's monthly sheet prints. */
  category: { code: string; label: string } | null;
};


type InstructorsResponse = {
  instructors: Instructor[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export default function AdminInstructorsPage() {
  // One cache for every row, so the directory fetches each university's
  // managers once rather than once per instructor.
  const managerCache = useManagerCache();
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

  /* Reference data, fetched once — it does not change when the search does. */
  const categoriesLoad = useCallback(
    () =>
      apiGet<{ categories: InstructorCategory[] }>(
        "/api/instructor-categories",
        "Could not load the category list.",
      ),
    [],
  );
  const categories = useLoad(categoriesLoad, "instructor-categories");
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
                      { label: "Broad Category" },
                      { label: "University" },
                      { label: "Manager" },
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
                        <TD>
                          {/* Editable in place. It is one value from a closed
                              list, reversible in the same control, and an unset
                              category is a blank column in the client's sheet —
                              so it is made easy to set rather than hidden
                              behind a dialog. */}
                          <CategoryPicker
                            instructorId={i.id}
                            current={i.category?.code ?? ""}
                            options={categories.data?.categories ?? []}
                            onSaved={reload}
                          />
                        </TD>
                        <TD>{i.university.name}</TD>
                        <TD>
                          <ManagerAssign
                            instructorId={i.id}
                            universityId={i.universityId}
                            current={i.manager ? { id: i.manager.id, name: i.manager.name } : null}
                            cache={managerCache}
                            onChanged={reload}
                          />
                        </TD>
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
                    subtitle={`${i.university.name} · ${i.manager ? i.manager.name : "Unassigned"}`}
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
