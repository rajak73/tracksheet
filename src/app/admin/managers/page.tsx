"use client";

/**
 * Every manager, across every university.
 *
 * There is no single "list all managers" endpoint — managers are read per
 * university, the same as the manager-creation form on a university's detail
 * page. This assembles the cross-tenant view the same way the deliverables
 * page assembles a per-instructor view: one request per university, in
 * parallel, over data the server already scopes correctly. No new endpoint,
 * no new authorization path (§39).
 */

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

type University = { id: string; name: string };
type Manager = {
  id: string;
  employeeCode: string | null;
  isPrimary: boolean;
  instructorCount: number;
  user: { name: string; email: string; isActive: boolean };
};

type Row = Manager & { universityId: string; universityName: string };

export default function AdminManagersPage() {
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const universities = await apiGet<{ universities: University[] }>(
      "/api/universities?limit=200",
      "Could not load universities.",
    );

    const perUniversity = await Promise.all(
      universities.universities.map(async (u) => {
        const body = await apiGet<{ managers: Manager[] }>(
          `/api/universities/${u.id}/managers`,
          "Could not load managers.",
        ).catch(() => ({ managers: [] as Manager[] }));
        return body.managers.map((m) => ({ ...m, universityId: u.id, universityName: u.name }));
      }),
    );

    return perUniversity.flat();
  }, []);

  const { data, error, loading, reload } = useLoad(load, "admin-managers");

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return data;
    return data.filter(
      (m: Row) =>
        m.user.name.toLowerCase().includes(needle) ||
        m.user.email.toLowerCase().includes(needle) ||
        m.universityName.toLowerCase().includes(needle),
    );
  }, [data, query]);

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Managers" description="Every manager across all universities." />
        <TableSkeleton cols={5} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Managers" />
        <ErrorState message="Unable to load managers" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <PageHeader title="Managers" description="Every manager across all universities." />
      <Card>
        <CardHeader
          title={`${data.length} manager${data.length === 1 ? "" : "s"}`}
          actions={
            data.length > 5 ? (
              <SearchInput
                label="Search managers"
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
            title="No managers yet"
            description="Assign a primary manager from a university's detail page."
          />
        ) : rows.length === 0 ? (
          <EmptyState title="No manager matches that search" />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <Table caption="Managers across every university">
                  <THead
                    columns={[
                      { label: "Manager" },
                      { label: "Email" },
                      { label: "University" },
                      { label: "Instructors", align: "right" },
                      { label: "Status" },
                    ]}
                  />
                  <TBody>
                    {rows.map((m: Row) => (
                      <TR key={m.id}>
                        <TD strong>
                          {m.user.name}
                          {m.isPrimary ? (
                            <span className="ml-2">
                              <Badge tone="primary">Primary</Badge>
                            </span>
                          ) : null}
                        </TD>
                        <TD>{m.user.email}</TD>
                        <TD>
                          <Link
                            href={`/admin/universities/${m.universityId}`}
                            className="text-primary hover:underline"
                          >
                            {m.universityName}
                          </Link>
                        </TD>
                        <TD align="right">{m.instructorCount}</TD>
                        <TD>
                          <Badge tone={m.user.isActive ? "success" : "neutral"}>
                            {m.user.isActive ? "Active" : "Inactive"}
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
                {rows.map((m: Row) => (
                  <CardListItem
                    key={m.id}
                    href={`/admin/universities/${m.universityId}`}
                    title={m.user.name}
                    subtitle={m.universityName}
                    trailing={<StatusPill status={m.user.isActive ? "ACTIVE" : "INACTIVE"} />}
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
