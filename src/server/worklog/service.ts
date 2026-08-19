/**
 * A day's worklog, from typed bullets to recorded work.
 *
 *     submit()  ─ saves the text ─────────────────────────────┐  returns at once
 *                                                             │
 *               ┌── background ──────────────────────────────┘
 *               │
 *               ├─ parse the batch (one provider call)
 *               ├─ write one ActivityLog per usable bullet
 *               └─ tell the instructor it is ready to review
 *
 * ── The text is saved BEFORE anything is parsed ───────────────────────────
 * That ordering is the whole guarantee. A provider outage, a malformed reply, a
 * process restart — none of them can cost an instructor the sentences they just
 * typed, because the row exists before the model is ever called. A failed parse
 * leaves a submission that can be parsed again; it never leaves a blank day.
 *
 * ── Parsing does not get its own rules ────────────────────────────────────
 * Every parsed bullet is written through `logActivity`, the same function a
 * hand-typed entry goes through: the same interval limits, the same
 * once-per-day rule, the same overlap check under the same advisory lock. An
 * activity the manual path would have refused is refused here too. Where the AI
 * came from makes no difference to whether the claim is allowed.
 *
 * ── One bullet, one row ───────────────────────────────────────────────────
 * A row keeps its own raw text and its own clock range. Quantities for the same
 * deliverable add up across the day when they are READ — which is what the
 * client's sheet shows — rather than by collapsing two bullets into one row and
 * losing a time range and a sentence in the process.
 */

import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/errors";
import { logActivity } from "@/server/activities/logger";
import { createNotification } from "@/server/notifications/service";
import { loadTaxonomy } from "@/server/worklog/taxonomy";
import { parseBullets, type ParsedBullet } from "@/server/worklog/parse";
import { loadUniversityConfig } from "@/server/universities/config";
import { verifyEntry } from "@/server/worklog/window";

/** Enough for a long day; beyond this something is being pasted, not written. */
export const MAX_BULLETS = 40;
export const MAX_BULLET_CHARS = 500;

/**
 * The provider returns 503 under load often enough that a couple of quick
 * attempts is not a fair test of it — a measured run needed five tries over
 * seventy seconds. Parsing is already off the request path, so waiting costs
 * the instructor nothing, and giving up early costs them a parse they would
 * have got by waiting.
 *
 * Backoff grows rather than repeating a fixed gap: a provider under load is
 * made worse, not better, by being retried at the same rate.
 */
const PARSE_ATTEMPTS = 6;
const RETRY_BASE_MS = 5_000;

export type SubmissionRow = {
  id: string;
  status: string;
  workDate: string;
  bulletCount: number;
};

/* ── Step 1: save the text ────────────────────────────────────────────────── */

