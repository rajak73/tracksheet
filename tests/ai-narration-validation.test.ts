import { describe, expect, test } from "vitest";
import { validateNarration } from "@/server/ai/validate";
import type { AnomalyCondition } from "@/server/ai/anomalies";

/**
 * The deterministic validator between the model and the UI. Every case here
 * is deliberately NOT substring matching — each rejects a claim that would
 * survive a naive "does the true number appear somewhere in the text" check,
 * because the model also wrote a FALSE number alongside it.
 */

const CONDITION: AnomalyCondition = {
  type: "UNDERUTILIZATION",
  severity: "MEDIUM",
  scope: "INSTRUCTOR",
  instructorId: "inst-1",
  instructorName: "{{SUBJECT}}",
  metrics: {
    utilizationPct: 44.38,
    recordedHours: 17.75,
    capacityHours: 40,
    missingDataHours: 8,
  },
  threshold: { utilizationPct: 60 },
};

describe("valid narration is accepted", () => {
  test("exact deterministic values, paraphrased", () => {
    const result = validateNarration(CONDITION, {
      summary:
        "{{SUBJECT}} recorded utilisation of 44.38% against 40 hours of capacity, with 8 hours " +
        "carrying no records, below the 60% reference level.",
      recommendation: "A manager review of task assignment is recommended.",
    });
    expect(result.ok).toBe(true);
  });

  test("rounded forms of the same true values", () => {
    // 44.38 -> "44%" and 17.75 -> "17.8 hours" are paraphrases of the SAME
    // quantity, not new facts, and must not be rejected.
    const result = validateNarration(CONDITION, {
      summary: "{{SUBJECT}} recorded roughly 44% utilisation, about 17.8 hours logged.",
      recommendation: "Review workload allocation.",
    });
    expect(result.ok).toBe(true);
  });

  test("a qualitative recommendation needs no numeric match", () => {
    const result = validateNarration(CONDITION, {
      summary: "{{SUBJECT}} recorded utilisation of 44.38% against 40 hours of capacity.",
      recommendation:
        "Reviewing whether this reflects available capacity or unrecorded work is recommended.",
    });
    expect(result.ok).toBe(true);
  });
});

