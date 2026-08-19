/**
 * What `GET /api/instructors/[id]/worklog` returns, as the screens read it.
 *
 * These lived in `WorklogReview.tsx`, a 530-line component built for a flow the
 * product no longer has: correcting the parser's reading line by line. The
 * instructor writes one block of context now and edits it as a block, so the
 * component had no entry point — its required `onCorrect` had no supplier and
 * nothing rendered it. Only these types were ever imported from it.
 *
 * They live here rather than being re-declared per screen because the response
 * shape is one contract with the route, and two copies of a contract is how the
 * two drift.
 */

export type Rejection = {
  index: number;
  rawText: string;
  /** Why this line was refused, in the reader's own words. */
  reason: string;
};

export type ParsedEntry = {
  id: string;
  /** The instructor's sentence, kept beside what was made of it. */
  rawText: string | null;
  startTime: string;
  endTime: string;
  quantity: number;
  remarks: string | null;
  activityType: { code: string; label: string };
  /** Null when the sentence named nothing specific; the category then decides. */
  deliverableType: { code: string; label: string; isCountable: boolean } | null;
};

export type Submission = {
  id: string;
  status: "PENDING" | "PARSED" | "FAILED";
  parseError: string | null;
  /** Lines that were read but refused, with the reason for each. */
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
