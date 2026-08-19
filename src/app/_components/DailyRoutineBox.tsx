"use client";

/**
 * Where the day gets written: one box, on the page.
 *
 * ── Not a drawer ──────────────────────────────────────────────────────────
 * This used to open in a panel over the page. Writing up your day is the one
 * thing an instructor comes here to do, and putting it behind a button made
 * the most important surface the one you had to go and find — and once it was
 * open it covered the sheet you might have wanted to look at while writing.
 *
 * ── Add once, then edit ───────────────────────────────────────────────────
 * Empty, it is the box, ready to type in. Once something has been written it
 * shows what was written, with Edit — because after the first submission the
 * question stops being "what did you do?" and becomes "is that right?".
 *
 * ── It shows their words, not the reading of them ─────────────────────────
 * The sentences appear here exactly as typed. What the reader made of them is
 * the sheet below, which is a different claim and deserves a different place:
 * this box is the record of what the instructor said happened.
 */

import { Alert, Button, Card, CardBody } from "@/app/_components/ui";
import { formatDuration } from "@/app/_components/workload";
import { inputClass } from "@/app/_components/ui";

export function DailyRoutineBox({
  /** The day this box writes. Only today can be written. */
  dateLabel,
  editing,
  routine,
  written,
  hours,
  activities,
  added,
  busy,
  canWrite,
  onRoutine,
  onEdit,
  onCancel,
  onSubmit,
}: {
  dateLabel: string;
  editing: boolean;
  /** Plain text, one activity per line — the instructor's own bullets. */
  routine: string;
  /** Everything already submitted for the day, in the order it was written. */
  written: string[];
  /** The day's figures, which used to sit in a card of their own below. */
  hours: number;
  activities: number;
  added: boolean;
  busy: boolean;
  canWrite: boolean;
  onRoutine: (next: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const hasWritten = written.length > 0;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-content">Your day, in your own words</h2>
            <p className="mt-0.5 text-sm text-muted">{dateLabel}</p>
          </div>

          {/* ── The day's figures, here rather than in a card of their own ──
           * They were in a second card immediately below this one, saying the
           * same date again and repeating the Add button. Two cards about the
           * same day is one of them being in the wrong place — and these
           * numbers are the answer to "did what I wrote come out right?",
           * which is a question you ask while looking at what you wrote. */}
          <div className="flex flex-wrap items-center gap-3">
            {added ? (
              <>
                <span>
                  <span className="tabular block text-lg font-semibold text-content">
                    {formatDuration(hours)}
                  </span>
                  <span className="block text-xs uppercase tracking-wide text-muted">
                    Total duration
                  </span>
                </span>
                <span>
                  <span className="tabular block text-lg font-semibold text-content">
                    {activities}
                  </span>
                  <span className="block text-xs uppercase tracking-wide text-muted">
                    {activities === 1 ? "Activity" : "Activities"}
                  </span>
                </span>
              </>
            ) : null}

            {!editing && canWrite ? (
            <Button size="sm" variant={hasWritten ? "secondary" : "primary"} onClick={onEdit}>
              {/* Add exists once. After that the honest verb is Edit — there is
                  already something here, and "Add" would suggest starting over. */}
              {hasWritten ? "Edit" : "Add today’s workload"}
            </Button>
            ) : null}
          </div>
        </div>

        {editing ? (
          <>
            {/* ── One box, not a row of inputs ──────────────────────────
             * Writing up a day is writing. The numbered inputs that used to be
             * here supplied their own bullets and warned under every line that
             * was not finished yet, which meant the box argued with the person
             * while they were still typing in it. This just takes the text.
             *
             * Whether a line has a time frame is decided by the reader, not by
             * a regex here — and when it cannot find one, the reason arrives in
             * the notifications with the line quoted back. */}
            <textarea
              value={routine}
              onChange={(e) => onRoutine(e.target.value)}
              disabled={busy}
              rows={8}
              spellCheck
              aria-label="Your day, one activity per line"
              placeholder={
                "took DSA lecture on binary trees 10:00 AM to 11:30 AM\n" +
                "checked 25 quiz papers 1pm to 1:45pm\n" +
                "met 3 students about their projects 2 to 3"
              }
              className={`${inputClass} min-h-[11rem] w-full resize-y leading-relaxed transition-colors hover:border-line-strong`}
            />
            <p className="text-xs text-muted">
              One activity per line. Say when each one started and ended — the rest is worked out
              for you.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy} onClick={onSubmit}>
                {busy ? "Submitting…" : "Submit"}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </>
        ) : hasWritten ? (
          <ol className="space-y-2">
            {/* Each line is hoverable too, so it is obvious the box is a live
                record of what was written and not a static paragraph. */}
            {written.map((line, i) => (
              <li
                key={i}
                className="flex gap-3 rounded-control px-2 py-1 text-sm transition-colors hover:bg-hovered"
              >
                <span className="tabular w-5 shrink-0 text-right text-subtle">{i + 1}.</span>
                <span className="min-w-0 text-content">{line}</span>
              </li>
            ))}
          </ol>
        ) : canWrite ? (
          <p className="text-sm text-muted">
            Write your day one activity per line, in your own words — say when each one started and
            ended and the rest is worked out for you.
          </p>
        ) : (
          <Alert tone="info" title="Only today can be written here">
            You are looking at another day. Move to today to add or edit your worklog — anything
            earlier is your manager&apos;s to record.
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}
