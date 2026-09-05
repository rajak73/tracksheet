/**
 * The day's insight: summarised once, then served from storage.
 *
 * ── Why this is not `serveInsight` ────────────────────────────────────────
 * `serveInsight` caches a generated payload against a context hash, which is
 * the right shape for a week. A day already has a table of its own with its own
 * hash, its own status and its own record of why a generation was refused.
 * Routing days through the insight cache as well would store one answer in two
 * places, keyed by two hashes, and the day they disagree the screen shows
 * whichever was read first.
 *
 * So the day path is the same shape as `serveInsight` — cache first, then the
 * read-only gate, then a single-flight generation — over `DayExtraction`.
 */
import { prisma } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import {
  buildCanonicalContext,
  canonicalJson,
  contextHash,
  modelId,
  PROMPT_VERSION_EXTRACT,
  stableStringify,
} from "./context";
import { generationModeFor, type ViewerRole } from "./access";
import { parseActivities } from "@/domain/worklog-activities";
import { toDateOnly } from "@/server/time/workday";
import {
  labelText,
  structureActivity,
  type InsightItem,
  type ProviderCall,
  type SummaryDayInput,
} from "./worklog-summary";
import {
  readCanonicalDays,
  readItems,
  type CanonicalDayInsight,
  type InsightStatus,
} from "./canonical";

/**
 * What a day's cell renders.
 *
 * The same shape the shared reader produces, because a viewer's page and a
 * roster's bulk read must not be able to disagree about a day. `scope` is added
 * for the single-day endpoint's own contract.
 */
export type ServedDayInsight = CanonicalDayInsight & {
  scope: { type: "DAY"; period_start: string; period_end: string };
};

/** What the summariser is sent: the day exactly as it was filed. */
export type DayRow = {
  log_date: string;
  deliverable: string | null;
  deliverable_quantity: string | null;
  working_minutes: number | null;
  remarks: string | null;
  activities?: unknown;
};

/**
 * One day, in the shape the prompt describes.
 *
 * A day entered as rows becomes one activity per row, carrying the quantity and
 * duration the instructor typed against it. A day written as free text becomes
 * a single activity holding the whole text: the model is expected to find the
 * several activities inside it, which is the case the prompt exists for.
 */
export function toSummaryDay(row: DayRow): SummaryDayInput {
  const rows = parseActivities(row.activities);
  const remarks = row.remarks ?? "";

  if (rows && rows.length > 0) {
    return {
      date: row.log_date,
      activities: rows.map((r) => ({
        text: r.description,
        quantity: r.quantity,
        hours: Math.floor(r.minutes / 60),
        minutes: r.minutes % 60,
      })),
      remarks,
    };
  }

  const text = [row.deliverable, row.deliverable_quantity]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(" — ");

  /* A free-text day is one activity holding the whole day's words, so the
     day's own recorded total is its duration — there is nothing else it could
     be. If the model reads several activities out of that text they share the
     one figure, and the caller gives none of them a duration rather than
     inventing a split. */
  const recorded = row.working_minutes ?? 0;
  return {
    date: row.log_date,
    activities: text
      ? [{ text, quantity: null, hours: Math.floor(recorded / 60), minutes: recorded % 60 }]
      : [],
    remarks,
  };
}

/** The day as the hash sees it. Nothing derived, nothing tidied. */
export function canonicalDay(row: DayRow): string {
  return stableStringify({
    deliverable: row.deliverable,
    deliverable_quantity: row.deliverable_quantity,
    working_minutes: row.working_minutes,
    activities: row.activities ?? null,
    remarks: row.remarks,
  });
}

/**
 * Summarise a day, writing the result once.
 *
 * Single-flight on `(instructorId, logDate)` through a transaction-scoped
 * advisory lock: two viewers opening the same uncached day would otherwise both
 * pay for it. A database lock rather than an in-process one, because the app
 * runs more than one instance.
 */
