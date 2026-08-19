"use client";

/**
 * A manager's audit trail.
 *
 * Reuses the existing per-university audit endpoint rather than adding a second
 * audit system — `GET /api/universities/[id]/audit` already admits MANAGER and
 * is tenant-scoped by `withAuth`, so a manager reads their own university's
 * trail and no other. The university id comes from the session, never from a
 * picker, because a manager has exactly one and offering a choice would imply
 * otherwise.
 *
 * What a manager sees here is their tenant's recorded actions, including their
 * own: removing someone from a roster and editing an instructor's profile are
 * both audited by the routes that perform them, so this page needs no special
 * logging of its own.
 */

import { useCallback, useState } from "react";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  Select,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
} from "@/app/_components/ui";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate, humanizeCode } from "@/app/_lib/format";

type Entry = {
  id: string;
  action: string;
  entityType: string | null;
  createdAt: string;
  user: { name: string; email: string; role: string } | null;
};

type AuditResponse = {
  entries: Entry[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

/** The actions a manager's work actually produces, plus the roster changes. */
const ACTIONS = [
  "INSTRUCTOR_MANAGER_UNASSIGNED",
  "INSTRUCTOR_MANAGER_ASSIGNED",
  "INSTRUCTOR_UPDATED",
  "INSTRUCTOR_CREATED",
  "ACTIVITY_LOGGED",
  "LEAVE_RECORDED",
  "TRACKER_EXPORTED",
];

export default function ManagerAuditLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) throw new Error("No university is linked to this account.");
    const params = new URLSearchParams({ page: String(page) });
    if (action) params.set("action", action);
    const body = await apiGet<AuditResponse>(
      `/api/universities/${me.user.universityId}/audit?${params}`,
      "Could not load your audit trail.",
    );
    return body;
  }, [page, action]);

  const { data, error, loading, reload } = useLoad(load, `manager-audit:${page}:${action}`);
  const entries = data?.entries ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Logs"
        description="Recorded actions in your university, newest first."
      />

      {error ? (
        <ErrorState message="Unable to load the audit trail" detail={error} onRetry={reload} />
      ) : null}

      <Card>
        <CardHeader
          title={data ? `${data.total} entr${data.total === 1 ? "y" : "ies"}` : "Audit trail"}
          actions={
            <Field label="Action">
              <Select
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setPage(1);
                }}
                className="min-w-56"
              >
                <option value="">All actions</option>
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {humanizeCode(a)}
                  </option>
                ))}
              </Select>
            </Field>
          }
        />

        {loading && !data ? (
          <TableSkeleton cols={4} />
        ) : entries.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description={
              action
                ? "No entry matches that action. Try clearing the filter."
                : "Actions such as removing someone from your roster appear here once they happen."
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table caption="Audit entries for your university">
                <THead
                  columns={[
                    { label: "When" },
                    { label: "Action" },
                    { label: "Entity" },
                    { label: "By" },
                  ]}
                />
                <TBody>
                  {entries.map((e) => (
                    <TR key={e.id}>
                      <TD>
                        <span className="tabular">{formatDate(e.createdAt)}</span>
                      </TD>
                      <TD strong>
                        <Badge tone="neutral">{humanizeCode(e.action)}</Badge>
                      </TD>
                      <TD>{e.entityType ?? "—"}</TD>
                      <TD>
                        {e.user ? (
                          <>
                            <span className="block">{e.user.name}</span>
                            <span className="block text-xs text-muted">
                              {humanizeCode(e.user.role)}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <Pagination
              page={data!.page}
              limit={data!.limit}
              total={data!.total}
              hasMore={data!.hasMore}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
