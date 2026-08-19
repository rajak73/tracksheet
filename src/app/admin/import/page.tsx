"use client";

/**
 * Bulk data import: upload, map, validate, import.
 *
 * ── The screen's one job is to make the impact visible ─────────────────────
 * A bulk import is the most consequential button in an admin console: it can
 * create hundreds of accounts across tenants in one click. So nothing here is
 * hidden behind a spinner. Before the final confirmation the admin can see the
 * file, what was detected, exactly how many records will be CREATED versus
 * UPDATED at each level, every error with its row number, and every warning. The
 * confirm button states the number it is about to write.
 *
 * ── Four steps, because each one is a decision ─────────────────────────────
 *     1 Upload     what file, and what did the server make of it
 *     2 Map        which column means what (skipped for a PDF — no columns)
 *     3 Validate   what will happen, and what is wrong
 *     4 Import     confirm, then watch it run
 *
 * Steps are navigable backwards: a mapping mistake found at step 3 is fixed at
 * step 2 without re-uploading a 10,000-row file, because the parsed dataset
 * lives on the server between steps.
 *
 * ── Nothing here decides anything ──────────────────────────────────────────
 * Every rule — identity, tenancy, what counts as an error — is enforced by the
 * server. This page cannot import a row the API would reject, and it deliberately
 * does not pre-filter or "fix" anything: what it shows is the server's own
 * verdict, so the preview and the outcome cannot disagree.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  PageHeader,
  Section,
  Select,
  StatTile,
  Table,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  inputClass,
} from "@/app/_components/ui";
import { useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, apiUpload } from "@/app/_lib/api";
import { formatDate } from "@/app/_lib/format";

/* ── Shapes the API returns ────────────────────────────────────────────────── */

type Issue = { rowNumber: number; code: string; message: string; field?: string };

type EntityPlan = { create: number; update: number; unchanged: number };

type Preview = {
  rowCount: number;
  validRows: number;
  universities: EntityPlan;
  managers: EntityPlan;
  instructors: EntityPlan;
  unassignedInstructors: number;
  errorCount: number;
  warningCount: number;
};

