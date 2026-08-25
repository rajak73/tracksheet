"use client";

/**
 * The admin staff directory — the operational home for employee lifecycle.
 *
 * Instructors and managers in one list, because "who works here" is one
 * question. Status defaults to Active for the same reason; former staff are one
 * filter away and never deleted.
 *
 * ── What this screen deliberately does NOT do ──────────────────────────────
 * It never shows, requests, or stores a password after creation. The initial
 * password is typed once into the create form, sent to the server, hashed
 * there, and never returned — so there is nothing for this page to display,
 * and the operator is told to pass it on out of band.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  Toggle,
  TR,
  inputClass,
} from "@/app/_components/ui";
import { ConfirmDialog, Dialog, useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { InstructorStream } from "@/app/_components/InstructorStream";
import { CreateStaffDialog } from "@/app/_components/CreateStaffDialog";
import { formatDate } from "@/app/_lib/format";

type Staff = {
  userId: string;
  name: string;
  email: string;
  role: "INSTRUCTOR" | "MANAGER";
  isActive: boolean;
  createdAt: string;
  universityId: string | null;
  universityName: string | null;
  employeeCode: string | null;
  instructorId: string | null;
  /** What an instructor teaches. Null for managers, and for anyone unfiled. */
  category: { code: string; label: string } | null;
  managerId: string | null;
  /** Null for an instructor. Zero is a real answer for a manager. */
  rosterSize: number | null;
  isPrimaryManager: boolean;
  /** When they left, and why. Null while they still work here. */
  leftOn: string | null;
  leftReason: string | null;
};

