/**
 * Narration — turning a detected condition into a sentence.
 *
 * ── The boundary ───────────────────────────────────────────────────────────
 * `narrateCondition` receives an `AnomalyCondition` and NOTHING ELSE. It has no
 * database access, no instructor records, no activity rows — by construction,
 * not by convention. That is what makes the requirement "never send raw
 * ActivityLog to the model" enforceable rather than aspirational: this function
 * is the only thing that would ever be replaced by a model call, and its input
 * type physically cannot carry an activity row.
 *
 * ── Why there is no model call here ────────────────────────────────────────
 * The current narrator is deterministic. No LLM is wired, because none is
 * configured for this project, and pretending otherwise would mean shipping a
 * code path nobody has run. A deterministic narrator also keeps insight text
 * testable: an assertion that every number in a sentence appears in the stored
 * snapshot is meaningful only if the sentence is reproducible.
 *
 * Swapping in a model means replacing the body of `narrateCondition` with a
 * call whose prompt is built from `condition` alone. The signature is the
 * contract; nothing above or below it needs to change.
 *
 * ── Language rules ─────────────────────────────────────────────────────────
 * Describe the measurement, recommend a review, never characterise a person.
 * "Recorded utilisation of 42%" is a fact. "Underperforming" is a judgement the
 * data does not support.
 */

import type { AnomalyCondition } from "@/server/ai/anomalies";

export type Narration = {
  title: string;
  summary: string;
  recommendation: string;
};

const pct = (v: unknown) => `${v}%`;
const hrs = (v: unknown) => `${v} hours`;

export function narrateCondition(condition: AnomalyCondition): Narration {
  const m = condition.metrics;
  const who = condition.instructorName ? `${condition.instructorName}` : "This university";

  switch (condition.type) {
    case "NO_DATA_RECORDED":
      return {
        title: "No activity recorded",
        summary:
          `No activity was recorded against ${hrs(m.capacityHours)} of available capacity ` +
          `for ${m.instructors} instructor(s) in this period.`,
        recommendation:
          "This most likely indicates the system is not yet in use rather than an absence of " +
          "work. Confirming logging practice is recommended before treating these figures as " +
          "workload data.",
      };

    case "OVERLOAD":
      return {
        title: "Recorded time above capacity",
        summary:
          `${who} recorded ${hrs(m.productiveHours)} against ${hrs(m.capacityHours)} of ` +
          `configured capacity — utilisation of ${pct(m.utilizationPct)}, above the ` +
          `${pct(condition.threshold.utilizationPct)} reference level.`,
        recommendation:
          "Reviewing workload distribution is recommended. Recorded time above capacity may " +
          "also indicate overlapping or misdated records rather than additional hours worked.",
      };

    case "UNDERUTILIZATION":
      return {
        title: "Utilisation below reference level",
        summary:
          `${who} recorded utilisation of ${pct(m.utilizationPct)} against ` +
          `${hrs(m.capacityHours)} of configured capacity, below the ` +
          `${pct(condition.threshold.utilizationPct)} reference level` +
          (Number(m.missingDataHours) > 0
            ? `, with ${hrs(m.missingDataHours)} of that period carrying no records at all.`
            : "."),
        recommendation:
          "This may indicate available capacity, or simply activity that was not recorded. " +
          "A manager review of task assignment and logging practice is recommended before " +
          "drawing conclusions.",
      };

    case "LEARNING_DROP":
      return {
        title: "Learning time decreased",
        summary:
          `Recorded learning fell ${pct(m.dropPct)}, from ${hrs(m.previousHours)} in the ` +
          `period ${m.previousFrom} to ${m.previousTo}, to ${hrs(m.currentHours)} in this one.`,
        recommendation:
          "Reviewing whether professional development time is being protected, and whether it " +
          "is being recorded, is recommended.",
      };

    case "COMPLIANCE_RISK":
      return {
        title: `Daily ${m.kind} compliance below reference level`,
        summary:
          `Daily ${m.kind} was recorded on ${pct(m.compliancePct)} of expected working days, ` +
          `below the ${pct(condition.threshold.compliancePct)} reference level.`,
        recommendation:
          `Confirming whether this reflects the ${m.kind} process itself or how it is being ` +
          "recorded is recommended.",
      };

    case "DELIVERABLE_RISK":
      return {
        title: "Deliverables at risk",
        summary:
          `${m.completedQuantity} of ${m.targetQuantity} units completed across ${m.total} ` +
          `deliverable(s)` +
          (Number(m.overdue) > 0 ? `, with ${m.overdue} past its due date.` : "."),
        recommendation:
          "Reviewing scope or reassigning capacity is recommended for deliverables approaching " +
          "their due date.",
      };

    case "INCOMPLETE_DATA":
      return {
        title: "Some working time has no records",
        summary:
          `${hrs(m.missingDataHours)} of expected working time have no activity records, out ` +
          `of ${hrs(m.capacityHours)} of capacity.`,
        recommendation:
          "These hours are reported as missing data, not as unutilised time. The figures above " +
          "should be read with that in mind.",
      };
  }
}
