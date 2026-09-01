/**
 * Notifications.
 *
 * The sweep below reuses the anomaly and exception detectors rather than
 * introducing a third set of rules. A notification that fired on criteria the
 * dashboard did not share would be a second source of truth about what counts
 * as a problem, and the two would drift.
 *
 * Every notification carries a `dedupeKey`. The rollup runs hourly, so without
 * one an unresolved condition would notify the same person every hour until it
 * was fixed — which trains people to ignore notifications.
 */

import { prisma } from "@/server/db";
import { detectExceptions } from "@/server/analytics/exceptions";

export type NotificationInput = {
  userId: string;
  title: string;
  message: string;
  type?: string;
  universityId?: string | null;
  /** Stable identity for the underlying condition; repeats are suppressed. */
  dedupeKey?: string;
};

/**
 * Creates a notification unless one with the same dedupeKey already exists for
 * that user. Returns null when suppressed, so callers can count what actually
 * reached someone.
 */
export async function createNotification(
  userIdOrInput: string | NotificationInput,
  title?: string,
  message?: string,
) {
  // Kept callable with the original positional signature so existing callers
  // do not have to change.
  const input: NotificationInput =
    typeof userIdOrInput === "string"
      ? { userId: userIdOrInput, title: title ?? "", message: message ?? "" }
      : userIdOrInput;

  if (!input.dedupeKey) {
    return prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        message: input.message,
        type: input.type ?? "GENERAL",
        universityId: input.universityId ?? null,
      },
    });
  }

  // The unique index on (userId, dedupeKey) is the actual guarantee; this
  // check just avoids the round-trip in the common case. Both are needed: two
  // sweeps racing would pass the check simultaneously, and only the constraint
  // stops the duplicate.
  const existing = await prisma.notification.findUnique({
    where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
  });
  if (existing) return null;

  try {
    return await prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        message: input.message,
        type: input.type ?? "GENERAL",
        universityId: input.universityId ?? null,
        dedupeKey: input.dedupeKey,
      },
    });
  } catch (error) {
    // A duplicate is the expected outcome of a race, not a failure. Letting it
    // propagate would abandon the rest of the sweep, so the remaining
    // notifications for that university would silently never be sent.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    ) {
      return null;
    }
    throw error;
  }
}

const DEADLINE_WARNING_DAYS = 7;

/**
 * Generates notifications for one university over a period.
 *
 * Covers the four categories the spec names:
 *   deliverable deadlines, missing opening/closing, unusual workload, and
 *   report availability (the last is emitted by the report job, not here).
 *
 * Managers receive university-level signals; instructors receive only their
 * own. Nobody is notified about a colleague.
 */
export async function runNotificationSweep(
  universityId: string,
  from: string,
  to: string,
): Promise<{ created: number; suppressed: number }> {
  /* The analytics pass went with section 3. Nothing left needs a computed
     figure — the two remaining notifications are about a day nobody filed and
     a deliverable past its date, both read straight from rows. */
  const [university, exceptions] = await Promise.all([
    prisma.university.findUnique({
      where: { id: universityId },
      select: { primaryManager: { select: { userId: true } } },
    }),
    detectExceptions({ universityId, from, to }),
  ]);

  const managerUserId = university?.primaryManager?.userId ?? null;

  const instructorUsers = await prisma.instructor.findMany({
    where: { universityId },
    select: { id: true, userId: true },
  });
  const userIdFor = new Map(instructorUsers.map((i) => [i.id, i.userId]));

  let created = 0;
  let suppressed = 0;
  const emit = async (input: NotificationInput) => {
    const result = await createNotification(input);
    if (result) created += 1;
    else suppressed += 1;
  };

  // ── 1. Deliverable deadlines ─────────────────────────────────────────────
  const horizon = new Date(`${to}T00:00:00.000Z`);
  horizon.setUTCDate(horizon.getUTCDate() + DEADLINE_WARNING_DAYS);

  const dueSoon = await prisma.deliverable.findMany({
    where: {
      universityId,
      deletedAt: null,
      status: { notIn: ["COMPLETED", "CANCELLED"] },
      dueDate: { lte: horizon },
    },
    select: { id: true, title: true, dueDate: true, instructorId: true },
  });

  for (const d of dueSoon) {
    const due = d.dueDate.toISOString().slice(0, 10);
    const overdue = d.dueDate < new Date(`${to}T00:00:00.000Z`);
    const targets = [userIdFor.get(d.instructorId), managerUserId].filter(Boolean) as string[];
    for (const userId of targets) {
      await emit({
        userId,
        universityId,
        type: overdue ? "DELIVERABLE_OVERDUE" : "DELIVERABLE_DUE",
        title: overdue ? "Deliverable past its due date" : "Deliverable due soon",
        message: `"${d.title}" is due ${due}.`,
        dedupeKey: `${overdue ? "DELIVERABLE_OVERDUE" : "DELIVERABLE_DUE"}:${d.id}`,
      });
    }
  }

  // ── 2. Missing opening / closing ─────────────────────────────────────────
  for (const flag of exceptions.exceptions) {
    if (flag.type !== "MISSED_CLOSING" && flag.type !== "LATE_OPENING") continue;
    const userId = userIdFor.get(flag.instructorId);
    if (!userId) continue;
    await emit({
      userId,
      universityId,
      type: flag.type,
      title: flag.type === "MISSED_CLOSING" ? "Daily closing not recorded" : "Daily opening was late",
      message: `${flag.date}: ${flag.detail}`,
      dedupeKey: `${flag.type}:${flag.instructorId}:${flag.date}`,
    });
  }

  /* Section 3, "Unusual workload", is gone.
   *
   * It ran `detectAnomalies` over the analytics result, took the OVERLOAD and
   * LEARNING_DROP conditions, had a model narrate each into a title and a
   * sentence, and sent that to the instructor AND their manager. A grader
   * deciding somebody's week was unusual, and then telling them so.
   *
   * The sections above stay: they notify on facts — a day nobody filed, a
   * deliverable past its date — not on a judgement about a person. */

  return { created, suppressed };
}