export async function summariseDay(input: {
  instructorId: string;
  logDate: Date;
  row: DayRow;
  sourceHash: string;
  call?: ProviderCall;
}) {
  const existing = await prisma.dayExtraction.findUnique({
    where: { instructorId_logDate: { instructorId: input.instructorId, logDate: input.logDate } },
  });
  if (existing && existing.sourceHash === input.sourceHash) return existing;

  const lockKey = `summary:${input.instructorId}:${input.logDate.toISOString().slice(0, 10)}`;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      // Re-read inside the lock: whoever held it first may have written the
      // very row this call was about to pay for.
      const fresh = await tx.dayExtraction.findUnique({
        where: {
          instructorId_logDate: { instructorId: input.instructorId, logDate: input.logDate },
        },
      });
      if (fresh && fresh.sourceHash === input.sourceHash) return fresh;

      const day = toSummaryDay(input.row);

      /* ── What the last normalisation already settled ──────────────────
       *
       * Keyed on the RAW TEXT of the line it came from, not its position. A
       * day's hash covers everything about the day, so any edit at all makes
       * the whole day stale and brings us here — but most edits change no
       * words: a duration corrected, a quantity fixed, a row deleted, three
       * rows reordered. Re-reading unchanged sentences would be paying a model
       * to answer a question it has already answered.
       *
       * Position was the obvious key and is the wrong one. Rows carry no id, so
       * an insert or a reorder shifts every index after it and would invalidate
       * work nobody touched. The words are the identity, because the words are
       * the entire input Stage A gets. */
      /* Grouped by OCCURRENCE first, then keyed by the words.
      
         `sourceText` alone is not an identity: a day may hold the same sentence
         twice with different durations, and flattening both occurrences into one
         list made every row look like a multi-phrase row — which zeroed every
         duration and lost the day. So the previous items are regrouped into the
         row each came from, and one such group becomes the template for any row
         with those words. */
      const byOccurrence = new Map<string, InsightItem[]>();
      for (const item of readItems(fresh?.items)) {
        if (!item.sourceText) continue;
        const slot = `${item.sourceIndex ?? 0}\u0000${item.sourceText}`;
        byOccurrence.set(slot, [...(byOccurrence.get(slot) ?? []), item]);
      }
      const templateByText = new Map<string, InsightItem[]>();
      for (const group of byOccurrence.values()) {
        const text = group[0]!.sourceText!;
        if (!templateByText.has(text)) templateByText.set(text, group);
      }

      /* One reading per DISTINCT sentence, not per row. Two identical lines are
         the same question, and asking it twice is paying twice for one answer;
         each row still keeps its own duration below. */
      const distinct = [...new Set(day.activities.map((a) => a.text))].filter(
        (text) => !templateByText.has(text),
      );
      const freshByText = new Map<string, Awaited<ReturnType<typeof labelText>>>();
      await Promise.all(
        distinct.map(async (text) => {
          freshByText.set(text, await labelText(text, input.call));
        }),
      );

      const labelled = day.activities.map((activity) => {
        const template = templateByText.get(activity.text);
        if (template) return { reused: template, fresh: null };
        return { reused: null, fresh: freshByText.get(activity.text) ?? null };
      });

      /* Stage B runs only for the lines Stage A just read. It gets the settled
         phrase and the raw text and returns only subject and topics — it has no
         field for the phrase or the action, so it cannot overwrite either. */
      /* Stage B likewise runs once per distinct new sentence. It gets the
         settled phrase and the raw text and returns only subject and topics —
         it has no field for the phrase or the action, so it cannot overwrite
         either. When it fails it answers with nothing. */
      const structureByText = new Map<string, Awaited<ReturnType<typeof structureActivity>>[]>();
      await Promise.all(
        distinct.map(async (text) => {
          const read = freshByText.get(text);
          if (!read?.ok) return;
          structureByText.set(
            text,
            await Promise.all(read.activities.map((a) => structureActivity(a.activity, text, input.call))),
          );
        }),
      );

      const items: InsightItem[] = [];
      let failure: string | null = null;
      labelled.forEach((result, index) => {
        const source = day.activities[index]!;
        const minutes = (source.hours ?? 0) * 60 + (source.minutes ?? 0);

        if (result.reused) {
          /* The words are the same; the minutes may not be. Duration is
             re-attached from the row as it stands now, which is exactly what
             makes a duration-only edit cost nothing. */
          const share = result.reused.length === 1 ? minutes : 0;
          for (const item of result.reused) {
            items.push({ ...item, durationMinutes: share, sourceIndex: index });
          }
          return;
        }

        const read = result.fresh;
        if (!read || !read.ok) {
          failure ??= read ? read.reason : "no reading for this activity";
          return;
        }
        /* A line that produced several phrases had ONE duration between them.
           Splitting it would be an invention, so each phrase renders without a
           figure and the day's Working Hours column still shows the total. */
        const share = read.activities.length === 1 ? minutes : 0;
        read.activities.forEach((labelledActivity, phraseIndex) => {
          const structure = structureByText.get(source.text)?.[phraseIndex] ?? {
            subject: null,
            topics: [],
            subtopics: [],
          };
          items.push({
            activity: labelledActivity.activity,
            action: labelledActivity.action,
            subject: structure.subject,
            topics: structure.topics,
            subtopics: structure.subtopics,
            durationMinutes: share,
            /* Kept so the next edit can recognise this line, and tell two
               identical lines apart. */
            sourceText: source.text,
            sourceIndex: index,
          });
        });
      });

      const ok = items.length > 0;
      if (!ok) failure ??= "no activity could be labelled";

      const common = {
        sourceHash: input.sourceHash,
        rawContext: JSON.parse(canonicalDay(input.row)) as object,
        promptVersion: PROMPT_VERSION_EXTRACT,
        modelId: modelId(),
      };

      const data = ok
        ? {
            ...common,
            status: "READY" as const,
            /* The column predates the name and is reused rather than migrated:
               it has always held "the structured reading of this day", which is
               exactly what these items are. */
            items: items as unknown as Prisma.InputJsonValue,
            unallocatedMinutes: 0,
            summary: Prisma.DbNull,
            lastError: null,
            failureKind: null,
          }
        : {
            ...common,
            status: "FAILED" as const,
            items: [],
            unallocatedMinutes: recorded,
            summary: Prisma.DbNull,
            lastError: failure,
            failureKind: failure?.startsWith("provider") ? "provider" : "structure",
          };

      return tx.dayExtraction.upsert({
        where: {
          instructorId_logDate: { instructorId: input.instructorId, logDate: input.logDate },
        },
        create: { instructorId: input.instructorId, logDate: input.logDate, ...data },
        update: data,
      });
    },
    { timeout: 60_000 },
  );
}