type Job = {
  id: string;
  sourceType: "CSV" | "PDF";
  status:
    | "UPLOADED"
    | "MAPPED"
    | "VALIDATED"
    | "PROCESSING"
    | "COMPLETED"
    | "COMPLETED_WITH_WARNINGS"
    | "FAILED";
  fileName: string;
  fileSize: number;
  rowCount: number;
  processedRows: number;
  mapping: Record<string, string>;
  errors: Issue[];
  warnings: Issue[];
  summary: {
    preview?: Preview;
    unmapped?: string[];
    extractionNotes?: string[];
    outcome?: {
      created: { universities: number; managers: number; instructors: number };
      updated: { universities: number; managers: number; instructors: number };
      skipped: number;
      failed: number;
    };
  };
  extractionConfidence: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

type JobView = { job: Job; headers: string[]; sampleRows: string[][]; fields: string[] };

/* ── Presentation helpers ─────────────────────────────────────────────────── */

const STEPS = ["Upload", "Map columns", "Validate", "Import"] as const;

const FIELD_LABELS: Record<string, string> = {
  universityCode: "University code",
  universityName: "University name",
  universityTimezone: "University timezone",
  managerCode: "Manager ID",
  managerName: "Manager name",
  managerEmail: "Manager email",
  instructorCode: "Instructor ID",
  instructorName: "Instructor name",
  instructorEmail: "Instructor email",
  status: "Status",
};

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function stepOf(job: Job | null): number {
  if (!job) return 0;
  if (job.status === "UPLOADED") return job.sourceType === "PDF" ? 2 : 1;
  if (job.status === "MAPPED") return 2;
  if (job.status === "VALIDATED") return 3;
  return 3;
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
              i < current
                ? "bg-success-subtle text-success-text"
                : i === current
                  ? "bg-primary text-white"
                  : "bg-sunken text-muted"
            }`}
          >
            {i + 1}
          </span>
          <span className={i === current ? "text-sm font-medium text-content" : "text-sm text-muted"}>
            {label}
          </span>
          {i < STEPS.length - 1 ? <span className="mx-1 text-subtle">›</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** Errors and warnings, with the row number that produced each one. */
function IssueTable({ issues, tone }: { issues: Issue[]; tone: "danger" | "warning" }) {
  if (issues.length === 0) return null;
  return (
    <TableWrap>
      <Table caption={tone === "danger" ? "Errors" : "Warnings"}>
        <THead columns={[{ label: "Row" }, { label: "Problem" }, { label: "Detail" }]} />
        <TBody>
          {issues.map((issue, i) => (
            <TR key={`${issue.rowNumber}-${issue.code}-${i}`}>
              <TD>
                <span className="tabular">{issue.rowNumber === 0 ? "—" : issue.rowNumber}</span>
              </TD>
              <TD>
                <Badge tone={tone}>{issue.code.replaceAll("_", " ")}</Badge>
              </TD>
              <TD>{issue.message}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

function PlanRow({ label, plan }: { label: string; plan: EntityPlan }) {
  return (
    <TR>
      <TD strong>{label}</TD>
      <TD align="right">
        <span className="tabular text-success-text">{plan.create}</span>
      </TD>
      <TD align="right">
        <span className="tabular">{plan.update}</span>
      </TD>
      <TD align="right">
        <span className="tabular text-muted">{plan.unchanged}</span>
      </TD>
    </TR>
  );
}

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function ImportPage() {
  const toast = useToast();
  const [view, setView] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);

  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultTimezone, setDefaultTimezone] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const job = view?.job ?? null;
  const step = stepOf(job);
  const preview = job?.summary.preview ?? null;
  const running = job?.status === "PROCESSING";

  const refresh = useCallback(async (id: string) => {
    const next = await apiGet<JobView>(`/api/admin/imports/${id}`, "Could not load this import.");
    setView(next);
    return next;
  }, []);

  // Polling, and only while something is actually running. A finished import
  // stops the timer rather than asking the server forever.
  useEffect(() => {
    if (!job || job.status !== "PROCESSING") return;
    const id = job.id;
    const timer = setInterval(() => {
      void refresh(id).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [job, refresh]);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File) =>
    guard("Upload", async () => {
      const res = await apiUpload<{ job: Job; duplicateOf: string | null }>(
        "/api/admin/imports",
        file,
        "The file could not be read.",
      );
      setDuplicateOf(res.duplicateOf);
      const next = await refresh(res.job.id);
      setMapping((next.job.mapping ?? {}) as Record<string, string>);
    });

  const saveMapping = () =>
    guard("Mapping", async () => {
      await apiSend(`/api/admin/imports/${job!.id}`, "PATCH", { mapping }, "The mapping was rejected.");
      await refresh(job!.id);
      toast("success", "Column mapping saved.");
    });

  const suggest = () =>
    guard("Suggestion", async () => {
      const res = await apiSend<{ suggestions: Record<string, string>; available: boolean; notice?: string }>(
        `/api/admin/imports/${job!.id}/suggest-mapping`,
        "POST",
        {},
        "Could not get a suggestion.",
      );
      if (!res.available) {
        toast("info", res.notice ?? "AI suggestions are unavailable.");
        return;
      }
      const added = Object.keys(res.suggestions).length;
      // Merged UNDER the current mapping: a suggestion never overwrites a column
      // the admin or the deterministic pass already settled.
      setMapping((m) => ({ ...res.suggestions, ...m }));
      toast(
        added > 0 ? "success" : "info",
        added > 0 ? `Suggested ${added} column${added === 1 ? "" : "s"}.` : "No further columns matched.",
      );
    });

  const validate = () =>
    guard("Validation", async () => {
      await apiSend(
        `/api/admin/imports/${job!.id}/validate`,
        "POST",
        defaultTimezone ? { defaultTimezone } : {},
        "Validation failed.",
      );
      await refresh(job!.id);
    });

  const confirm = () =>
    guard("Import", async () => {
      await apiSend(
        `/api/admin/imports/${job!.id}/confirm`,
        "POST",
        { initialPassword },
        "The import was refused.",
      );
      setInitialPassword("");
      await refresh(job!.id);
      toast("success", "Import started.");
    });

  const reset = () => {
    setView(null);
    setMapping({});
    setDuplicateOf(null);
    setError(null);
    setInitialPassword("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const writeTotal = preview
    ? preview.universities.create +
      preview.universities.update +
      preview.managers.create +
      preview.managers.update +
      preview.instructors.create +
      preview.instructors.update
    : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import data"
        description="Onboard an existing organisation from a CSV or PDF: universities, managers and the instructors who report to them."
        actions={job ? <Button variant="secondary" onClick={reset}>Start over</Button> : undefined}
      />

      <Card>
        <CardBody>
          <Stepper current={step} />
        </CardBody>
      </Card>

      {error ? (
        <Alert tone="danger" title="That did not work">
          {error}
        </Alert>
      ) : null}

      {/* ── Step 1 ─────────────────────────────────────────────────────── */}
      {!job ? (
        <Section
          title="Upload a file"
          description="A CSV may combine universities, managers and instructors in one file — repeating a university or manager across rows is expected and will not create duplicates. A PDF is read and turned into the same rows for you to review."
        >
          <Card>
            <CardBody className="space-y-4">
              <Field
                label="CSV or PDF"
                hint="Up to 10 MB. Nothing is written until you confirm at step 4."
                required
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv,.pdf,application/pdf"
                  disabled={busy}
                  className={inputClass}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
              </Field>
              <p className="text-xs text-muted">
                Recognised columns: University code, University name, University timezone, Manager ID,
                Manager name, Manager email, Instructor ID, Instructor name, Instructor email, Status.
                Anything else is ignored, and you can correct the matching at step 2.
              </p>
              {busy ? <p className="text-sm text-muted">Reading the file…</p> : null}
            </CardBody>
          </Card>
        </Section>
      ) : null}

      {/* ── The file, once there is one ─────────────────────────────────── */}
      {job ? (
        <Section title="File">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="File" value={job.fileName} />
            <StatTile label="Size" value={bytes(job.fileSize)} />
            <StatTile label="Records detected" value={job.rowCount} emphasis />
            <StatTile label="Source" value={job.sourceType} />
          </div>

          {duplicateOf ? (
            <Alert tone="info" title="This exact file has been imported before">
              Importing it again is safe — records are matched on their identifiers, so you will see
              updates rather than duplicates.
            </Alert>
          ) : null}

          {job.sourceType === "PDF" ? (
            <Alert
              tone={job.extractionConfidence === "high" ? "info" : "warning"}
              title={`Extraction confidence: ${job.extractionConfidence ?? "unknown"}`}
            >
              {job.extractionConfidence === "high"
                ? "The document read cleanly. Check the preview before importing."
                : "Some of this document was interpreted rather than read directly. Check every row in the preview before importing."}
              {job.summary.extractionNotes?.length ? (
                <ul className="mt-2 list-inside list-disc space-y-1">
                  {job.summary.extractionNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}
        </Section>
      ) : null}

      {/* ── Step 2 ─────────────────────────────────────────────────────── */}
      {job && job.sourceType === "CSV" && view ? (
        <Section
          title="Map columns"
          description="Matched automatically where the heading was recognisable. Correct anything that is wrong — a field can be used only once."
          actions={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={suggest}>
                Suggest with AI
              </Button>
              <Button size="sm" disabled={busy} onClick={saveMapping}>
                Save mapping
              </Button>
            </div>
          }
        >
          <Card>
            <TableWrap>
              <Table caption="Column mapping">
                <THead
                  columns={[
                    { label: "Source column" },
                    { label: "Sample value" },
                    { label: "TrackSheet field" },
                  ]}
                />
                <TBody>
                  {view.headers.map((header, index) => {
                    const sample = view.sampleRows.find((r) => (r[index] ?? "") !== "")?.[index] ?? "—";
                    const chosen = mapping[header] ?? "";
                    const claimedElsewhere = new Set(
                      Object.entries(mapping)
                        .filter(([h]) => h !== header)
                        .map(([, f]) => f),
                    );
                    return (
                      <TR key={`${header}-${index}`}>
                        <TD strong>{header || <span className="text-subtle">(unnamed)</span>}</TD>
                        <TD>
                          <span className="text-muted">{sample}</span>
                        </TD>
                        <TD>
                          <Select
                            value={chosen}
                            aria-label={`Field for ${header}`}
                            onChange={(e) => {
                              const value = e.target.value;
                              setMapping((m) => {
                                const next = { ...m };
                                if (value === "") delete next[header];
                                else next[header] = value;
                                return next;
                              });
                            }}
                          >
                            <option value="">Ignore this column</option>
                            {view.fields.map((f) => (
                              <option key={f} value={f} disabled={claimedElsewhere.has(f)}>
                                {FIELD_LABELS[f] ?? f}
                              </option>
                            ))}
                          </Select>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        </Section>
      ) : null}

      {/* ── Step 3 ─────────────────────────────────────────────────────── */}
      {job && (job.status === "MAPPED" || job.status === "VALIDATED" || job.status === "UPLOADED") ? (
        <Section
          title="Validate"
          description="Checks every row against the database before anything is written. No records are changed by this step."
          actions={
            <Button size="sm" disabled={busy} onClick={validate}>
              {busy ? "Checking…" : preview ? "Re-check" : "Check the data"}
            </Button>
          }
        >
          <Card>
            <CardBody>
              <Field
                label="Default timezone for new universities"
                hint="Required only if the file creates a university and has no timezone column. Every working-day boundary for a tenant is computed in its timezone, so it is asked for rather than guessed. Example: Asia/Kolkata"
              >
                <input
                  className={inputClass}
                  value={defaultTimezone}
                  placeholder="Asia/Kolkata"
                  onChange={(e) => setDefaultTimezone(e.target.value)}
                />
              </Field>
            </CardBody>
          </Card>

          {preview ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Records detected" value={preview.rowCount} />
                <StatTile label="Valid" value={preview.validRows} emphasis />
                <StatTile
                  label="Warnings"
                  value={preview.warningCount}
                  tone={preview.warningCount > 0 ? "warning" : undefined}
                />
                <StatTile
                  label="Errors"
                  value={preview.errorCount}
                  tone={preview.errorCount > 0 ? "danger" : "success"}
                />
              </div>

              <Card>
                <CardHeader
                  title="What this import will do"
                  description="Existing records are matched on their identifiers and updated. Nothing is ever deleted or deactivated because it is missing from the file."
                />
                <TableWrap>
                  <Table caption="Import preview">
                    <THead
                      columns={[
                        { label: "" },
                        { label: "New", align: "right" },
                        { label: "Updated", align: "right" },
                        { label: "Unchanged", align: "right" },
                      ]}
                    />
                    <TBody>
                      <PlanRow label="Universities" plan={preview.universities} />
                      <PlanRow label="Managers" plan={preview.managers} />
                      <PlanRow label="Instructors" plan={preview.instructors} />
                    </TBody>
                  </Table>
                </TableWrap>
                <CardBody>
                  <p className="text-sm text-muted">
                    Relationship created: University → Manager → Instructor.
                    {preview.unassignedInstructors > 0 ? (
                      <>
                        {" "}
                        {preview.unassignedInstructors} instructor
                        {preview.unassignedInstructors === 1 ? "" : "s"} name no manager and will be
                        imported as <Badge tone="neutral">Unassigned</Badge>. You can place them on a
                        roster afterwards.
                      </>
                    ) : null}
                  </p>
                </CardBody>
              </Card>

              {job.errors.length > 0 ? (
                <Card>
                  <CardHeader
                    title={`Errors (${preview.errorCount})`}
                    description="These rows will not be imported, and the import cannot start while any remain. Correct the file and upload it again."
                  />
                  <IssueTable issues={job.errors} tone="danger" />
                </Card>
              ) : null}

              {job.warnings.length > 0 ? (
                <Card>
                  <CardHeader
                    title={`Warnings (${preview.warningCount})`}
                    description="These rows will be imported. Read them so nothing surprises you afterwards."
                  />
                  <IssueTable issues={job.warnings} tone="warning" />
                </Card>
              ) : null}
            </>
          ) : (
            <Card>
              <EmptyState
                title="Not checked yet"
                description="Run the check to see exactly what this file would create and update."
              />
            </Card>
          )}
        </Section>
      ) : null}

      {/* ── Step 4 ─────────────────────────────────────────────────────── */}
      {job && job.status === "VALIDATED" && preview ? (
        <Section title="Import" description="The only step that writes to the database.">
          <Card>
            <CardBody className="space-y-4">
              {preview.errorCount > 0 ? (
                <Alert tone="danger" title="Errors must be fixed first">
                  {preview.errorCount} row{preview.errorCount === 1 ? "" : "s"} cannot be imported.
                  Correct the file and upload it again.
                </Alert>
              ) : (
                <>
                  <Field
                    label="Initial password for new accounts"
                    hint="Every account this import creates receives this password. It is hashed once, never stored in readable form, and never shown again — distribute it to the new staff yourself. It is asked for here rather than read from the file so an uploaded roster never becomes a credential store. At least 12 characters."
                    required
                  >
                    <input
                      type="password"
                      className={inputClass}
                      value={initialPassword}
                      autoComplete="new-password"
                      onChange={(e) => setInitialPassword(e.target.value)}
                    />
                  </Field>

                  <p className="text-sm text-muted">
                    On confirmation this will create {preview.universities.create} universit
                    {preview.universities.create === 1 ? "y" : "ies"}, {preview.managers.create} manager
                    {preview.managers.create === 1 ? "" : "s"} and {preview.instructors.create}{" "}
                    instructor{preview.instructors.create === 1 ? "" : "s"}, and update{" "}
                    {preview.managers.update + preview.instructors.update + preview.universities.update}{" "}
                    existing record
                    {preview.managers.update + preview.instructors.update + preview.universities.update === 1
                      ? ""
                      : "s"}
                    . Large imports continue in the background and you can watch the progress here.
                  </p>

                  <Button
                    disabled={busy || initialPassword.length < 12}
                    onClick={confirm}
                  >
                    {busy ? "Starting…" : `Import ${writeTotal} record${writeTotal === 1 ? "" : "s"}`}
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        </Section>
      ) : null}

      {/* ── Running, and afterwards ─────────────────────────────────────── */}
      {job && ["PROCESSING", "COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED"].includes(job.status) ? (
        <Section title="Result">
          <Card>
            <CardHeader
              title={
                running
                  ? "Importing…"
                  : job.status === "FAILED"
                    ? "The import failed"
                    : job.status === "COMPLETED_WITH_WARNINGS"
                      ? "Imported, with warnings"
                      : "Imported"
              }
              description={
                job.completedAt ? `Finished ${formatDate(job.completedAt)}` : undefined
              }
            />
            <CardBody className="space-y-4">
              {running ? (
                <>
                  <p className="tabular text-sm text-content">
                    {job.processedRows} / {job.rowCount} records
                  </p>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-sunken">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${job.rowCount > 0 ? Math.min(100, (job.processedRows / job.rowCount) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted">
                    This continues on the server. You can leave this page — the result is kept in the
                    import history. If a deployment interrupts it, confirming the same import again
                    finishes the rest without duplicating anything.
                  </p>
                </>
              ) : null}

              {job.errorMessage ? (
                <Alert tone="danger" title="Reason">
                  {job.errorMessage}
                </Alert>
              ) : null}

              {job.summary.outcome ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatTile
                    label="Created"
                    value={
                      job.summary.outcome.created.universities +
                      job.summary.outcome.created.managers +
                      job.summary.outcome.created.instructors
                    }
                    emphasis
                  />
                  <StatTile
                    label="Updated"
                    value={
                      job.summary.outcome.updated.universities +
                      job.summary.outcome.updated.managers +
                      job.summary.outcome.updated.instructors
                    }
                  />
                  <StatTile label="Unchanged" value={job.summary.outcome.skipped} />
                  <StatTile
                    label="Failed"
                    value={job.summary.outcome.failed}
                    tone={job.summary.outcome.failed > 0 ? "danger" : "success"}
                  />
                </div>
              ) : null}

              {!running && job.errors.length > 0 ? <IssueTable issues={job.errors} tone="danger" /> : null}
            </CardBody>
          </Card>
        </Section>
      ) : null}

      <ImportHistory />
    </div>
  );
}

/* ── History ──────────────────────────────────────────────────────────────── */

/**
 * Past imports.
 *
 * Reads the `ImportJob` rows rather than the audit log: the audit trail records
 * that an import happened and who did it, while these rows record what it did.
 * Both exist, and this screen wants the second.
 */
function ImportHistory() {
  const [jobs, setJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    void apiGet<{ jobs: Job[] }>("/api/admin/imports?limit=15", "Could not load import history.")
      .then((r) => setJobs(r.jobs))
      .catch(() => setJobs([]));
  }, []);

  if (!jobs) return null;

  return (
    <Section title="Import history" description="The last 15 imports across the platform.">
      <Card>
        {jobs.length === 0 ? (
          <EmptyState title="No imports yet" />
        ) : (
          <TableWrap>
            <Table caption="Import history">
              <THead
                columns={[
                  { label: "File" },
                  { label: "Source" },
                  { label: "Status" },
                  { label: "Records", align: "right" },
                  { label: "When" },
                ]}
              />
              <TBody>
                {jobs.map((j) => (
                  <TR key={j.id}>
                    <TD strong>{j.fileName}</TD>
                    <TD>{j.sourceType}</TD>
                    <TD>
                      <Badge
                        tone={
                          j.status === "COMPLETED"
                            ? "success"
                            : j.status === "FAILED"
                              ? "danger"
                              : j.status === "COMPLETED_WITH_WARNINGS"
                                ? "warning"
                                : "neutral"
                        }
                      >
                        {j.status.replaceAll("_", " ")}
                      </Badge>
                    </TD>
                    <TD align="right">
                      <span className="tabular">{j.rowCount}</span>
                    </TD>
                    <TD>
                      <span className="text-muted">{formatDate(j.createdAt)}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </Section>
  );
}
