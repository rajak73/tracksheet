"use client";

/**
 * The audit trail, scoped one university at a time.
 *
 * The endpoint is per-university by design — an audit log is inherently about
 * other people, so it stays scoped rather than becoming a platform-wide feed
 * (see the route's own comment). This page is the admin-only entry point that
 * previously had no UI at all.
 */

import { useCallback, useState } from "react";
import {
  Badge,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  Select,
  TableSkeleton,
} from "@/app/_components/ui";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatDate } from "@/app/_lib/format";

type University = { id: string; name: string };
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

const ACTIONS = [
  "UNIVERSITY_CONFIG_UPDATED",
  "WORKLOAD_TARGET_CHANGED",
  "SCHEDULE_SLOT_CREATED",
  "LEAVE_RECORDED",
  "INSIGHT_GENERATED",
];

export default function AdminAuditPage() {
  const [universityId, setUniversityId] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  const setUniversityIdAndResetPage = useCallback((next: string) => {
    setUniversityId(next);
    setPage(1);
  }, []);

  const setActionAndResetPage = useCallback((next: string) => {
    setAction(next);
    setPage(1);
  }, []);

  const load = useCallback(async () => {
    const body = await apiGet<{ universities: University[] }>(
      "/api/universities?limit=200",
      "Could not load universities.",
    );
    return body.universities;
  }, []);

  const { data: universities, error, loading, reload } = useLoad(load, "admin-audit-universities");

  const activeId = universityId || universities?.[0]?.id || "";

  const entriesLoad = useCallback(async () => {
    if (!activeId) {
      return { entries: [], page: 1, limit: 100, total: 0, hasMore: false } as AuditResponse;
    }
    const params = new URLSearchParams({ page: String(page) });
    if (action) params.set("action", action);
    return apiGet<AuditResponse>(
      `/api/universities/${activeId}/audit?${params.toString()}`,
      "Could not load the audit trail for this university.",
    );
  }, [activeId, action, page]);

  const entries = useLoad(entriesLoad, `${activeId}:${action}:${page}`);

  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="University" className="w-full sm:w-auto">
        <Select
          value={activeId}
          onChange={(e) => setUniversityIdAndResetPage(e.target.value)}
          className="w-full min-w-0 sm:w-auto sm:min-w-48"
        >
          {(universities ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Action" className="w-full sm:w-auto">
        <Select
          value={action}
          onChange={(e) => setActionAndResetPage(e.target.value)}
          className="w-full min-w-0 sm:w-auto sm:min-w-48"
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a.replaceAll("_", " ").toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audit Logs" />
        <TableSkeleton cols={4} />
      </div>
    );
  }
  if (error || !universities) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audit Logs" />
        <ErrorState message="Unable to load universities" detail={error ?? undefined} onRetry={reload} />
      </div>
    );
  }
  if (universities.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audit Logs" />
        <Card>
          <EmptyState title="No universities yet" description="There is nothing to audit until a university exists." />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Who changed what, per university. An audit log is inherently about other people, so it is never shown platform-wide in one feed."
        actions={controls}
      />

      <Card>
        <CardHeader title="Recent activity" />
        {entries.loading ? (
          <div className="p-5">
            <TableSkeleton cols={4} rows={6} />
          </div>
        ) : entries.error ? (
          <div className="p-5">
            <ErrorState message="Unable to load the audit trail" detail={entries.error} onRetry={entries.reload} />
          </div>
        ) : !entries.data || (entries.data.total === 0 && !action) ? (
          <EmptyState
            title="No audit entries yet"
            description="Actions like configuration changes and insight generation appear here as they happen."
          />
        ) : entries.data.entries.length === 0 ? (
          <EmptyState title="No audit entries match that filter" />
        ) : (
          <CardList>
            {entries.data.entries.map((e) => (
              <CardListItem
                key={e.id}
                title={e.action.replaceAll("_", " ").toLowerCase()}
                subtitle={e.user ? `${e.user.name} · ${e.user.role.toLowerCase()}` : "System"}
                meta={<Badge tone="neutral">{formatDate(e.createdAt)}</Badge>}
              />
            ))}
          </CardList>
        )}
        <Pagination
          page={entries.data?.page ?? 1}
          limit={entries.data?.limit ?? 100}
          total={entries.data?.total ?? 0}
          hasMore={entries.data?.hasMore ?? false}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
