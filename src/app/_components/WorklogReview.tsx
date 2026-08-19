"use client";

/**
 * "Here is what you wrote, and here is what we made of it."
 *
 * ── Informational, not accusatory ─────────────────────────────────────────
 * The parse is right most of the time, so this reads as a receipt rather than a
 * problem to be triaged: the sentence, then the category and deliverable it was
 * read as, in ordinary type. No warning colours on a correct row, no badge
 * demanding attention. The only thing marked is a bullet that produced NO
 * activity — because that one genuinely needs the instructor.
 *
 * ── Correcting does not mean rewriting ────────────────────────────────────
 * An instructor fixing a misread category changes the structured fields, not
 * their own sentence. Their words stay exactly as typed — they are the record
 * of what happened, and the parse is an interpretation of them. Making somebody
 * rewrite their note to fix a dropdown would be backwards.
 *
 * ── Correcting IS reviewing ───────────────────────────────────────────────
 * Saving a correction is what the three-hour deadline asks about. There is no
 * separate "mark as reviewed" button, because a button that only records an
 * opinion is a button people press without looking.
 */

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Select,
  inputClass,
} from "@/app/_components/ui";
import { categoryColor } from "@/app/_components/charts";
import { formatClock, formatDuration, minutesInZone } from "@/app/_components/workload";

export type ParsedEntry = {
  id: string;
  rawText: string | null;
  startTime: string;
  endTime: string;
  quantity: number;
  remarks: string | null;
  activityType: { code: string; label: string };
  deliverableType: { code: string; label: string; isCountable: boolean } | null;
};

/**
 * How long a submission has been waiting, ticking while it still is.
 *
 * Returns 0 when nothing is pending, so the caller has no clock running and no
 * timer to clean up in the ordinary case.
 */
function useElapsedSince(iso: string | null): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!iso) return;
    const since = new Date(iso).getTime();
    const tick = () => setElapsed(Date.now() - since);
    // The first reading is scheduled rather than taken here: a submission that
    // is ALREADY old on first paint has to be recognised without the clock
    // being read during the render that paints it.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [iso]);

  return elapsed;
}

/** Past any parse the provider has taken, including its retries. */
const STALLED_AFTER_MS = 4 * 60_000;

/** A bullet that produced no row, and why. */
export type Rejection = { index: number; rawText: string; reason: string };

export type Submission = {
  id: string;
  status: "PENDING" | "PARSED" | "FAILED";
  parseError: string | null;
  rejections: Rejection[] | null;
  rawBullets: string[];
  submittedAt: string;
  parsedAt: string | null;
  reviewedAt: string | null;
  escalatedAt: string | null;
  needsReview: boolean;
  approval: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  exceptionReason: string | null;
  decisionNote: string | null;
  activities: ParsedEntry[];
};

export type CategoryOption = {
  code: string;
  label: string;
  deliverables: Array<{ code: string; label: string; isCountable: boolean }>;
};

export function WorklogReview({
  submissions,
  categories,
  timeZone,
  busy,
  onCorrect,
  onReparse,
}: {
  submissions: Submission[];
  categories: CategoryOption[];
  timeZone: string;
  busy: boolean;
  onCorrect: (
    entry: ParsedEntry,
    patch: {
      activityTypeCode: string;
      deliverableTypeCode: string | null;
      quantity: number;
      remarks: string;
    },
  ) => Promise<void>;
  onReparse: (submissionId: string) => Promise<void>;
}) {
  /* ── One day, one sheet ──────────────────────────────────────────────────
   * A submission is how the text ARRIVED, not how the day is read. Somebody
   * who writes three lines in the morning and two more after lunch has one
   * day, and showing it as two cards with two totals makes them add their own
   * hours up to answer "what did I do today?" — and puts 2pm above 10am
   * whenever the second card is opened first.
   *
   * So every entry the day produced goes into ONE table ordered by clock time,
   * regardless of which submission wrote it. Correcting a row still reaches
   * back to its own submission, because the row carries its id.
   */
  const entries = submissions
    .flatMap((s) => s.activities)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Status is about the day as a whole now, not about one card each.
  const parsing = submissions.some((s) => s.status === "PENDING");
  const latestSubmittedAt = submissions.reduce<string | null>(
    (latest, s) => (s.status === "PENDING" && (!latest || s.submittedAt > latest) ? s.submittedAt : latest),
    null,
  );
  const waitedMs = useElapsedSince(latestSubmittedAt);

  /* Something to re-read: a parse that failed outright, or one left behind by a
   * restart. What WENT WRONG is not spelled out here — that is in the
   * notifications — but the way to fix it belongs next to the day it affects. */
  const rereadable = submissions.find(
    (s) => s.status === "FAILED" || (s.status === "PENDING" && waitedMs > STALLED_AFTER_MS),
  );

  const reviewed = submissions.some((s) => s.reviewedAt);
  const escalated = submissions.some((s) => s.escalatedAt);

  if (submissions.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nothing submitted for this day"
          description="Write your day in the entry box and submit it — the activities appear here once it has been read."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Your day, as it was recorded"
        description="These are the entries the report will carry. Correct anything the reading got wrong."
        actions={
          <div className="flex items-center gap-2">
            {parsing ? (
              <Badge tone="info">Reading your latest entry…</Badge>
            ) : escalated ? (
              <Badge tone="warning">{reviewed ? "Reviewed after escalation" : "Sent to your manager"}</Badge>
            ) : reviewed ? (
              <Badge tone="success">Reviewed</Badge>
            ) : null}
            {rereadable ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => onReparse(rereadable.id)}
              >
                {busy ? "Trying…" : "Read again"}
              </Button>
            ) : null}
          </div>
        }
      />

      {entries.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">
            {parsing
              ? "Your text is saved. The entries appear here as soon as it has been read — you do not need to wait on this page."
              : "Nothing from today’s submissions was recorded. Check your notifications for what each line needs."}
          </p>
        </CardBody>
      ) : (
        <SheetTable
          entries={entries}
          categories={categories}
          timeZone={timeZone}
          busy={busy}
          onCorrect={onCorrect}
        />
      )}
    </Card>
  );
}