export async function submitWorklog(input: {
  instructorId: string;
  universityId: string;
  /** YYYY-MM-DD in the university's zone. */
  workDate: string;
  bullets: string[];
  /** Injectable so a test can control the clock the rules are checked against. */
  now?: Date;
}): Promise<SubmissionRow> {
  // Blank lines are what pressing Enter leaves behind. They are not activities
  // and were never meant to be submitted as empty ones.
  const bullets = input.bullets.map((b) => b.trim()).filter((b) => b !== "");

  if (bullets.length === 0) {
    throw new ApiError(400, "EMPTY_WORKLOG", "Write at least one activity before submitting.");
  }
  if (bullets.length > MAX_BULLETS) {
    throw new ApiError(400, "TOO_MANY_BULLETS", `A day may have at most ${MAX_BULLETS} activities.`);
  }
  if (bullets.some((b) => b.length > MAX_BULLET_CHARS)) {
    throw new ApiError(
      400,
      "BULLET_TOO_LONG",
      `Each activity must be under ${MAX_BULLET_CHARS} characters.`,
    );
  }

  // The day is checked BEFORE the row is written: a submission for the wrong
  // date is refused outright, so there is nothing to save and nothing for a
  // manager to be asked about.
  const config = await loadUniversityConfig(input.universityId);
  const day = verifyEntry({
    config,
    workDate: input.workDate,
    now: input.now ?? new Date(),
    // No activities yet — the window check runs after parsing, when the times
    // are actually known. This pass is only about the date.
    activityWindows: [],
  });
  if (day.kind === "blocked") {
    // The instructor's page does not carry this; the bell does. A refusal an
    // instructor can scroll past is a day that quietly never got recorded, and
    // "did my worklog go in?" has to be answerable hours later from the
    // notification list rather than from whatever the screen said at the time.
    await notifyProblem(input.instructorId, input.universityId, {
      type: "WORKLOG_REJECTED",
      title: "Your worklog was not submitted.",
      message: `${day.message} Nothing was saved for ${input.workDate}.`,
      dedupeKey: `worklog-blocked:${input.instructorId}:${input.workDate}`,
    });
    throw new ApiError(400, "WORKLOG_DATE_NOT_ALLOWED", day.message);
  }

  /* ── Submitting again REPLACES the day ────────────────────────────────
   * The box offers "Edit" once something is written, and an edit that appended
   * a second worklog underneath the first was not an edit at all: the day ended
   * up with both texts, and the new activities either duplicated the old ones or
   * were refused for overlapping them.
   *
   * So a fresh submission supersedes the day's live ones and removes THEIR
   * activities — those rows were read from sentences that no longer stand. The
   * submissions themselves are kept and marked, because they are the record of
   * what the instructor actually wrote, and one is not free to delete that to
   * tidy a screen.
   *
   * Held submissions are superseded too: nothing of theirs was ever written, so
   * there is nothing to remove, and leaving one open would ask a manager to
   * approve a day the instructor has since rewritten.
   */
  const previous = await prisma.worklogSubmission.findMany({
    where: {
      instructorId: input.instructorId,
      workDate: new Date(`${input.workDate}T00:00:00.000Z`),
      supersededAt: null,
    },
    select: { id: true },
  });

  if (previous.length > 0) {
    const ids = previous.map((p) => p.id);
    await prisma.$transaction([
      prisma.activityLog.deleteMany({ where: { submissionId: { in: ids } } }),
      prisma.worklogSubmission.updateMany({
        where: { id: { in: ids } },
        data: { supersededAt: new Date() },
      }),
    ]);
  }

  const submission = await prisma.worklogSubmission.create({
    data: {
      instructorId: input.instructorId,
      universityId: input.universityId,
      workDate: new Date(`${input.workDate}T00:00:00.000Z`),
      rawBullets: bullets,
      status: "PENDING",
    },
    select: { id: true, status: true, workDate: true },
  });

  // Deliberately not awaited: the instructor is told their work is saved as
  // soon as it IS saved, which is now. See the module note.
  void runParse(submission.id);

  return {
    id: submission.id,
    status: submission.status,
    workDate: submission.workDate.toISOString().slice(0, 10),
    bulletCount: bullets.length,
  };
}

/* ── Step 2: parse, in the background ─────────────────────────────────────── */

export type ParseOutcome = {
  written: number;
  /** Bullets that produced no activity, with the reason, in bullet order. */
  rejected: Array<{ index: number; rawText: string; reason: string }>;
};