export async function serveDayInsight(input: {
  instructorId: string;
  date: string;
  viewerRole: ViewerRole;
  /** Injected by tests so calls can be counted without a provider. */
  call?: ProviderCall;
}): Promise<ServedDayInsight> {
  const scope = { type: "DAY" as const, period_start: input.date, period_end: input.date };

  /* ── The shared read, first ─────────────────────────────────────────────
   * The same function the roster uses, asked about one person. A hit here is
   * the whole answer for every viewer, and it costs no model call whoever is
   * looking. */
  const canonical = (await readCanonicalDays({ instructorIds: [input.instructorId], date: input.date })).get(
    input.instructorId,
  );
  if (!canonical) {
    return {
      scope,
      status: "EMPTY",
      items: [],
      total_minutes: 0,
      raw_text: null,
      cached: false,
      generated_at: null,
      last_error: null,
      failure_kind: null,
    };
  }
  if (canonical.status === "READY" || canonical.status === "EMPTY" || canonical.status === "FAILED") {
    return { ...canonical, scope };
  }

  /* ── Read-only, so this is where it stops ─────────────────────────────────
   * A manager's day. Nothing stored is current, and the answer is PENDING —
   * not a stale insight, which describes text that has since changed. No call
   * and no write, on any path, including a page-load batch. */
  if (generationModeFor(input.viewerRole, "DAY") === "READ_ONLY") {
    return { ...canonical, scope };
  }

  const context = await buildCanonicalContext({
    instructorId: input.instructorId,
    periodStart: input.date,
    periodEnd: input.date,
  });
  const row = context.days[0] as DayRow | undefined;
  if (!row) return { ...canonical, scope };

  const sourceHash = contextHash(canonicalJson(context), PROMPT_VERSION_EXTRACT, modelId());
  const written = await summariseDay({
    instructorId: input.instructorId,
    logDate: toDateOnly(input.date),
    row,
    sourceHash,
    call: input.call,
  });

  return {
    scope,
    status: written.status as InsightStatus,
    items: written.status === "READY" ? readItems(written.items) : [],
    total_minutes: row.working_minutes ?? 0,
    raw_text: row.deliverable,
    cached: false,
    generated_at: written.generatedAt.toISOString(),
    last_error: written.lastError,
    failure_kind:
      written.status === "FAILED"
        ? ((written.failureKind as "structure" | "provider" | null) ?? "structure")
        : null,
  };
}