/**
 * The parsed day, in the columns the client's own spreadsheet uses.
 *
 * ── Why this shape and not a prettier one ─────────────────────────────────
 * Broad Category, Deliverable, Deliverable Quantity, Working Hours, Remarks is
 * the sheet this product replaces, and it is the shape the monthly report is
 * already built in. Showing the same five headings here means an instructor
 * checking their day is reading the same row their manager will read at the end
 * of the month — the AI's output is presented in the vocabulary the
 * organisation already argues about, not in a second one invented for a review
 * screen.
 *
 * "Your entry" sits in front of them because the point of this view is the
 * comparison: the sentence on the left, what it became on the right.
 */
function SheetTable({
  entries,
  categories,
  timeZone,
  busy,
  onCorrect,
}: {
  entries: ParsedEntry[];
  categories: CategoryOption[];
  timeZone: string;
  busy: boolean;
  onCorrect: WorklogReviewCorrect;
}) {
  if (entries.length === 0) {
    return (
      <CardBody>
        <p className="text-sm text-muted">Nothing was recorded from this submission.</p>
      </CardBody>
    );
  }

  const totalHours = entries.reduce(
    // Wrapped, so an activity that crosses midnight does not subtract to a
    // negative — the same defect the sheet had.
    (n, e) =>
      n +
      (((minutesInZone(e.endTime, timeZone) - minutesInZone(e.startTime, timeZone) + 24 * 60) %
        (24 * 60)) /
        60),
    0,
  );
  /* Only what was actually counted. Adding the uncountable rows in would make
   * the total disagree with the column it sits under — every dash contributing
   * a silent 1. */
  const totalQuantity = entries.reduce(
    (n, e) => n + (e.deliverableType?.isCountable ? e.quantity : 0),
    0,
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <caption className="sr-only-text">
          What you wrote, and the category, deliverable, quantity and hours it was read as.
        </caption>
        <thead>
          <tr className="border-y border-line bg-sunken">
            {[
              "Your entry",
              "Category",
              "Deliverable",
              "Deliverable Quantity",
              "Working Hours",
              "Remarks",
            ].map((label, i) => (
              <th
                key={label}
                scope="col"
                className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted ${
                  i === 3 || i === 4 ? "text-right" : "text-left"
                }`}
              >
                {label}
              </th>
            ))}
            <th scope="col" className="px-3 py-2.5 text-right">
              <span className="sr-only-text">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <SheetRow
              key={entry.id}
              entry={entry}
              categories={categories}
              timeZone={timeZone}
              busy={busy}
              onCorrect={onCorrect}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-sunken">
            <th scope="row" colSpan={3} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              Total
            </th>
            <td className="tabular px-3 py-2.5 text-right text-sm font-semibold text-content">
              {totalQuantity}
            </td>
            <td className="tabular px-3 py-2.5 text-right text-sm font-semibold text-content">
              {formatDuration(totalHours)}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SheetRow({
  entry,
  categories,
  timeZone,
  busy,
  onCorrect,
}: {
  entry: ParsedEntry;
  categories: CategoryOption[];
  timeZone: string;
  busy: boolean;
  onCorrect: WorklogReviewCorrect;
}) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(entry.activityType.code);
  const [deliverable, setDeliverable] = useState(entry.deliverableType?.code ?? "");
  const [quantity, setQuantity] = useState(entry.quantity);
  const [remarks, setRemarks] = useState(entry.remarks ?? "");

  const start = minutesInZone(entry.startTime, timeZone);
  const end = minutesInZone(entry.endTime, timeZone);
  const options = categories.find((c) => c.code === category)?.deliverables ?? [];

  /* Whether a count means anything for THIS row.
   *
   * Preparation, meetings, reporting and admin have hours but no unit — "1
   * Department Meeting" is a number that looks like information and is not.
   * Read from the option list rather than the saved row, so the moment somebody
   * corrects a lecture into a meeting the column stops offering a quantity.
   */
  const countable = deliverable
    ? (options.find((d) => d.code === deliverable)?.isCountable ?? true)
    : false;

  const save = async () => {
    await onCorrect(entry, {
      activityTypeCode: category,
      deliverableTypeCode: deliverable || null,
      quantity,
      // Trimmed to nothing means "there is no detail here", which is a real
      // answer — an empty cell is honest where a vague one is not.
      remarks: remarks.trim(),
    });
    setEditing(false);
  };

  const cell = "border-b border-line-subtle px-3 py-3 align-top";

  return (
    <tr>
      {/* The instructor's own words. Never editable from here — the sentence is
          the record; the parse is an interpretation of it. */}
      <td className={`${cell} max-w-[18rem]`}>
        <span className="text-content">{entry.rawText ?? <span className="text-subtle">—</span>}</span>
        <span className="tabular mt-0.5 block text-xs text-muted">
          {formatClock(start)} – {formatClock(end)}
        </span>
      </td>

      <td className={cell}>
        {editing ? (
          <Select
            aria-label="Broad category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              // The old deliverable belongs to the old category; keeping it
              // would submit a pairing the server refuses.
              setDeliverable("");
            }}
          >
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
        ) : (
          <span className="flex items-center gap-2 text-content">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColor(entry.activityType.code) }}
            />
            {entry.activityType.label}
          </span>
        )}
      </td>

      <td className={cell}>
        {editing ? (
          <Select
            aria-label="Deliverable"
            value={deliverable}
            onChange={(e) => setDeliverable(e.target.value)}
          >
            <option value="">Not specified</option>
            {options.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-content">
            {entry.deliverableType?.label ?? <span className="text-subtle">—</span>}
          </span>
        )}
      </td>

      <td className={`${cell} text-right`}>
        {editing ? (
          <input
            type="number"
            min={1}
            max={100}
            aria-label="Deliverable quantity"
            className={`${inputClass} text-right`}
            value={quantity}
            disabled={!countable}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          />
        ) : countable ? (
          <span className="tabular text-content">{entry.quantity}</span>
        ) : (
          // Not "0" — a dash says there is nothing to count here, where a zero
          // would claim they did none of something.
          <span className="text-subtle" title="This kind of work has no unit to count">
            —
          </span>
        )}
      </td>

      {/* Hours come from the clock range and are not edited here — changing when
          something happened is a different action, on the timeline. */}
      <td className={`${cell} tabular text-right text-content`}>
        {formatDuration((((end - start + 24 * 60) % (24 * 60)) / 60))}
      </td>

      <td className={cell}>
        {/* The one free-text column, and the one the reader can get wrong in a
            way no closed list catches — so it is editable in place, like the
            category and the quantity beside it. */}
        {editing ? (
          <input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            disabled={busy}
            maxLength={200}
            placeholder="topic, batch, group…"
            aria-label="Remarks"
            className={`${inputClass} w-44`}
          />
        ) : (
          <span className="text-muted">{entry.remarks ?? <span className="text-subtle">—</span>}</span>
        )}
      </td>

      <td className={`${cell} text-right`}>
        {editing ? (
          <span className="flex justify-end gap-1.5">
            <Button size="sm" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="whitespace-nowrap text-xs text-primary underline-offset-2 hover:underline"
          >
            Correct
          </button>
        )}
      </td>
    </tr>
  );
}

type WorklogReviewCorrect = (
  entry: ParsedEntry,
  patch: {
    activityTypeCode: string;
    deliverableTypeCode: string | null;
    quantity: number;
    remarks: string;
  },
) => Promise<void>;