export async function runParse(submissionId: string): Promise<ParseOutcome | null> {
  const submission = await prisma.worklogSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      instructorId: true,
      universityId: true,
      workDate: true,
      rawBullets: true,
      submittedAt: true,
      instructor: { select: { userId: true } },
    },
  });
  if (!submission) return null;

  const bullets = Array.isArray(submission.rawBullets)
    ? (submission.rawBullets as string[])
    : [];
  const workDate = submission.workDate.toISOString().slice(0, 10);

  try {
    const taxonomy = await loadTaxonomy();

    let parsed = await parseBullets(bullets, taxonomy);
    for (let attempt = 1; !parsed.ok && attempt < PARSE_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * attempt));
      parsed = await parseBullets(bullets, taxonomy);
    }

    if (!parsed.ok) {
      await prisma.worklogSubmission.update({
        where: { id: submissionId },
        data: {
          status: "FAILED",
          // Words an instructor can act on. The provider's own text can carry a
          // URL or a key fragment and never reaches them.
          parseError:
            "Your worklog was saved, but it could not be read automatically just yet. " +
            "Your text is safe — try parsing it again in a few minutes.",
          rejections: [],
        },
      });
      await notifyInstructor(submission.instructor.userId, submission.universityId, workDate, false);
      return { written: 0, rejected: [] };
    }

    // Now that the times are known, the window rules can be applied. A
    // submission that needs asking about is PARSED — so the manager can read
    // what it says — but its activities are NOT written until they agree.
    const config = await loadUniversityConfig(submission.universityId);
    const verdict = verifyEntry({
      config,
      workDate,
      now: submission.submittedAt,
      activityWindows: parsed.bullets
        .filter((b) => b.startLocal && b.endLocal)
        .map((b) => ({
          startMinute: toMinutes(b.startLocal!),
          endMinute: toMinutes(b.endLocal!),
        })),
    });

    if (verdict.kind === "needs_approval") {
      await prisma.worklogSubmission.update({
        where: { id: submissionId },
        data: {
          status: "PARSED",
          parsedAt: new Date(),
          parseError: null,
          approval: "PENDING",
          exceptionReason: verdict.reason,
          // Nothing was attempted, so nothing was refused. A stale list from an
          // earlier attempt would read as "these lines failed" when they have
          // not yet been tried.
          rejections: [],
        },
      });
      await notifyManager(submission.universityId, submission.instructorId, workDate);
      await notifyInstructorHeld(
        submission.instructor.userId,
        submission.universityId,
        workDate,
        verdict.message,
      );
      return { written: 0, rejected: [] };
    }

    const outcome = await writeActivities(
      parsed.bullets,
      { ...submission, workDate },
      taxonomy,
    );

    await prisma.worklogSubmission.update({
      where: { id: submissionId },
      data: {
        status: "PARSED",
        parsedAt: new Date(),
        parseError: null,
        // Written in full, including the empty case: a re-parse that succeeds
        // has to clear what the previous attempt refused.
        rejections: outcome.rejected,
      },
    });
    await notifyInstructor(submission.instructor.userId, submission.universityId, workDate, true);

    // Every line that produced nothing, with its own reason, in one message.
    // This is the only place these reasons are delivered: the review view shows
    // the day as it was recorded, and what did NOT get recorded is exactly the
    // thing a person needs to be told rather than left to notice.
    if (outcome.rejected.length > 0) {
      await createNotification({
        userId: submission.instructor.userId,
        universityId: submission.universityId,
        type: "WORKLOG_NOT_RECORDED",
        title:
          outcome.rejected.length === 1
            ? "One line of your worklog was not recorded."
            : `${outcome.rejected.length} lines of your worklog were not recorded.`,
        message:
          `Nothing was invented for them. Your words are kept — write them again for ${workDate} ` +
          `with the correction each one asks for.\n\n` +
          outcome.rejected.map((r) => `“${r.rawText}” — ${r.reason}`).join("\n"),
        // Keyed on the submission, so re-reading the same one replaces its
        // message instead of stacking a second copy beside it.
        dedupeKey: `worklog-unrecorded:${submission.id}`,
      }).catch(() => {});
    }

    return outcome;
  } catch (error) {
    console.error("[worklog] parse failed", submissionId, error);
    await prisma.worklogSubmission
      .update({
        where: { id: submissionId },
        data: {
          status: "FAILED",
          parseError: "Your worklog was saved, but something went wrong while reading it.",
        },
      })
      .catch(() => {});
    return null;
  }
}

/**
 * Writes the usable bullets, one row each.
 *
 * A bullet that fails — no clock range, an overlap with something already
 * recorded, a duration longer than a day — is collected rather than thrown, so
 * one bad line never costs the instructor the other nine. Its raw text is
 * already safe on the submission, and the instructor sees the reason in their
 * review view.
 */
