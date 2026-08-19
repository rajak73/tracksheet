"use client";

/**
 * AI recommendations, rendered through the card the product already has.
 *
 * ── Reusing InsightCard is the point ───────────────────────────────────────
 * `InsightCard` already puts a severity badge, a title, an explanation, the
 * SUPPORTING METRIC and a recommended action into one card, with the standing
 * caveat that the text is a detection over recorded activity. That is exactly
 * what an AI recommendation is, and giving these a second card design would
 * imply they are a different kind of claim. Same component, same disclaimer, one
 * extra label saying the wording came from a model.
 *
 * ── Text, never markup ─────────────────────────────────────────────────────
 * Every string reaches the DOM as a JSX child, so React escapes it. There is no
 * `dangerouslySetInnerHTML` in this file and there must never be one: the
 * strings originate from a language model. The server already rejects replies
 * containing markup; this is the second half of that, so neither layer has to be
 * perfect alone.
 *
 * ── Links are built here, not by the model ─────────────────────────────────
 * A recommendation carries an entity TYPE and an ID, never a URL. The href is
 * derived below from the reader's own role, so a model cannot produce a link at
 * all — and an admin's link to a manager and a manager's link to an instructor
 * go to different places without the model knowing either route exists.
 *
 * ── One request per mount ──────────────────────────────────────────────────
 * Fetched once when the page loads. Refresh is a deliberate button, not a poll:
 * each refresh may cost a provider call, and the server spends one only if the
 * underlying numbers have changed.
 */

import { useCallback, useState } from "react";
import { Button, ButtonLink, Card, CardHeader, EmptyState, Section } from "@/app/_components/ui";
import { InsightCard } from "@/app/_components/interactive";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatDateShort } from "@/app/_lib/format";

type Audience = "ADMIN" | "MANAGER" | "INSTRUCTOR";

type Recommendation = {
  severity: string;
  category: string;
  title: string;
  explanation: string;
  metric: string;
  entityType: "UNIVERSITY" | "MANAGER" | "INSTRUCTOR" | "PLATFORM";
  entityId: string | null;
  action: string;
};

type Insight = {
  audience: Audience;
  period: { from: string; to: string };
  generatedAt: string;
  cached: boolean;
  recommendations: Recommendation[];
};

type Payload =
  | { available: true; insight: Insight }
  | { available: false; insight: null; reason: string; notice: string };

/**
 * Where a recommendation points, by the READER's role.
 *
 * Returning null is normal: a platform-wide observation is about no single page,
 * and an admin reading about an instructor has a list rather than a per-person
 * drill-down from here.
 */
function hrefFor(audience: Audience, rec: Recommendation): string | null {
  if (!rec.entityId) return null;
  if (audience === "ADMIN") {
    if (rec.entityType === "MANAGER") return `/admin/managers/${rec.entityId}`;
    if (rec.entityType === "UNIVERSITY") return `/admin/universities/${rec.entityId}`;
    if (rec.entityType === "INSTRUCTOR") return `/admin/instructors/${rec.entityId}`;
    return null;
  }
  if (audience === "MANAGER") {
    return rec.entityType === "INSTRUCTOR" ? `/manager/instructors/${rec.entityId}/report` : null;
  }
  return rec.entityType === "INSTRUCTOR" ? "/instructor/performance" : null;
}

const LINK_LABEL: Record<Recommendation["entityType"], string> = {
  UNIVERSITY: "View university",
  MANAGER: "View manager",
  INSTRUCTOR: "View details",
  PLATFORM: "",
};

export function AiRecommendations({ title = "AI recommendations" }: { title?: string }) {
  // Bumping this re-runs the loader, and only then is `refresh=1` sent — so a
  // remount or a route change never costs a provider call.
  const [refreshCount, setRefreshCount] = useState(0);

  const load = useCallback(
    () =>
      apiGet<Payload>(
        `/api/ai/insights${refreshCount > 0 ? "?refresh=1" : ""}`,
        "Could not load AI recommendations.",
      ),
    [refreshCount],
  );

  const { data, error, loading } = useLoad(load, `ai-recommendations:${refreshCount}`);

  const period =
    data?.available
      ? `${formatDateShort(data.insight.period.from)} – ${formatDateShort(data.insight.period.to)}`
      : null;

  return (
    <Section
      title={title}
      description={
        period
          ? `Written from your own figures for ${period}. The measured numbers on this page remain the record.`
          : "A written reading of the figures on this page, scoped to what you can see."
      }
      actions={
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={loading}
          onClick={() => setRefreshCount((n) => n + 1)}
        >
          {loading ? "Working…" : "Refresh"}
        </Button>
      }
    >
      {error ? (
        <Card>
          <p className="px-5 py-4 text-sm text-muted">
            AI recommendations could not be loaded. Everything else on this page is unaffected.
          </p>
        </Card>
      ) : null}

      {loading && !data ? (
        <Card>
          <div className="space-y-2 px-5 py-4" aria-hidden>
            <div className="h-4 w-2/3 rounded bg-sunken" />
            <div className="h-3 w-full rounded bg-sunken" />
            <div className="h-3 w-5/6 rounded bg-sunken" />
          </div>
        </Card>
      ) : null}

      {data && !data.available ? (
        <Card>
          <EmptyState title="AI recommendations unavailable" description={data.notice} />
        </Card>
      ) : null}

      {data?.available ? (
        <div className="space-y-3">
          <Card>
            <CardHeader
              title="Generated by AI from your figures"
              description={`Each card shows the metric it rests on. Check anything you act on.${
                data.insight.cached ? " Unchanged since it was last generated." : ""
              }`}
            />
          </Card>

          {data.insight.recommendations.map((rec, i) => {
            const href = hrefFor(data.insight.audience, rec);
            return (
              <InsightCard
                key={`${rec.category}-${i}`}
                insight={{
                  type: rec.category,
                  severity: rec.severity,
                  title: rec.title,
                  summary: rec.explanation,
                  recommendation: rec.action,
                  // Shown beside the wording rather than inside it: the sentence
                  // is generated, the figure is not.
                  sourceMetrics: null,
                }}
                action={
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-control bg-sunken px-3 py-1.5 text-xs text-muted">
                      {rec.metric}
                    </span>
                    {href ? (
                      <ButtonLink href={href} size="sm" variant="secondary">
                        {LINK_LABEL[rec.entityType]}
                      </ButtonLink>
                    ) : null}
                  </div>
                }
              />
            );
          })}
        </div>
      ) : null}
    </Section>
  );
}
