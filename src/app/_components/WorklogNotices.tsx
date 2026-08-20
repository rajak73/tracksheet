"use client";

/**
 * What the sheet cannot say.
 *
 * The sheet below shows what was RECORDED. This strip is about the submission
 * that produced it — a parse still running, one that failed, one waiting on a
 * manager — which is a different kind of fact and belongs above the table
 * rather than inside it, where it would have to pretend to be a row.
 *
 * It says nothing when there is nothing to say. A status bar that is always
 * present is a status bar people stop reading.
 *
 * ── Problems are not here, and that is deliberate ─────────────────────────
 * "Waiting for your manager" and "Not approved" used to sit here as panels.
 * They are already sent as notifications — where they survive the page being
 * left and can be re-read an hour later — and this page reports every other
 * refusal through the bell. Saying it in both places meant the bell was the
 * copy nobody trusted. What is left here is a STATUS ("still reading") and an
 * ACTION ("read again"), neither of which is a message about a problem.
 */

import { useEffect, useState } from "react";
import { Badge, Button } from "@/app/_components/ui";
import { MAX_PARSE_MS } from "@/domain/worklog-parse-timing";

export type NoticeSubmission = {
  id: string;
  status: "PENDING" | "PARSED" | "FAILED";
  parseError: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  escalatedAt: string | null;
  approval: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  decisionNote: string | null;
};

/**
 * Past any parse the provider can legitimately take, including every retry and
 * every backoff — derived, not guessed.
 *
 * This was four minutes flat, with a comment that said exactly what this one
 * says. It was wrong: six attempts at forty-five seconds is four and a half
 * minutes of provider time before the seventy-five seconds of backoff. So a
 * parse that was still working was shown to the instructor as stuck, and the
 * retry we offered them started a second parse of the same submission over the
 * top of the first. The server now refuses that; this stops us asking for it.
 *
 * The margin is a minute on top, so a parse finishing at its true limit is not
 * announced as stalled a second before it lands.
 */
const STALLED_AFTER_MS = MAX_PARSE_MS + 60_000;

export function WorklogNotices({
  submissions,
  busy,
  onReparse,
}: {
  submissions: NoticeSubmission[];
  busy: boolean;
  onReparse: (submissionId: string) => Promise<void>;
}) {
  const parsing = submissions.some((s) => s.status === "PENDING");
  /* Held is a STATUS, not a problem message — the same kind of thing as "still
   * reading". The reason and the detail go to the bell, where they can be
   * re-read; what belongs here is the fact that the day is not recorded yet,
   * because without it the sheet simply looks like it ignored the edit. */
  const held = submissions.some((s) => s.approval === "PENDING");

  const oldestPending = submissions.reduce<string | null>(
    (oldest, s) =>
      s.status === "PENDING" && (!oldest || s.submittedAt < oldest) ? s.submittedAt : oldest,
    null,
  );
  const waited = useElapsedSince(oldestPending);

  /* Something to re-read: a parse that failed outright, or one a restart left
   * behind. What went wrong is in the notifications; the way to fix it belongs
   * next to the day it affects. */
  const rereadable = submissions.find(
    (s) => s.status === "FAILED" || (s.status === "PENDING" && waited > STALLED_AFTER_MS),
  );

  if (!parsing && !held && !rereadable) return null;

  return (
    <div className="space-y-3">
      {held ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="warning">Waiting for your manager</Badge>
          <span className="text-sm text-muted">
            This day falls outside your university&apos;s hours, so it is not recorded until they
            approve it. Your words are saved.
          </span>
        </div>
      ) : null}

      {parsing ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="info">Reading your latest entry…</Badge>
          <span className="text-sm text-muted">
            Your words are saved. The rows appear below as soon as they have been read — you do not
            need to wait on this page.
          </span>
        </div>
      ) : null}


      {rereadable ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">
            {rereadable.parseError ?? "This is taking longer than it should."}
          </span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onReparse(rereadable.id)}>
            {busy ? "Trying…" : "Read again"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * How long the oldest unparsed submission has been waiting.
 *
 * The clock is read in an effect, not during render: a render that returns
 * something different each time it runs is not one React can reason about.
 */
function useElapsedSince(iso: string | null): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!iso) return;
    const since = new Date(iso).getTime();
    const tick = () => setElapsed(Date.now() - since);
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [iso]);

  return elapsed;
}
