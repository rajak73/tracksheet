/**
 * The options the parser is allowed to choose between.
 *
 * ── Read from the database, not from a constant ────────────────────────────
 * The taxonomy already lives in `ActivityType` and `DeliverableType`, and the
 * foreign key on `ActivityLog` is what ultimately refuses anything outside it.
 * Loading the same rows the write will be checked against means the list the
 * model is offered and the list the database accepts cannot drift apart — a
 * hard-coded copy here would eventually disagree with the seed and the failure
 * would look like the model hallucinating.
 */

import { prisma } from "@/server/db";
import { ENTRY_CATEGORY_CODES } from "@/../prisma/reference-data";

export type DeliverableOption = { id: string; code: string; label: string };

export type CategoryOption = {
  id: string;
  code: string;
  label: string;
  deliverables: DeliverableOption[];
};

export type SubjectOption = { id: string; code: string; label: string };

export type Taxonomy = {
  categories: CategoryOption[];
  /** The subjects a line can be about — Technical, English, Aptitude, Maths. */
  subjects: SubjectOption[];
  subjectByCode: Map<string, SubjectOption>;
  /** Lookup by code, for turning the model's answer back into ids. */
  categoryByCode: Map<string, CategoryOption>;
  deliverableByCode: Map<string, DeliverableOption & { categoryCode: string }>;
};

/** The category a bullet lands in when nothing else fits. Never invented. */
export const FALLBACK_CATEGORY = "OTHER";
export const FALLBACK_DELIVERABLE = "UNCLASSIFIED_WORK";

/**
 * Loads the eleven entry categories and their deliverables.
 *
 * Deliberately NOT every `ActivityType`: `DAILY_OPENING` and `DAILY_CLOSING`
 * are derived from the university's working hours and `UNUTILIZED` is computed
 * idle time. Offering those to the parser would let a sentence overwrite
 * something the engine is supposed to work out for itself.
 */
export async function loadTaxonomy(): Promise<Taxonomy> {
  // The subjects come from the same table an admin files instructors under, so
  // the list a model is offered and the list a foreign key accepts are one list.
  const subjectRows = await prisma.instructorCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, code: true, label: true },
  });

  const rows = await prisma.activityType.findMany({
    where: { code: { in: [...ENTRY_CATEGORY_CODES] }, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      code: true,
      label: true,
      deliverableTypes: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, code: true, label: true },
      },
    },
  });

  const categories: CategoryOption[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    deliverables: r.deliverableTypes,
  }));

  const categoryByCode = new Map(categories.map((c) => [c.code, c]));
  const deliverableByCode = new Map<string, DeliverableOption & { categoryCode: string }>();
  for (const category of categories) {
    for (const d of category.deliverables) {
      deliverableByCode.set(d.code, { ...d, categoryCode: category.code });
    }
  }

  return {
    categories,
    subjects: subjectRows,
    subjectByCode: new Map(subjectRows.map((x) => [x.code, x])),
    categoryByCode,
    deliverableByCode,
  };
}
