/**
 * The role-aware assistant: one call, one verified reply, or nothing.
 *
 *   session -> TenantScope -> buildInsightContext -> buildInstruction
 *                                                        |
 *                                  cache hit? --- no --- Gemini (once)
 *                                     |                    |
 *                                     |               parse + verify
 *                                     |                    |
 *                                     +-------- reply -----+
 *
 * ── Three properties this file is responsible for ──────────────────────────
 *
 * 1. The model never widens its own scope. The context is built from the
 *    caller's `TenantScope` before anything is sent, and no argument here can
 *    change it — there is no `universityId` or `managerId` parameter to pass.
 *
 * 2. The model never becomes the source of a number. Every numeric token in a
 *    reply must be justified by a value the analytics layer actually produced,
 *    or the whole reply is discarded. This is the same discipline the anomaly
 *    narrator uses, applied to a different fact set: extract every claim, then
 *    require each one to be explained, rather than searching for one true
 *    figure and calling it verified.
 *
 * 3. A failure is reported as a failure. If the key is missing, the provider
 *    is down, or the reply cannot be verified, the caller is told the insight
 *    is unavailable. Nothing is written to fill the gap — an invented summary
 *    presented as analysis is worse than an empty card, and a deterministic
 *    paragraph dressed up as AI output would be a lie about its own origin.
 *
 * ── Caching, and why it is keyed on the facts ──────────────────────────────
 * The cache key includes a hash of the exact context, so a hit is only ever
 * returned when the underlying numbers are byte-for-byte what the text was
 * written from. A time-only TTL would eventually serve a summary that
 * contradicts the dashboard beside it. Logging an hour changes the hash and
 * the next request regenerates. `expiresAt` remains as an upper bound so
 * unchanged data does not pin a reply forever.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/server/db";
import { InsightSeverity, InsightStatus } from "@/generated/prisma/client";
import { ApiError } from "@/server/http/errors";
import type { TenantScope } from "@/server/auth/scope";
import { buildInsightContext, type InsightContext } from "@/server/ai/context";
import {
  buildInstruction,
  ENTITY_TYPES,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_SEVERITIES,
  REPLY_LIMITS,
  type AssistantReply,
  type EntityType,
  type Recommendation,
  type RecommendationCategory,
  type RecommendationSeverity,
} from "@/server/ai/prompts";
import { generateStructured, isGeminiConfigured } from "@/server/ai/gemini";
import { JUDGEMENT_TERMS, UNSUPPORTED_ASSERTIONS } from "@/server/ai/validate";
import { toDateOnly } from "@/server/time/workday";
import { BRIEF_TYPE } from "@/server/ai/brief-type";

export { BRIEF_TYPE } from "@/server/ai/brief-type";

/** Upper bound on a cached reply, independent of whether the facts changed. */
const TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Output budget for one reply.
 *
 * Sized from the reply itself: five recommendations, each with a title, a
 * 300-character explanation, a metric and an action, is roughly 3,500 characters
 * of JSON. The previous 700 — inherited from an earlier, much smaller reply
 * shape — truncated real model output mid-object, so every live reply arrived as
 * `{"recommendations":` and was correctly discarded as unparseable. The feature
 * looked like a provider problem and was a budget problem.
 *
 * Current flash models also spend part of this budget on reasoning before
 * emitting anything, so the headroom is deliberate rather than generous.
 */
const MAX_REPLY_TOKENS = 4096;

/**
 * Why an insight could not be produced. Codes, not provider messages: a
 * transport error can carry a URL or a key fragment, and none of that belongs
 * in an API response.
 */
export type UnavailableReason =
  | "not_configured"
  | "no_data"
  | "provider_unavailable"
  | "unverified";

export type AssistantOutcome =
  | {
      available: true;
      cached: boolean;
      audience: InsightContext["audience"];
      period: { from: string; to: string };
      generatedAt: Date;
      reply: AssistantReply;
    }
  | { available: false; reason: UnavailableReason };