async function writeActivities(
  bullets: ParsedBullet[],
  submission: { id: string; instructorId: string; universityId: string; workDate: string },
  taxonomy: Awaited<ReturnType<typeof loadTaxonomy>>,
): Promise<ParseOutcome> {
  const rejected: ParseOutcome["rejected"] = [];
  let written = 0;

  for (const bullet of bullets) {
    if (bullet.problem || !bullet.startLocal || !bullet.endLocal) {
      rejected.push({
        index: bullet.index,
        rawText: bullet.rawText,
        reason: bullet.problem ?? "No start and end time could be read from this line.",
      });
      continue;
    }

    const deliverable = bullet.deliverableCode
      ? taxonomy.deliverableByCode.get(bullet.deliverableCode)
      : undefined;

    try {
      // The SAME writer a hand-typed entry uses. Overlap, once-per-day and the
      // advisory lock all apply; nothing is relaxed because a model produced it.
      await logActivity({
        instructorId: submission.instructorId,
        universityId: submission.universityId,
        activityTypeCode: bullet.categoryCode,
        local: { date: submission.workDate, start: bullet.startLocal, end: bullet.endLocal },
        rawText: bullet.rawText,
        // The detail the four structured columns cannot hold. Absent stays
        // absent — an empty Remarks cell is honest, a filled-in vague one is not.
        ...(bullet.remark ? { remarks: bullet.remark } : {}),
        submissionId: submission.id,
        deliverableTypeId: deliverable?.id ?? null,
        broadCategoryId: bullet.subjectCode
          ? (taxonomy.subjectByCode.get(bullet.subjectCode)?.id ?? null)
          : null,
        quantity: bullet.quantity,
      });
      written++;
    } catch (e) {
      rejected.push({
        index: bullet.index,
        rawText: bullet.rawText,
        reason:
          e instanceof ApiError
            ? e.message
            : "This line could not be recorded. Check its times and try again.",
      });
    }
  }

  return { written, rejected };
}

/**
 * A problem an instructor has to be told about, addressed by INSTRUCTOR id.
 *
 * `createNotification` addresses a user, and the refusal paths have an
 * instructor in hand and no user yet. Resolving it here keeps that lookup out
 * of every caller, and a failure to notify never turns into a failure to
 * refuse — the refusal is the point.
 */
async function notifyProblem(
  instructorId: string,
  universityId: string,
  message: { type: string; title: string; message: string; dedupeKey: string },
): Promise<void> {
  try {
    const instructor = await prisma.instructor.findUnique({
      where: { id: instructorId },
      select: { userId: true },
    });
    if (!instructor) return;
    await createNotification({ userId: instructor.userId, universityId, ...message });
  } catch {
    // Never let telling somebody fail louder than the thing it is about.
  }
}

/**
 * "Ready to review."
 *
 * Fires when parsing FINISHES, which may be seconds or minutes after
 * submission. It is deliberately unrelated to the review deadline, which runs
 * from the submission itself — how fast the provider answered must not move
 * anybody's clock.
 */
async function notifyInstructor(
  userId: string,
  universityId: string,
  workDate: string,
  ok: boolean,
): Promise<void> {
  await createNotification({
    userId,
    universityId,
    type: "WORKLOG_PARSED",
    title: ok ? "Your AI-parsed worklog is ready to review." : "Your worklog needs another look.",
    message: ok
      ? `The activities for ${workDate} have been read from what you wrote. Check them and correct anything that is not right.`
      : `Your text for ${workDate} is saved, but could not be read automatically. Nothing is lost — try again shortly.`,
    dedupeKey: `worklog:${workDate}:${userId}:${ok ? "parsed" : "failed"}`,
  }).catch(() => {
    // A notification failing must not undo a successful parse.
  });
}

/* ── Step 3: the instructor corrects something ────────────────────────────── */

/**
 * Records that the instructor has reviewed this submission.
 *
 * Called whenever they change a parsed entry. `reviewedAt` is set ONCE — the
 * first correction is what the deadline asks about — and never cleared, so a
 * submission cannot be un-reviewed by editing it a second time.
 */
