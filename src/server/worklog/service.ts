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
import {
  MAX_NARRATIVE_CHARS,
  parseNarrative,
  type NarrativeWarning,
} from "@/server/worklog/narrative";
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
// Shared with the instructor's page, which has to know how long a parse may
// legitimately take before it calls one stuck. See the note in that module.
import { PARSE_ATTEMPTS, RETRY_BASE_MS } from "@/domain/worklog-parse-timing";

/**
 * Submissions with a parse running right now.
 *
 * ── What this stops ───────────────────────────────────────────────────────
 * `POST .../reparse` refused a submission that was already PARSED or
 * superseded, and nothing else — so it would start a SECOND parse of a
 * submission whose first was still in flight. Two `writeActivities` runs over
 * one day duplicate the day's hours.
 *
 * It was not a theoretical race: the instructor's page offered exactly that.
 * Its "this looks stuck" prompt appeared at four minutes while a parse can
 * legitimately run for five and three quarters, so the button was presented to
 * the instructor, by us, in the middle of a working parse.
 *
 * In-process, like the rate limiter, and honest about it for the same reason:
 * this deploys as a single instance. Behind more than one, two processes could
 * still both start a parse — the durable version of this is a row-level claim
 * and it is not worth the migration until the deployment needs it.
 */
const parsesInFlight = new Set<string>();

/** Is a parse of this submission running in this process right now? */
export function isParseInFlight(submissionId: string): boolean {
  return parsesInFlight.has(submissionId);
}

export type SubmissionRow = {
  id: string;
  status: string;
  workDate: string;
  bulletCount: number;
};

/* ── Step 1: save the text ────────────────────────────────────────────────── */

export type SubmitWorklogInput = {
  instructorId: string;
  universityId: string;
  /** YYYY-MM-DD in the university's zone. */
  workDate: string;
  /** Injectable so a test can control the clock the rules are checked against. */
  now?: Date;
} & (
  | { bullets: string[]; narrative?: undefined }
  /**
   * The whole day in one piece, in the instructor's own words. The activities
   * inside it are found when it is read — see `narrative.ts` — rather than by
   * splitting it here on a delimiter, because the comma that separates two
   * activities and the comma inside one of them are the same character.
   */
  | { narrative: string; bullets?: undefined }
);