/* ── Verification ──────────────────────────────────────────────────────────── */

/** Normalises 44.0 and 44 to the same key so they compare equal. */
function canonical(n: number): string {
  return String(Number(n.toFixed(4)));
}

/**
 * Every number the reply is permitted to state, walked out of the context.
 *
 * Rounded forms are accepted because writing "44%" for 44.38 is paraphrase,
 * not invention. Rounding is only ever used to ACCEPT a token — it never
 * rewrites what the model wrote.
 */
function allowedNumbers(context: InsightContext): Set<string> {
  const allowed = new Set<string>();

  const add = (value: number) => {
    if (!Number.isFinite(value)) return;
    allowed.add(canonical(value));
    allowed.add(canonical(Math.round(value)));
    allowed.add(canonical(Number(value.toFixed(1))));
    allowed.add(canonical(Number(value.toFixed(2))));
    // Utilisation and trend are commonly written without their sign.
    allowed.add(canonical(Math.abs(value)));
    allowed.add(canonical(Math.round(Math.abs(value))));
  };

  const walk = (node: unknown) => {
    if (typeof node === "number") return add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") return Object.values(node).forEach(walk);
  };
  walk(context);

  // The band thresholds are stated in the prompt as product definitions, so a
  // reply may repeat them ("below 60 needs attention") without having invented
  // anything. They are the only constants admitted.
  [60, 75].forEach(add);
  return allowed;
}

/** Dates the reply may state: the period it was written about. */
function allowedDates(context: InsightContext): Set<string> {
  return new Set([context.period.from, context.period.to]);
}

/**
 * Decides whether a reply may be shown. Returns the reasons it may not, so a
 * rejection can be logged with enough detail to be diagnosed later.
 */