describe("hallucinated numbers are rejected — the exact case from the brief", () => {
  test('rejects "52%" when the deterministic utilisation is 44.38%', () => {
    const result = validateNarration(CONDITION, {
      summary: "{{SUBJECT}} recorded utilisation of 52%.",
      recommendation: "Review workload allocation.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.some((v) => v.includes("52"))).toBe(true);
  });

  test('rejects "38 hours" when deterministic recordedHours is 17.75', () => {
    const result = validateNarration(CONDITION, {
      summary: "{{SUBJECT}} had 38 hours recorded this period.",
      recommendation: "Review workload allocation.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.some((v) => v.includes("38"))).toBe(true);
  });

  test("a true number ACCOMPANIED by a false one still fails — this is what substring matching misses", () => {
    // "44.38%" is genuinely present. A validator that only checks presence of
    // the true value would pass this. The false "61%" must still be caught.
    const result = validateNarration(CONDITION, {
      summary: "{{SUBJECT}} recorded utilisation of 44.38%, down from 61% last period.",
      recommendation: "Review workload allocation.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.some((v) => v.includes("61"))).toBe(true);
  });
});

describe("unsupported counts, comparisons and thresholds", () => {
  test("an invented count is rejected", () => {
    const deliverable: AnomalyCondition = {
      type: "DELIVERABLE_RISK",
      severity: "HIGH",
      scope: "INSTRUCTOR",
      instructorName: "{{SUBJECT}}",
      metrics: { total: 3, completedQuantity: 2, targetQuantity: 10, overdue: 1 },
      threshold: {},
    };
    const result = validateNarration(deliverable, {
      summary: "{{SUBJECT}} has 7 deliverables overdue.",
      recommendation: "Review scope.",
    });
    expect(result.ok).toBe(false);
  });

  test("a fabricated threshold is rejected", () => {
    const result = validateNarration(CONDITION, {
      summary: "{{SUBJECT}} fell below the 75% reference level.", // real threshold is 60
      recommendation: "Review workload allocation.",
    });
    expect(result.ok).toBe(false);
  });

  test("an unsupported comparison to an external benchmark is rejected", () => {
    const result = validateNarration(CONDITION, {
      summary: "{{SUBJECT}} recorded utilisation of 44.38%, below the industry average.",
      recommendation: "Review workload allocation.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes("industry average"))).toBe(true);
    }
  });
});

describe("changed date ranges", () => {
  const withDates: AnomalyCondition = {
    type: "LEARNING_DROP",
    severity: "LOW",
    scope: "UNIVERSITY",
    metrics: {
      dropPct: 40,
      previousHours: 10,
      currentHours: 6,
      previousFrom: "2026-08-01",
      previousTo: "2026-08-07",
    },
    threshold: {},
  };

  test("the real date range is accepted", () => {
    const result = validateNarration(withDates, {
      summary: "Learning fell 40%, from the period 2026-08-01 to 2026-08-07, to 6 hours.",
      recommendation: "Review whether learning time is protected.",
    });
    expect(result.ok).toBe(true);
  });

  test("a fabricated date is rejected even though the rest of the sentence is true", () => {
    const result = validateNarration(withDates, {
      summary: "Learning fell 40%, from the period 2026-09-01 to 2026-09-07, to 6 hours.",
      recommendation: "Review whether learning time is protected.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes("2026-09-01"))).toBe(true);
    }
  });
});

describe("unsupported subject names", () => {
  test("an invented honorific-plus-name is rejected", () => {
    // The model is never given a name — only {{SUBJECT}}. Any name in the
    // output was invented outright.
    const result = validateNarration(CONDITION, {
      summary: "Dr. Sarah recorded utilisation of 44.38%.",
      recommendation: "Review workload allocation.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes("invented subject name"))).toBe(true);
    }
  });

  test("missing the subject placeholder entirely is rejected", () => {
    const result = validateNarration(CONDITION, {
      summary: "Utilisation was recorded at 44.38% against 40 hours of capacity.",
      recommendation: "Review workload allocation.",
    });
    expect(result.ok).toBe(false);
  });
});

describe("claims about workload, performance or competence", () => {
  test.each([
    "This instructor is underperforming.",
    "{{SUBJECT}} has been lazy this period.",
    "{{SUBJECT}} is negligent in recording activity.",
    "A disciplinary review is recommended.",
  ])("rejects: %s", (text) => {
    const result = validateNarration(CONDITION, {
      summary: "{{SUBJECT}} recorded utilisation of 44.38%.",
      recommendation: text,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.includes("judgemental"))).toBe(true);
    }
  });
});

describe("malformed narration", () => {
  test("an empty summary is rejected", () => {
    const result = validateNarration(CONDITION, { summary: "", recommendation: "Review it." });
    expect(result.ok).toBe(false);
  });

  test("whitespace-only recommendation is rejected", () => {
    const result = validateNarration(CONDITION, {
      summary: "{{SUBJECT}} recorded utilisation of 44.38%.",
      recommendation: "   ",
    });
    expect(result.ok).toBe(false);
  });
});

describe("contradiction of deterministic metrics", () => {
  test("a number that contradicts the metric it describes is rejected even when close", () => {
    // 44.38 vs 45 — not a rounding of the same value at any reasonable
    // precision, so this must fail rather than be waved through as "close
    // enough". The validator does exact/rounded matching, not fuzzy matching.
    const result = validateNarration(CONDITION, {
      summary: "{{SUBJECT}} recorded utilisation of 45%.",
      recommendation: "Review workload allocation.",
    });
    expect(result.ok).toBe(false);
  });
});
