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
  StatusPill,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  inputClass,
} from "@/app/_components/ui";
import { ConfirmDialog, Dialog, useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
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

  async function setActive(person: Staff, isActive: boolean) {
    try {
      await apiSend(`/api/staff/${person.userId}`, "PATCH", { isActive }, "Could not update.");
      toast("success", `${person.name} is now ${isActive ? "active" : "a former employee"}.`);
      setPending(null);
      reload();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not update this employee.");
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
                        { label: "Role" },
                        { label: "University" },
                        { label: "Status" },
                        { label: "Created" },
                        { label: "Actions", align: "right" },
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
                            <Badge tone={s.role === "MANAGER" ? "primary" : "neutral"}>
                              {s.role === "MANAGER" ? "Manager" : "Instructor"}
                            </Badge>
                          </TD>
                          <TD>{s.universityName ?? "—"}</TD>
                          <TD>
                            <StatusPill status={s.isActive ? "ACTIVE" : "FORMER"} />
                          </TD>
                          <TD>{formatDate(s.createdAt)}</TD>
                          <TD align="right">
                            <Button
                              size="sm"
                              variant={s.isActive ? "secondary" : "primary"}
                              onClick={() => setPending(s)}
                            >
                              {s.isActive ? "Deactivate" : "Reactivate"}
                            </Button>
                          </TD>
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
                      meta={
                        <Button
                          size="sm"
                          variant={s.isActive ? "secondary" : "primary"}
                          onClick={() => setPending(s)}
                        >
                          {s.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      }
                      trailing={<StatusPill status={s.isActive ? "ACTIVE" : "FORMER"} />}
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

      {/* Deactivate / reactivate — the consequence is spelled out, because the
          fear this dialog has to answer is "will I lose their data". */}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => pending && setActive(pending, !pending.isActive)}
        title={pending?.isActive ? `Deactivate ${pending?.name}?` : `Reactivate ${pending?.name}?`}
        confirmLabel={pending?.isActive ? "Deactivate" : "Reactivate"}
        destructive={pending?.isActive ?? false}
        description={
          pending?.isActive
            ? "They will no longer be able to sign in. Their recorded activity, deliverables, reports and tracker history are preserved in full and stay visible in historical reports, marked Former."
            : "They will be able to sign in again and will reappear in current operational lists. Their historical records are unchanged."
        }
      />

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

/* ── Create ─────────────────────────────────────────────────────────────── */

function CreateStaffDialog({
  open,
  universities,
  onClose,
  onCreated,
}: {
  open: boolean;
  universities: University[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    role: "INSTRUCTOR",
    name: "",
    email: "",
    employeeCode: "",
    universityId: "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const universityId = form.universityId || universities[0]?.id || "";

  async function submit() {
    setFormError(null);
    if (!form.name.trim() || !form.email.trim()) {
      setFormError("Name and email are required.");
      return;
    }
    if (form.password.length < 12) {
      setFormError("The initial password must be at least 12 characters.");
      return;
    }
    if (!universityId) {
      setFormError("Select a university.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        email: form.email.trim(),
        name: form.name.trim(),
        password: form.password,
        ...(form.employeeCode.trim() ? { employeeCode: form.employeeCode.trim() } : {}),
      };
      // Two existing provisioning endpoints, reused as-is rather than a third.
      if (form.role === "MANAGER") {
        await apiSend(
          `/api/universities/${universityId}/managers`,
          "POST",
          payload,
          "Could not create this manager.",
        );
      } else {
        await apiSend(
          "/api/instructors",
          "POST",
          { ...payload, universityId },
          "Could not create this instructor.",
        );
      }
      toast("success", `${form.name.trim()} was created. Share the password out of band.`);
      // Cleared immediately: the plaintext lives in this component's state for
      // exactly as long as the request takes, and is never rendered back.
      setForm({ role: "INSTRUCTOR", name: "", email: "", employeeCode: "", universityId: "", password: "" });
      onCreated();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not create this employee.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add an employee"
      description="Creates the account immediately. There is no invitation email in this system, so the initial password must be shared out of band."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create employee"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Role" required>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="INSTRUCTOR">Instructor</option>
              <option value="MANAGER">Manager</option>
            </Select>
          </Field>
          <Field label="University" required>
            <Select
              value={universityId}
              onChange={(e) => setForm({ ...form, universityId: e.target.value })}
            >
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Full name" required>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Employee ID" hint="Optional.">
            <input
              value={form.employeeCode}
              onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Initial password" hint="At least 12 characters." required>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>
        {formError ? (
          <p className="text-sm text-danger-text" role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