export function verifyReply(context: InsightContext, reply: AssistantReply): string[] {
  const violations: string[] = [];
  const numbers = allowedNumbers(context);
  const dates = allowedDates(context);
  const known = knownNames(context);
  const ids = knownIds(context);

  if (reply.recommendations.length > REPLY_LIMITS.maxRecommendations) {
    violations.push(`recommendations: ${reply.recommendations.length} exceeds the limit`);
  }

  reply.recommendations.forEach((rec, index) => {
    const at = (field: string) => `recommendation[${index}].${field}`;

    // Enums first: a severity outside the vocabulary would render as an
    // unstyled card, and a category outside it would break grouping.
    if (!RECOMMENDATION_SEVERITIES.includes(rec.severity)) {
      violations.push(`${at("severity")}: unknown severity "${rec.severity}"`);
    }
    if (!RECOMMENDATION_CATEGORIES.includes(rec.category)) {
      violations.push(`${at("category")}: unknown category "${rec.category}"`);
    }
    if (!ENTITY_TYPES.includes(rec.entityType)) {
      violations.push(`${at("entityType")}: unknown entity type "${rec.entityType}"`);
    }

    // An id the context does not contain is a fabricated subject, and it would
    // also produce a link to somebody the reader may not be allowed to see.
    // This is the check that keeps a recommendation inside its own scope.
    if (rec.entityId !== null) {
      if (!ids.has(rec.entityId)) {
        violations.push(`${at("entityId")}: unknown entity "${rec.entityId}"`);
      } else if (ids.get(rec.entityId) !== rec.entityType) {
        violations.push(
          `${at("entityId")}: "${rec.entityId}" is a ${ids.get(rec.entityId)}, not a ${rec.entityType}`,
        );
      }
    } else if (rec.entityType !== "PLATFORM") {
      violations.push(`${at("entityType")}: ${rec.entityType} needs an entityId`);
    }

    // `action` must read as advice for a person, not as something done. A model
    // claiming to have reassigned somebody would be describing a capability
    // this feature deliberately does not have.
    for (const claim of PERFORMED_ACTIONS) {
      if (rec.action.toLowerCase().includes(claim)) {
        violations.push(`${at("action")}: claims to perform an action ("${claim}")`);
      }
    }

    const fields: Array<[string, string, number]> = [
      ["title", rec.title, REPLY_LIMITS.titleChars],
      ["explanation", rec.explanation, REPLY_LIMITS.explanationChars],
      ["metric", rec.metric, REPLY_LIMITS.metricChars],
      ["action", rec.action, REPLY_LIMITS.actionChars],
    ];

    for (const [field, text, limit] of fields) {
      if (typeof text !== "string" || text.trim() === "") {
        violations.push(`${at(field)}: empty`);
        continue;
      }
      // Generous on length: the limit is stated to the model to shape the reply,
      // and rejecting a good recommendation for one character over would be a
      // worse outcome than a slightly long card.
      if (text.length > limit * 2) violations.push(`${at(field)}: too long`);

      // Dates are removed before numbers so their components (2026, 08, 17) are
      // not re-examined as bare figures.
      const withoutDates = text.replace(/\d{4}-\d{2}-\d{2}/g, " ");
      for (const raw of withoutDates.match(/\d+(?:\.\d+)?/g) ?? []) {
        if (!numbers.has(canonical(Number(raw)))) {
          violations.push(`${at(field)}: unsupported number "${raw}"`);
        }
      }
      for (const date of text.match(/\d{4}-\d{2}-\d{2}/g) ?? []) {
        if (!dates.has(date)) violations.push(`${at(field)}: unsupported date "${date}"`);
      }

      const lower = text.toLowerCase();
      for (const term of JUDGEMENT_TERMS) {
        if (lower.includes(term)) violations.push(`${at(field)}: judgemental language "${term}"`);
      }
      for (const phrase of UNSUPPORTED_ASSERTIONS) {
        if (lower.includes(phrase)) violations.push(`${at(field)}: unsupported comparison "${phrase}"`);
      }

      // Markup is rejected rather than stripped. The UI renders text, so a tag
      // here is inert either way; its presence means the reply ignored its
      // instructions, which is reason enough not to trust the rest of it.
      if (/<[^>]+>|\[[^\]]*\]\([^)]*\)|https?:\/\//i.test(text)) {
        violations.push(`${at(field)}: markup or link`);
      }

      // Names are checked against the people the context actually contains, so a
      // confidently-invented colleague cannot reach a manager's dashboard.
      for (const candidate of text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) ?? []) {
        if (!known.some((name) => name.includes(candidate) || candidate.includes(name))) {
          violations.push(`${at(field)}: unknown name "${candidate}"`);
        }
      }
    }
  });

  return violations;
}

/**
 * Phrasings that assert the model DID something.
 *
 * A recommendation is advice. It has no capability to assign a roster,
 * deactivate an account or change a permission, and text implying otherwise
 * would misrepresent the product to the person reading it.
 */
const PERFORMED_ACTIONS = [
  "i have reassigned",
  "i reassigned",
  "has been reassigned",
  "i have deactivated",
  "has been deactivated",
  "i have removed",
  "has been removed from",
  "i have updated",
  "has been updated automatically",
  "i have assigned",
  "permissions have been",
  "i have deleted",
];

/**
 * Every id the reply may reference, with what kind of thing it is.
 *
 * Built from the same context the model was given, so this is exactly the set of
 * entities in the caller's own scope — which makes an out-of-scope id
 * unrepresentable rather than merely discouraged.
 */
function knownIds(context: InsightContext): Map<string, EntityType> {
  const ids = new Map<string, EntityType>();
  if (context.audience === "ADMIN") {
    for (const m of context.managers) {
      ids.set(m.id, "MANAGER");
      ids.set(m.universityId, "UNIVERSITY");
    }
    for (const i of context.worstInstructors) ids.set(i.id, "INSTRUCTOR");
  } else if (context.audience === "MANAGER") {
    for (const i of context.roster) ids.set(i.id, "INSTRUCTOR");
  } else {
    ids.set(context.instructorId, "INSTRUCTOR");
  }
  return ids;
}

