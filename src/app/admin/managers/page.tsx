"use client";

/**
 * Managers — the admin's primary operational page.
 *
 * ── One request, not one per university ────────────────────────────────────
 * This page used to load every university and then ask each one for its
 * managers, with the analytics engine running once per manager behind that. It
 * now makes a SINGLE call to `/api/managers`, which groups one engine pass per
 * university into per-manager figures server-side. Sorting and searching are
 * server-side too, so the browser never holds a partial set and sorts it into a
 * different answer than the API would give.
 *
 * ── One hours figure, and it is about students ─────────────────────────────
 * A roster is summarised here by its Working Hours — the time its instructors
 * spent WITH STUDENTS. Utilization used to lead this page: recorded minutes
 * against the configured working day, the Healthy / Borderline / Needs
 * attention band derived from it, the week-on-week movement in it, and the
 * filter that kept only the failing bands. None of it asked about students —
 * a roster whose week went to internal meetings scored exactly like one that
 * taught — and it routinely passed 100%. The "Deliverable" and
 * "Non-deliverable" columns went with it: they split hours by whether the
 * CATEGORY was literally "Deliverable Work", which filed a lecture under
 * "non-deliverable".
 *
 * So a manager is read by roster size and the hours that roster spent teaching,
 * and every row links through to the manager's own page for anything finer.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SearchInput,
  Section,
  Select,
  StatTile,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
} from "@/app/_components/ui";
import { apiGet, useLoad } from "@/app/_lib/api";
import { CreateStaffDialog } from "@/app/_components/CreateStaffDialog";
import { formatHours } from "@/app/_lib/format";

type ManagerRow = {
  id: string;
  name: string;
  email: string;
  employeeCode: string | null;
  isActive: boolean;
  isPrimary: boolean;
  universityId: string;
  universityName: string;
  universityCode: string;
  instructorCount: number;
  /** Time with students, summed across the roster. The one hours figure. */
  workingHours: number;
};

type Response = {
  managers: ManagerRow[];
  universities: Array<{ id: string; name: string; code: string }>;
  period: { from: string; to: string } | null;
};

const SORTS: Array<[string, string]> = [
  ["workingHours", "Working Hours"],
  ["instructors", "Instructors"],
  ["name", "Name"],
];