type StaffResponse = {
  staff: Staff[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

type University = { id: string; name: string };

export default function AdminStaffPage() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "former" | "all">("active");
  const [role, setRole] = useState("");
  const [universityId, setUniversityId] = useState("");
  const [page, setPage] = useState(1);

  // Any filter change resets to page 1 — otherwise a narrowed result set can
  // leave the operator on a page that no longer exists.
  const withReset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Staff | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), status });
    if (query.trim()) params.set("search", query.trim());
    if (role) params.set("role", role);
    if (universityId) params.set("universityId", universityId);
    const [staff, universities] = await Promise.all([
      apiGet<StaffResponse>(`/api/staff?${params}`, "Could not load staff."),
      apiGet<{ universities: University[] }>(
        "/api/universities?limit=200",
        "Could not load universities.",
      ),
    ]);
    return { ...staff, universities: universities.universities };
  }, [page, status, query, role, universityId]);

  const { data, error, loading, reload } = useLoad(
    load,
    `admin-staff:${page}:${status}:${query}:${role}:${universityId}`,
  );

  async function setActive(
    person: Staff,
    isActive: boolean,
    extra?: { reason?: string; successorManagerId?: string },
  ) {
    try {
      await apiSend(
        `/api/staff/${person.userId}`,
        "PATCH",
        { isActive, ...extra },
        "Could not update.",
      );
      toast("success", `${person.name} is now ${isActive ? "active" : "a former employee"}.`);
      setPending(null);
      reload();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not update this employee.");
      throw e;
    }
  }

  const filters = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Status" className="w-full sm:w-auto">
        <Select
          value={status}
          onChange={(e) => withReset(setStatus)(e.target.value as typeof status)}
          className="w-full min-w-0 sm:w-auto sm:min-w-36"
        >
          <option value="active">Active</option>
          <option value="former">Former</option>
          <option value="all">All</option>
        </Select>
      </Field>
      <Field label="Role" className="w-full sm:w-auto">
        <Select
          value={role}
          onChange={(e) => withReset(setRole)(e.target.value)}
          className="w-full min-w-0 sm:w-auto sm:min-w-36"
        >
          <option value="">All roles</option>
          <option value="INSTRUCTOR">Instructor</option>
          <option value="MANAGER">Manager</option>
        </Select>
      </Field>
      <Field label="University" className="w-full sm:w-auto">
        <Select
          value={universityId}
          onChange={(e) => withReset(setUniversityId)(e.target.value)}
          className="w-full min-w-0 sm:w-auto sm:min-w-48"
        >
          <option value="">All universities</option>
          {(data?.universities ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
      <SearchInput
        label="Search staff"
        value={query}
        onChange={withReset(setQuery)}
        placeholder="Name, email or employee ID…"
        className="w-full sm:w-64"
      />
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staff"
        description="Instructors and managers across every university. Deactivating someone revokes access and keeps all of their history."
        actions={<Button onClick={() => setCreating(true)}>Add employee</Button>}
      />

      <Card>
        <CardBody>{filters}</CardBody>
      </Card>

      {loading ? (
        <TableSkeleton cols={7} />
      ) : error || !data ? (
        <ErrorState message="Unable to load staff" detail={error ?? undefined} onRetry={reload} />
      ) : (
        <Card>
          <CardHeader
            title={`${data.total} ${status === "all" ? "employee" : status} ${
              data.total === 1 ? "record" : "records"
            }`}
          />
          {data.staff.length === 0 ? (
            <EmptyState
              title="No staff match these filters"
              description={
                status === "active"
                  ? "Try the Former or All status filter — nobody is hidden, only filtered."
                  : "Adjust the filters or add an employee."
              }
            />
          ) : (
            <>
              <div className="hidden md:block">
                <TableWrap>
                  <Table caption="Staff directory">
                    <THead
                      columns={[
                        { label: "Employee" },
                        { label: "Employee ID" },
                        { label: "Broad Category" },
                        { label: "Role" },
                        { label: "University" },
                        { label: "Status" },
                        { label: "Created" },
                      ]}
                    />
                    <TBody>
                      {data.staff.map((s) => (
                        <TR key={s.userId}>
                          <TD strong>
                            {s.instructorId ? (
                              <Link
                                href={`/admin/instructors/${s.instructorId}/report`}
                                className="text-primary hover:underline"
                              >
                                {s.name}
                              </Link>
                            ) : (
                              s.name
                            )}
                            <span className="mt-0.5 block text-xs text-muted">{s.email}</span>
                          </TD>
                          <TD>{s.employeeCode ?? "—"}</TD>
                          <TD>
                            {/* Read-only: counted from their entries. A manager
                                has none — they do not teach a stream — and that
                                is an em dash, not "not yet determined". */}
                            {s.instructorId ? (
                              <InstructorStream stream={s.category ?? null} />
                            ) : (
                              <span className="text-subtle">—</span>
                            )}
                          </TD>
                          <TD>
                            <Badge tone={s.role === "MANAGER" ? "primary" : "neutral"}>
                              {s.role === "MANAGER" ? "Manager" : "Instructor"}
                            </Badge>
                          </TD>
                          <TD>{s.universityName ?? "—"}</TD>
                          <TD>
                            {/* The status IS the control now. It was a pill
                                here and a Deactivate/Reactivate button in a
                                column at the far right, which put the fact and
                                the thing that changes it several columns
                                apart on a table this wide.

                                The switch does not move on click: it renders
                                what the server says, and the click only opens
                                the dialog below. Deactivating captures a
                                leaving reason and, for a manager with a
                                roster, a successor — so a switch that flipped
                                itself would be showing an outcome that has not
                                happened and may yet be cancelled. */}
                            <Toggle
                              checked={s.isActive}
                              onChange={() => setPending(s)}
                              label={`Account status for ${s.name}`}
                              onLabel="Active"
                              offLabel="Former"
                            />
                            {/* When and why, on the row itself. A leavers list
                                that only says "Former" answers half the
                                question anybody opens it to ask. */}
                            {!s.isActive && s.leftOn ? (
                              <span className="mt-1 block text-xs text-muted">
                                Left {formatDate(s.leftOn)}
                              </span>
                            ) : null}
                            {!s.isActive && s.leftReason ? (
                              <span className="mt-0.5 block max-w-[14rem] text-xs text-subtle">
                                {s.leftReason}
                              </span>
                            ) : null}
                          </TD>
                          <TD>{formatDate(s.createdAt)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>

              <div className="md:hidden">
                <CardList>
                  {data.staff.map((s) => (
                    <CardListItem
                      key={s.userId}
                      title={s.name}
                      subtitle={
                        <span>
                          {s.employeeCode ?? "—"} · {s.role === "MANAGER" ? "Manager" : "Instructor"}
                          {s.universityName ? ` · ${s.universityName}` : ""}
                        </span>
                      }
                      /* The same switch the table row uses, so the phone reads
                         the status and changes it in one place too rather than
                         carrying a pill on one side of the card and a button on
                         the other. */
                      meta={
                        <Toggle
                          checked={s.isActive}
                          onChange={() => setPending(s)}
                          label={`Account status for ${s.name}`}
                          onLabel="Active"
                          offLabel="Former"
                        />
                      }
                      trailing={
                        !s.isActive && s.leftOn ? (
                          <div className="text-right">
                            <span className="block text-xs text-muted">
                              Left {formatDate(s.leftOn)}
                            </span>
                          </div>
                        ) : undefined
                      }
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
      )}

      {/* Reactivating is a one-line consequence, so it stays a confirm. Leaving
          is not: it needs a reason, and for a manager it needs somewhere for
          the roster to go. See `DepartureDialog`. */}
      {pending && !pending.isActive ? (
        <ConfirmDialog
          open
          onClose={() => setPending(null)}
          onConfirm={() => setActive(pending, true)}
          title={`Reactivate ${pending.name}?`}
          confirmLabel="Reactivate"
          description="They will be able to sign in again and will reappear in current operational lists. Their historical records are unchanged."
        />
      ) : null}

      {pending?.isActive ? (
        <DepartureDialog
          person={pending}
          onClose={() => setPending(null)}
          onConfirm={(extra) => setActive(pending, false, extra)}
        />
      ) : null}

      <CreateStaffDialog
        open={creating}
        universities={data?.universities ?? []}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
      />
    </div>
  );
}

/**
 * Processing someone's departure.
 *
 * ── Why this is not a confirm dialog ──────────────────────────────────────
 * Reactivating is one sentence of consequence and a yes. Leaving is not. It has
 * to capture WHY — a leavers list without reasons is a list of names — and, for
 * a manager, it has to decide where their roster goes before the roster is left
 * pointing at somebody who can no longer sign in.
 *
 * ── The successor question is asked, not discovered ───────────────────────
 * The server refuses a manager's departure with 422 SUCCESSOR_REQUIRED when a
 * roster is still attached, and that refusal is the real guard. But finding out
 * only after pressing the button is a bad way to learn that six people are
 * about to be orphaned, so the row already carries `rosterSize` and
 * `isPrimaryManager` and the field appears before the mistake can be made.
 */
function DepartureDialog({
  person,
  onClose,
  onConfirm,
}: {
  person: Staff;
  onClose: () => void;
  onConfirm: (extra: { reason?: string; successorManagerId?: string }) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [successor, setSuccessor] = useState("");
  const [saving, setSaving] = useState(false);

  const needsSuccessor =
    person.managerId !== null && ((person.rosterSize ?? 0) > 0 || person.isPrimaryManager);

  const load = useCallback(() => {
    if (!needsSuccessor || !person.universityId) {
      return Promise.resolve({ managers: [] as Array<{ id: string; user: { name: string } }> });
    }
    return apiGet<{ managers: Array<{ id: string; user: { name: string } }> }>(
      `/api/universities/${person.universityId}/managers`,
      "Could not load the other managers.",
    );
  }, [needsSuccessor, person.universityId]);
  const managers = useLoad(load, `handover:${person.userId}`);

  // Never offer the person who is leaving as their own successor.
  const candidates = (managers.data?.managers ?? []).filter((m) => m.id !== person.managerId);

  async function submit() {
    setSaving(true);
    try {
      await onConfirm({
        reason: reason.trim() || undefined,
        successorManagerId: needsSuccessor ? successor : undefined,
      });
    } catch {
      // The toast is raised by the caller; the dialog stays open so the
      // operator can correct whatever was refused rather than start again.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Record ${person.name}'s departure`}
      description="They will no longer be able to sign in, and every session they have open ends immediately. Nothing is deleted — their recorded activity, deliverables, reports and tracker history are kept in full and stay visible in historical reports, marked Former."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={saving || (needsSuccessor && !successor)}
          >
            {saving ? "Recording…" : "Record departure"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {needsSuccessor ? (
          <Field
            label="Who takes over their roster?"
            required
            hint={
              person.isPrimaryManager && (person.rosterSize ?? 0) === 0
                ? "They are this university's primary manager, so unassigned instructors answer to them."
                : `${person.rosterSize} instructor${person.rosterSize === 1 ? "" : "s"} report to them today. Without a successor those records would belong to nobody.`
            }
          >
            {managers.loading ? (
              <p className="text-sm text-muted">Loading managers…</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-danger-text">
                There is no other manager in this university. Create one before recording this
                departure.
              </p>
            ) : (
              <Select value={successor} onChange={(e) => setSuccessor(e.target.value)}>
                <option value="">Choose a manager…</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        <Field
          label="Reason"
          hint="Kept on their record and on the audit entry. Written by you — the system never guesses one."
        >
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Resigned, contract ended, transferred…"
            className={inputClass}
          />
        </Field>
      </div>
    </Dialog>
  );
}