/**
 * Proper nouns the reply is allowed to use.
 *
 * Two-word capitalised phrases that are ordinary English ("Last week", "No
 * data") would otherwise read as names, so a short allowlist of sentence
 * openers is admitted alongside the real ones.
 */
function knownNames(context: InsightContext): string[] {
  const names = ["No Data", "Last Week", "This Week", "Needs Attention"];
  if (context.audience === "ADMIN") {
    for (const m of context.managers) names.push(m.name, m.universityName);
    for (const i of context.worstInstructors) names.push(i.name);
  } else if (context.audience === "MANAGER") {
    names.push(context.managerName);
    for (const i of context.roster) names.push(i.name);
  } else {
    names.push(context.name);
  }
  return names.filter((n) => n.trim() !== "");
}

/* ── Parsing ───────────────────────────────────────────────────────────────── */

/**
 * Model output is untrusted input: shape-checked, trimmed and bounded.
 *
 * Anything structurally wrong returns null rather than being repaired. A reply
 * missing a field is not a reply with a blank field — patching it would produce
 * a recommendation nothing authored, whose other values are still unchecked.
 */
export function parseReply(text: string): AssistantReply | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const list = (raw as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(list)) return null;

  const recommendations: Recommendation[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;

    const str = (key: string) => (typeof r[key] === "string" ? (r[key] as string).trim() : null);
    const title = str("title");
    const explanation = str("explanation");
    const metric = str("metric");
    const action = str("action");
    const severity = str("severity");
    const category = str("category");
    const entityType = str("entityType");
    if (!title || !explanation || !metric || !action || !severity || !category || !entityType) {
      return null;
    }

    // `entityId` is the one nullable field, and null is meaningful — it is how a
    // platform-wide observation says it is about no single thing.
    const entityId =
      r.entityId === null || r.entityId === undefined
        ? null
        : typeof r.entityId === "string" && r.entityId.trim() !== ""
          ? r.entityId.trim()
          : null;

    recommendations.push({
      severity: severity as RecommendationSeverity,
      category: category as RecommendationCategory,
      title,
      explanation,
      metric,
      entityType: entityType as EntityType,
      entityId,
      action,
    });
  }

  // An empty list is a legitimate model answer — "nothing worth saying" — but it
  // is not something to show or to cache as an insight.
  if (recommendations.length === 0) return null;

  return { recommendations: recommendations.slice(0, REPLY_LIMITS.maxRecommendations) };
}

/* ── Cache ─────────────────────────────────────────────────────────────────── */

function contextHash(context: InsightContext): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex").slice(0, 32);
}

type Subject = {
  scope: "PLATFORM" | "UNIVERSITY" | "MANAGER" | "INSTRUCTOR";
  universityId: string | null;
  managerId: string | null;
  instructorId: string | null;
};

/**
 * Which row this reply belongs to, derived from the SESSION's scope — never
 * from anything a request supplied. A manager's brief is stored against their
 * own manager id, so one manager can never read another's cached reply.
 */
function subjectOf(scope: TenantScope): Subject {
  if (scope.kind === "self") {
    return {
      scope: "INSTRUCTOR",
      universityId: scope.universityId,
      managerId: null,
      instructorId: scope.instructorId,
    };
  }
  if (scope.kind === "university") {
    return {
      scope: "MANAGER",
      universityId: scope.universityId,
      managerId: scope.managerId ?? null,
      instructorId: null,
    };
  }
  return { scope: "PLATFORM", universityId: null, managerId: null, instructorId: null };
}

/* ── The service ───────────────────────────────────────────────────────────── */

/**
 * Produces the insight for whoever is asking.
 *
 * At most ONE provider call per invocation, and none at all when the facts are
 * unchanged from a stored reply. Callers are expected to invoke this once per
 * dashboard load — never per row, per instructor or per render.
 */