export default function AdminManagersPage() {
  const [sort, setSort] = useState("workingHours");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [universityId, setUniversityId] = useState("");
  const [status, setStatus] = useState("active");

  const load = useCallback(() => {
    const params = new URLSearchParams({ sort, order, status });
    if (search.trim()) params.set("search", search.trim());
    if (universityId) params.set("universityId", universityId);
    return apiGet<Response>(`/api/managers?${params}`, "Could not load managers.");
  }, [sort, order, search, universityId, status]);

  const { data, error, loading, reload } = useLoad(
    load,
    `admin-managers:${sort}:${order}:${search}:${universityId}:${status}`,
  );

  const [creating, setCreating] = useState(false);
  const rows = data?.managers ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Managers"
        description="Every manager and the performance of the instructors who report to them."
        actions={
          /* Adding one person belongs on the list of those people. Without it
             the only route to a single manager was the bulk CSV importer — a
             spreadsheet and a column mapping, to create one account. */
          <Button onClick={() => setCreating(true)}>Add manager</Button>
        }
      />

      <CreateStaffDialog
        open={creating}
        role="MANAGER"
        universities={data?.universities ?? []}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
      />

      {error ? <ErrorState message="Unable to load managers" detail={error} onRetry={reload} /> : null}

      {data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label="Managers" value={rows.length} />
          <StatTile
            label="Instructors on a roster"
            value={rows.reduce((n, m) => n + m.instructorCount, 0)}
          />
          <StatTile
            label="Working Hours this week"
            value={formatHours(rows.reduce((n, m) => n + m.workingHours, 0))}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader
          title={data?.period ? `Current week · ${data.period.from} to ${data.period.to}` : "Managers"}
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <SearchInput
                label="Search managers"
                value={search}
                onChange={setSearch}
                placeholder="Name, email, ID or university…"
                className="w-full sm:w-56"
              />
              <Field label="University">
                <Select
                  value={universityId}
                  onChange={(e) => setUniversityId(e.target.value)}
                  className="min-w-40"
                >
                  <option value="">All universities</option>
                  {(data?.universities ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value)} className="min-w-32">
                  <option value="active">Active</option>
                  <option value="inactive">Deactivated</option>
                  <option value="all">All</option>
                </Select>
              </Field>
              <Field label="Sort by">
                <Select value={sort} onChange={(e) => setSort(e.target.value)} className="min-w-40">
                  {SORTS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setOrder(order === "desc" ? "asc" : "desc")}
                aria-label={`Sort ${order === "desc" ? "ascending" : "descending"}`}
              >
                {order === "desc" ? "Highest first" : "Lowest first"}
              </Button>
            </div>
          }
        />

        {loading && !data ? (
          <TableSkeleton cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No managers match"
            description="Adjust the search or filters, or add a manager from a university."
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <TableWrap>
                <Table caption="Managers and their roster performance for the current week">
                  <THead
                    columns={[
                      { label: "Manager" },
                      { label: "Employee ID" },
                      { label: "University" },
                      { label: "Instructors", align: "right" },
                      { label: "Working Hours", align: "right" },
                      { label: "Status" },
                      { label: "Action" },
                    ]}
                  />
                  <TBody>
                    {rows.map((m) => (
                      <TR key={m.id}>
                        <TD strong>
                          <Link
                            href={`/admin/managers/${m.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {m.name}
                          </Link>
                          {m.isPrimary ? (
                            <span className="ml-2">
                              <Badge tone="primary">Primary</Badge>
                            </span>
                          ) : null}
                        </TD>
                        <TD>
                          <span className="tabular text-muted">{m.employeeCode ?? "—"}</span>
                        </TD>
                        <TD>
                          <Link
                            href={`/admin/universities/${m.universityId}`}
                            className="text-primary hover:underline"
                          >
                            {m.universityName}
                          </Link>
                        </TD>
                        <TD align="right">
                          <span className="tabular">{m.instructorCount}</span>
                        </TD>
                        <TD align="right">
                          <span className="tabular">{formatHours(m.workingHours)}</span>
                        </TD>
                        {/* Account status, which is what this column now means.
                            It used to carry the utilization band as well, and a
                            roster reading "Healthy" beside a deactivated account
                            was two unrelated facts wearing one heading. */}
                        <TD>
                          <Badge tone={m.isActive ? "success" : "neutral"}>
                            {m.isActive ? "Active" : "Deactivated"}
                          </Badge>
                        </TD>
                        <TD>
                          <ButtonLink
                            href={`/admin/managers/${m.id}`}
                            variant="secondary"
                            size="sm"
                            aria-label={`Open ${m.name}'s roster`}
                          >
                            View →
                          </ButtonLink>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            {/* Below the table's breakpoint the same facts stack, so a phone
                loses layout but never information. */}
            <div className="lg:hidden">
              <CardList>
                {rows.map((m) => (
                  <CardListItem
                    key={m.id}
                    href={`/admin/managers/${m.id}`}
                    title={
                      <>
                        {m.name}
                        {m.isPrimary ? (
                          <span className="ml-2">
                            <Badge tone="primary">Primary</Badge>
                          </span>
                        ) : null}
                        {!m.isActive ? (
                          <span className="ml-2">
                            <Badge tone="neutral">Deactivated</Badge>
                          </span>
                        ) : null}
                      </>
                    }
                    subtitle={
                      `${m.employeeCode ?? "—"} · ${m.universityName} · ${m.instructorCount} instructor` +
                      `${m.instructorCount === 1 ? "" : "s"}`
                    }
                    trailing={
                      <span className="text-right">
                        <span className="tabular block text-sm text-content">
                          {formatHours(m.workingHours)}
                        </span>
                        <span className="text-xs text-subtle">Working Hours</span>
                      </span>
                    }
                  />
                ))}
              </CardList>
            </div>
          </>
        )}
      </Card>

      <Section title="Unassigned instructors">
        <Card>
          <p className="px-5 py-4 text-sm text-muted">
            Instructors who report to nobody appear on no roster above.{" "}
            <Link href="/admin/instructors" className="text-primary hover:underline">
              Open the instructor directory
            </Link>{" "}
            to assign them.
          </p>
        </Card>
      </Section>
    </div>
  );
}