export async function submitWorklog(input: SubmitWorklogInput): Promise<SubmissionRow> {
  /* Both shapes become a list of raw texts, and the mode records which one it
   * was. Stored rather than inferred: the read happens in the background, long
   * after this request has answered, and a paragraph read as a bullet is one
   * activity where there were five. */
  const narrative = input.narrative?.trim();
  const mode = narrative !== undefined ? "NARRATIVE" : "BULLETS";

  // Blank lines are what pressing Enter leaves behind. They are not activities
  // and were never meant to be submitted as empty ones.
  const bullets =
    narrative !== undefined
      ? narrative === ""
        ? []
        : [narrative]
      : (input.bullets ?? []).map((b) => b.trim()).filter((b) => b !== "");

  if (bullets.length === 0) {
    throw new ApiError(400, "EMPTY_WORKLOG", "Write at least one activity before submitting.");
  }
  if (mode === "NARRATIVE") {
    if (bullets[0]!.length > MAX_NARRATIVE_CHARS) {
      throw new ApiError(
        400,
        "WORKLOG_TOO_LONG",
        `A day's worklog must be under ${MAX_NARRATIVE_CHARS} characters.`,
      );
    }
  } else {
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
  /* ── Superseded here, but NOT emptied here ──────────────────────────────
   *
   * The previous submissions' activities used to be deleted at this point,
   * before the new text had been read by anything. A provider outage then
   * emptied a day that was already correctly recorded — and this module's own
   * header promises the opposite: "A failed parse leaves a submission that can
   * be parsed again; it never leaves a blank day." That held for a FIRST
   * submission and not for a second one.
   *
   * The old rows now stand until the new text parses and there is something to
   * put in their place. `writeActivities` clears them immediately before it
   * writes, so the day is replaced rather than emptied and then refilled.
   *
   * ── One submit at a time, per instructor per day ────────────────────────
   * This was a read, then a transaction, then a create: three statements with
   * nothing spanning them, no lock, and no unique constraint behind "one live
   * submission per instructor per day". Two concurrent submits — a
   * double-clicked Save, two tabs — both read an empty `previous` and both
   * inserted, leaving the day with two live submissions and every reader
   * picking one arbitrarily.
   *
   * `pg_advisory_xact_lock` on (instructor, day) serialises exactly that, the
   * same pattern `logActivity` uses for the same reason. It releases when the
   * transaction ends. */
  const workDate = new Date(`${input.workDate}T00:00:00.000Z`);
  const lockKey = `worklog:${input.instructorId}:${input.workDate}`;

  const submission = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    await tx.worklogSubmission.updateMany({
      where: { instructorId: input.instructorId, workDate, supersededAt: null },
      data: { supersededAt: new Date() },
    });

    return tx.worklogSubmission.create({
      data: {
        instructorId: input.instructorId,
        universityId: input.universityId,
        workDate,
        rawBullets: bullets,
        inputMode: mode,
        status: "PENDING",
      },
      select: { id: true, status: true, workDate: true },
    });
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

/** Has this submission been replaced while we were reading it? */
async function isSuperseded(submissionId: string): Promise<boolean> {
  const row = await prisma.worklogSubmission.findUnique({
    where: { id: submissionId },
    select: { supersededAt: true },
  });
  return row === null || row.supersededAt !== null;
}

export async function runParse(submissionId: string): Promise<ParseOutcome | null> {
  // Claimed for the whole run and released however it ends, so a second caller
  // — a reparse, a retry — can be told one is already going.
  parsesInFlight.add(submissionId);
  try {
    return await runParseInner(submissionId);
  } finally {
    parsesInFlight.delete(submissionId);
  }
}

async function runParseInner(submissionId: string): Promise<ParseOutcome | null> {
  const submission = await prisma.worklogSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      instructorId: true,
      universityId: true,
      workDate: true,
      rawBullets: true,
      inputMode: true,
      submittedAt: true,
      supersededAt: true,
      instructor: { select: { userId: true } },
    },
  });
  if (!submission) return null;

  /* Withdrawn before this got to it.
   *
   * Parsing is fire-and-forget and can take a minute when the provider is
   * retrying, and an instructor who rewrites the day in the meantime
   * supersedes this submission and deletes whatever it had produced. Without
   * this check the late parse still ran `writeActivities`, putting the
   * WITHDRAWN text's hours back on the day — and, because the replacement's
   * entries sit at different times, without an overlap to refuse them. The
   * result was a day holding lines nobody could see the source of.
   *
   * Re-read here rather than trusted from the caller: the supersession happens
   * after this function is already in flight, which is the whole problem. */
  if (submission.supersededAt) return null;

  const bullets = Array.isArray(submission.rawBullets)
    ? (submission.rawBullets as string[])
    : [];
  const workDate = submission.workDate.toISOString().slice(0, 10);

  /* Visibly running, rather than invisibly abandoned.
   *
   * PENDING and PROCESSING answer different questions — "queued" and "being
   * read" — and the screen says different things for each. It also survives a
   * restart, which the in-process in-flight set cannot: a submission left
   * PROCESSING by a killed process is one somebody can see is stuck.
   *
   * Best-effort. Failing to mark a parse as started is not a reason to refuse
   * to start it. */
  await prisma.worklogSubmission
    .update({ where: { id: submissionId }, data: { status: "PROCESSING" } })
    .catch(() => {});

  try {
    const taxonomy = await loadTaxonomy();

    /* A paragraph and a list of lines are read by different modules, and the
     * difference is exactly one rule: whether one piece of text may hold more
     * than one activity. Everything after this point — the window verdict, the
     * writes, the rejections, the notifications — is the same for both, which is
     * the point of returning the same shape. */
    const readDay = async () => {
      if (submission.inputMode !== "NARRATIVE") {
        const result = await parseBullets(bullets, taxonomy);
        return result.ok
          ? { ok: true as const, bullets: result.bullets, warnings: [] as NarrativeWarning[], dropped: [] }
          : result;
      }
      const result = await parseNarrative(bullets.join("\n"), taxonomy);
      return result.ok
        ? {
            ok: true as const,
            bullets: result.bullets,
            warnings: result.warnings,
            dropped: result.dropped ?? [],
          }
        : result;
    };

    let parsed = await readDay();
    for (let attempt = 1; !parsed.ok && attempt < PARSE_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * attempt));
      parsed = await readDay();
    }

    if (!parsed.ok) {
      /* Asked again for the same reason the success path asks: the retries
       * above take over a minute, and an instructor who rewrote the day inside
       * that window has already been shown the replacement. Marking the
       * withdrawn text FAILED would light the day red and tell them to try
       * again — on a submission `POST .../reparse` now refuses as superseded,
       * so there is no "again" to try. */
      if (await isSuperseded(submissionId)) return null;
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
          needsReview: false,
          reviewNotes: [],
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

    /* The window between loading the row and writing against it is the one
     * that matters: `parseBullets` retries a busy provider for over a minute,
     * and the instructor can rewrite the day inside it. So the question is
     * asked again HERE, immediately before anything is written or any manager
     * is asked to look. */
    if (await isSuperseded(submissionId)) return null;

    if (verdict.kind === "needs_approval") {
      await prisma.worklogSubmission.update({
        where: { id: submissionId },
        data: {
          status: "PARSED",
          parsedAt: new Date(),
          parseError: null,
          approval: "PENDING",
          exceptionReason: verdict.reason,
          // Nothing has been recorded yet, so there is nothing to review.
          needsReview: false,
          reviewNotes: [],
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

    /* A span that failed provenance produced no activity, which is exactly what
     * a rejection is — so it travels with the others rather than in a channel of
     * its own. Its index sits past the written ones, since it never had a
     * position among them. */
    const rejected = [
      ...outcome.rejected,
      ...parsed.dropped.map((d, i) => ({
        index: parsed.bullets.length + i,
        rawText: d.rawText,
        reason: d.reason,
      })),
    ];

    await prisma.worklogSubmission.update({
      where: { id: submissionId },
      data: {
        status: "PARSED",
        parsedAt: new Date(),
        parseError: null,
        // Written in full, including the empty case: a re-parse that succeeds
        // has to clear what the previous attempt refused.
        rejections: rejected,
        /* "Organised, but please look at it." Rewritten every time for the same
         * reason: a re-read that comes back clean has to clear the last one's
         * warnings, or the day carries a complaint about a problem it no longer
         * has. */
        needsReview: parsed.warnings.length > 0,
        reviewNotes: parsed.warnings,
      },
    });
    await notifyInstructor(submission.instructor.userId, submission.universityId, workDate, true);

    // Every line that produced nothing, with its own reason, in one message.
    // This is the only place these reasons are delivered: the review view shows
    // the day as it was recorded, and what did NOT get recorded is exactly the
    // thing a person needs to be told rather than left to notice.
    if (rejected.length > 0) {
      await createNotification({
        userId: submission.instructor.userId,
        universityId: submission.universityId,
        type: "WORKLOG_NOT_RECORDED",
        title:
          rejected.length === 1
            ? "One line of your worklog was not recorded."
            : `${rejected.length} lines of your worklog were not recorded.`,
        message:
          `Nothing was invented for them. Your words are kept — write them again for ${workDate} ` +
          `with the correction each one asks for.\n\n` +
          rejected.map((r) => `“${r.rawText}” — ${r.reason}`).join("\n"),
        // Keyed on the submission, so re-reading the same one replaces its
        // message instead of stacking a second copy beside it.
        dedupeKey: `worklog-unrecorded:${submission.id}`,
      }).catch(() => {});
    }

    /* A warning is not a refusal — the day IS recorded — so it gets its own
     * message rather than borrowing the one above, which tells people their work
     * was lost. It still goes to the bell: an instructor who closed the tab
     * before the read finished has no other way to learn the day wants a look. */
    if (parsed.warnings.length > 0) {
      await createNotification({
        userId: submission.instructor.userId,
        universityId: submission.universityId,
        type: "WORKLOG_NEEDS_REVIEW",
        title: "Your worklog was organised, but please check it.",
        message:
          `${workDate} was recorded. Some details need your eye before it is final.\n\n` +
          parsed.warnings.map((w) => w.message).join("\n"),
        dedupeKey: `worklog-review:${submission.id}`,
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

  /* Clear the day's SUPERSEDED rows here, not at submit time.
   *
   * A resubmission marks the previous submissions superseded and leaves their
   * activities standing, so a parse that never succeeds cannot empty a day that
   * was already correctly recorded. The rows go now, immediately before their
   * replacements are written — the day is replaced rather than emptied and then
   * hopefully refilled.
   *
   * Scoped to this instructor and this date, and only to submissions that are
   * no longer live, so nothing belonging to a standing submission is touched. */
  await prisma.activityLog.deleteMany({
    where: {
      instructorId: submission.instructorId,
      workDate: new Date(`${submission.workDate}T00:00:00.000Z`),
      submission: { is: { supersededAt: { not: null } } },
    },
  });

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

  /* Superseded WHILE we were writing?
   *
   * `runParse` asks before it starts, but the write itself is a loop of up to
   * forty separate transactions — a read is not a lock, and a resubmission
   * landing part-way through deletes only the rows written so far. The rest
   * were then written after the delete and could never be swept: a later
   * submission builds its list from submissions that are still live, and this
   * one is not one of them. The leak was permanent, and the hours stayed in
   * every total while being invisible to every screen.
   *
   * So the question is asked once more at the end, and this submission cleans
   * up after itself if the answer changed. */
  if (await isSuperseded(submission.id)) {
    await prisma.activityLog.deleteMany({ where: { submissionId: submission.id } });
    return { written: 0, rejected };
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
      inputMode: true,
      approval: true,
      supersededAt: true,
      instructor: { select: { userId: true } },
    },
  });
  if (!submission) throw new ApiError(404, "NOT_FOUND", "Submission not found");
  if (submission.approval !== "PENDING") {
    throw new ApiError(409, "ALREADY_DECIDED", "This worklog has already been decided.");
  }
  /* Rewritten since it was held.
   *
   * Superseding a held submission leaves `approval` at PENDING — nothing was
   * ever written for it, so there is nothing to un-decide — which meant a
   * manager's already-open queue could still approve it, and approval WRITES.
   * The withdrawn text's hours would land on the day beside the replacement's.
   * The instructor's newer submission is the one to act on. */
  if (submission.supersededAt) {
    throw new ApiError(
      409,
      "SUPERSEDED",
      "This worklog has been rewritten since it was held. Review the newer submission instead.",
    );
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
  /* Read the way it was written.
   *
   * Approval re-reads rather than replaying a stored plan — the taxonomy is the
   * authority at the moment of writing, and hours may have passed. So it has to
   * pick the same reader the background parse would have: a paragraph put
   * through `parseBullets` comes back as ONE activity, and a manager approving a
   * five-activity day would have written a single row covering the first
   * clock range in it. */
  const parsed =
    submission.inputMode === "NARRATIVE"
      ? await parseNarrative(bullets.join("\n"), taxonomy)
      : await parseBullets(bullets, taxonomy);
  if (!parsed.ok) {
    throw new ApiError(
      503,
      "PARSE_UNAVAILABLE",
      "The worklog could not be read just now. Nothing was changed — try approving again shortly.",
    );
  }

  /* Asked AGAIN here, immediately before anything is written.
   *
   * The check near the top of this function ran before `parseBullets`, and a
   * parse is a provider round-trip this module is willing to spend over a
   * minute on — six attempts at forty-five seconds, plus backoff. An instructor
   * can resubmit the day inside that window, which supersedes this submission
   * and deletes the activities it had produced.
   *
   * Approval is the ONLY path that ever writes a held submission's activities,
   * so this is precisely the guard that has to hold at write time. Without it,
   * approving a submission the instructor had already replaced wrote the
   * withdrawn text's hours onto the day, attached to a row every read filters
   * out — invisible in the UI and present in every total.
   *
   * `runParse` has taken this precaution since it was written; the approval
   * path simply never had it. */
  if (await isSuperseded(submission.id)) {
    throw new ApiError(
      409,
      "SUBMISSION_SUPERSEDED",
      "This worklog was replaced while it was being approved. Nothing was written — open the day to see what it says now.",
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
  /* What was actually written, not what was approved.
   *
   * This said "The activities for {date} have been recorded" whatever the write
   * returned — including when every line was refused, which the re-parse can do
   * for reasons that did not exist when the manager read the day: an overlap
   * with an entry added since, a once-per-day type already used. The instructor
   * was told their day was recorded and it was not.
   *
   * `runParse` has always reported refused lines with the reason for each.
   * Approval writes through the same function and said nothing. */
  await createNotification({
    userId: submission.instructor.userId,
    universityId: submission.universityId,
    type: "WORKLOG_APPROVED",
    title: "Your worklog was approved.",
    message:
      outcome.written > 0
        ? `The activities for ${workDate} have been recorded.`
        : `Your manager approved it, but nothing could be recorded for ${workDate}. ` +
          `See the note below for what each line needs.`,
    dedupeKey: `worklog-decision:${submission.id}`,
  }).catch(() => {});

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
      dedupeKey: `worklog-unrecorded:${submission.id}`,
    }).catch(() => {});
  }

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