export async function assistantInsight(
  scope: TenantScope,
  opts: { refresh?: boolean } = {},
): Promise<AssistantOutcome> {
  // Checked BEFORE anything expensive. Building an admin context runs the
  // analytics engine twice for every university in the platform, and doing that
  // only to discover there is nobody to send it to is pure waste — nothing is
  // cached on this path either, so the cost would be paid again on every
  // request. `narrateCondition` guards itself the same way.
  if (!isGeminiConfigured()) return { available: false, reason: "not_configured" };

  let context: InsightContext;
  try {
    context = await buildInsightContext(scope);
  } catch (error) {
    // An empty tenant is a normal state on a new deployment, not an error to
    // show as a failure. Anything else — a forbidden or missing subject — is
    // an authorisation outcome and must keep its status.
    if (error instanceof ApiError && error.code === "NO_DATA") {
      return { available: false, reason: "no_data" };
    }
    throw error;
  }

  const subject = subjectOf(scope);
  const hash = contextHash(context);

  if (!opts.refresh) {
    const cached = await prisma.aiInsight.findFirst({
      where: {
        type: BRIEF_TYPE,
        scope: subject.scope,
        universityId: subject.universityId,
        managerId: subject.managerId,
        instructorId: subject.instructorId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    const stored = cached?.supportingData as { contextHash?: string } | null;
    if (cached && stored?.contextHash === hash) {
      const reply = parseReply(cached.summary);
      // A stored reply is re-verified rather than trusted: the rules may have
      // tightened since it was written, and a row is editable in ways a
      // response is not.
      if (reply && verifyReply(context, reply).length === 0) {
        return {
          available: true,
          cached: true,
          audience: context.audience,
          period: { from: context.period.from, to: context.period.to },
          generatedAt: cached.createdAt,
          reply,
        };
      }
    }
  }

  const outcome = await generateStructured(buildInstruction(context), {
    maxOutputTokens: MAX_REPLY_TOKENS,
  });
  if (!outcome.ok) {
    // The provider's own words are logged, never returned: they can contain a
    // request URL or key fragment.
    console.warn("[ai] assistant unavailable:", outcome.reason);
    return {
      available: false,
      reason: outcome.reason.includes("GEMINI_API_KEY") ? "not_configured" : "provider_unavailable",
    };
  }

  const reply = parseReply(outcome.text);
  if (!reply) {
    // Length and shape, never the content: the text is about real people. A
    // truncated reply and a malformed one need different fixes, and this is what
    // distinguishes them.
    console.warn(
      `[ai] assistant reply could not be parsed (${outcome.text.length} chars, ` +
        `${outcome.text.trimEnd().endsWith("}") ? "complete" : "truncated"})`,
    );
    return { available: false, reason: "unverified" };
  }

  const violations = verifyReply(context, reply);
  if (violations.length > 0) {
    // Discarded, never repaired. Rewriting one wrong number would produce a
    // sentence nothing authored, whose other clauses are still untrusted.
    console.warn("[ai] assistant reply rejected:", violations.join("; "));
    return { available: false, reason: "unverified" };
  }

  const created = await prisma.aiInsight.create({
    data: {
      ...subject,
      type: BRIEF_TYPE,
      severity: InsightSeverity.LOW,
      // The most severe recommendation names the row, so import history and any
      // future insight list read sensibly without a separate headline field.
      title: reply.recommendations[0]!.title,
      // The reply is stored as it was verified, so a cache hit serves exactly
      // the text that passed, not a reconstruction of it.
      summary: JSON.stringify(reply),
      recommendation: reply.recommendations.map((r) => r.action).join(" "),
      period: `${context.period.from} to ${context.period.to}`,
      periodStart: toDateOnly(context.period.from),
      periodEnd: toDateOnly(context.period.to),
      sourceMetrics: context as object,
      supportingData: { contextHash: hash, audience: context.audience },
      status: InsightStatus.NEW,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });

  return {
    available: true,
    cached: false,
    audience: context.audience,
    period: { from: context.period.from, to: context.period.to },
    generatedAt: created.createdAt,
    reply,
  };
}