export async function markReviewed(submissionId: string): Promise<void> {
  await prisma.worklogSubmission.updateMany({
    where: { id: submissionId, reviewedAt: null },
    data: { reviewedAt: new Date() },
  });
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Approving or refusing a held submission.
 *
 * Approval is what finally WRITES the activities — they were never recorded
 * while the request was open, so nothing has to be undone if it is refused.
 * That ordering is why a rejected worklog leaves no trace in anybody's hours.
 */
export async function decideSubmission(input: {
  submissionId: string;
  approve: boolean;
  decidedById: string;
  note?: string;
}): Promise<{ approved: boolean; written: number }> {
  const submission = await prisma.worklogSubmission.findUnique({
    where: { id: input.submissionId },
    select: {
      id: true,
      instructorId: true,
      universityId: true,
      workDate: true,
      rawBullets: true,
      approval: true,
      instructor: { select: { userId: true } },
    },
  });
  if (!submission) throw new ApiError(404, "NOT_FOUND", "Submission not found");
  if (submission.approval !== "PENDING") {
    throw new ApiError(409, "ALREADY_DECIDED", "This worklog has already been decided.");
  }

  const workDate = submission.workDate.toISOString().slice(0, 10);

  if (!input.approve) {
    await prisma.worklogSubmission.update({
      where: { id: submission.id },
      data: {
        approval: "REJECTED",
        decidedById: input.decidedById,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      },
    });
    await createNotification({
      userId: submission.instructor.userId,
      universityId: submission.universityId,
      type: "WORKLOG_REJECTED",
      title: "Your worklog was not approved.",
      message:
        `Your manager did not approve the worklog for ${workDate}.` +
        (input.note ? ` They said: ${input.note}` : ""),
      dedupeKey: `worklog-decision:${submission.id}`,
    }).catch(() => {});
    return { approved: false, written: 0 };
  }

  // Re-parsed rather than replayed from a stored plan: minutes or hours have
  // passed, and the taxonomy is the authority at the moment of writing.
  const taxonomy = await loadTaxonomy();
  const bullets = Array.isArray(submission.rawBullets) ? (submission.rawBullets as string[]) : [];
  const parsed = await parseBullets(bullets, taxonomy);
  if (!parsed.ok) {
    throw new ApiError(
      503,
      "PARSE_UNAVAILABLE",
      "The worklog could not be read just now. Nothing was changed — try approving again shortly.",
    );
  }

  const outcome = await writeActivities(parsed.bullets, { ...submission, workDate }, taxonomy);

  await prisma.worklogSubmission.update({
    where: { id: submission.id },
    data: {
      approval: "APPROVED",
      decidedById: input.decidedById,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
      // Approval is where these rows are first written, so this is where the
      // refusals first exist.
      rejections: outcome.rejected,
    },
  });
  await createNotification({
    userId: submission.instructor.userId,
    universityId: submission.universityId,
    type: "WORKLOG_APPROVED",
    title: "Your worklog was approved.",
    message: `The activities for ${workDate} have been recorded.`,
    dedupeKey: `worklog-decision:${submission.id}`,
  }).catch(() => {});

  return { approved: true, written: outcome.written };
}

/** Tells the instructor their worklog is waiting on somebody, and why. */
async function notifyInstructorHeld(
  userId: string,
  universityId: string,
  workDate: string,
  reason: string,
): Promise<void> {
  await createNotification({
    userId,
    universityId,
    type: "WORKLOG_HELD",
    title: "Your worklog needs your manager's approval.",
    message: reason,
    dedupeKey: `worklog-held:${workDate}:${userId}`,
  }).catch(() => {});
}

/**
 * Tells whoever leads this instructor that something is waiting.
 *
 * Sent to the instructor's own manager, and to the university's primary manager
 * when they have none — an unassigned instructor's request must not sit in a
 * queue nobody owns.
 */
async function notifyManager(
  universityId: string,
  instructorId: string,
  workDate: string,
): Promise<void> {
  const instructor = await prisma.instructor.findUnique({
    where: { id: instructorId },
    select: {
      user: { select: { name: true } },
      manager: { select: { userId: true } },
      university: { select: { primaryManager: { select: { userId: true } } } },
    },
  });
  const recipient =
    instructor?.manager?.userId ?? instructor?.university.primaryManager?.userId ?? null;
  if (!recipient) return;

  await createNotification({
    userId: recipient,
    universityId,
    type: "WORKLOG_APPROVAL_REQUESTED",
    title: "A worklog needs your approval.",
    message: `${instructor?.user.name ?? "An instructor"} submitted a worklog for ${workDate} that falls outside your university's hours.`,
    dedupeKey: `worklog-approval:${instructorId}:${workDate}`,
  }).catch(() => {});
}
