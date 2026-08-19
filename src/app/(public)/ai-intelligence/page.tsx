import type { Metadata } from "next";
import { ButtonLink } from "@/app/_components/ui";
import { AIInsightCard } from "@/app/_components/public/AIInsightCard";
import {
  Band,
  CTABand,
  FeatureCard,
  SectionHeading,
  Step,
} from "@/app/_components/public/marketing";

export const metadata: Metadata = {
  title: "AI Intelligence | NIAT",
  description:
    "NIAT analyzes recorded workforce activity to identify workload imbalance, compliance risk, data quality issues and underused capacity — each shown with its supporting metrics.",
  alternates: { canonical: "/ai-intelligence" },
};

const FLOW = [
  { number: "01", title: "Activity data", body: "Recorded activities, schedules and deliverables." },
  { number: "02", title: "Analyze", body: "Workload, utilization and capacity are calculated." },
  { number: "03", title: "Detect", body: "Deterministic rules flag risks and anomalies." },
  { number: "04", title: "Recommend", body: "Each finding is explained with its evidence." },
  { number: "05", title: "Improve", body: "Managers act on what actually needs attention." },
];

export default function AIIntelligencePage() {
  return (
    <>
      <Band tone="surface">
        <SectionHeading
          as="h1"
          eyebrow="AI intelligence"
          title="Smarter insights. Better outcomes."
          lede="NIAT analyzes workforce activity and performance data to identify patterns, risks and opportunities that deserve attention — as an intelligence layer over your own records, not a separate source of truth."
        />
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/contact">Request access</ButtonLink>
          <ButtonLink href="/analytics" variant="secondary">
            See the analytics →
          </ButtonLink>
        </div>
      </Band>

      <Band tone="canvas">
        <SectionHeading
          eyebrow="How it reaches a conclusion"
          title="From recorded activity to a recommendation."
          lede="Detection is deterministic and rule-based. The language that explains a finding is generated; the numbers underneath it are calculated."
        />
        <div className="mt-14 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
          {FLOW.map((step) => (
            <Step key={step.number} number={step.number} title={step.title}>
              {step.body}
            </Step>
          ))}
        </div>
      </Band>

      <Band tone="surface">
        <SectionHeading
          eyebrow="What it detects"
          title="Findings that name their evidence."
          lede="Every insight carries a severity, the metrics it was derived from, and the period and institution it applies to."
        />
        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <AIInsightCard
            severity="high"
            title="Workload imbalance detected"
            summary="Teaching workload is above the configured weekly target for a second consecutive week."
            metrics={[
              { label: "Target", value: "24h" },
              { label: "Actual", value: "29.4h" },
              { label: "Variance", value: "+5.4h" },
            ]}
            scope="Northfield University · this week"
          />
          <AIInsightCard
            severity="high"
            title="Compliance risk"
            summary="Opening and closing compliance has fallen below the configured threshold."
            metrics={[
              { label: "Opening", value: "78%" },
              { label: "Closing", value: "71%" },
              { label: "Threshold", value: "90%" },
            ]}
            scope="Westbrook Institute · this period"
          />
          <AIInsightCard
            severity="medium"
            title="Data quality issue"
            summary="Working days with no recorded activity, reported separately from unused capacity."
            metrics={[
              { label: "Instructors", value: "12" },
              { label: "Days", value: "34" },
              { label: "Hours", value: "246h" },
            ]}
            scope="Network-wide · this period"
          />
          <AIInsightCard
            severity="low"
            title="Underutilized capacity"
            summary="Available capacity is consistently unused across recent weeks in one department."
            metrics={[
              { label: "Utilization", value: "54%" },
              { label: "Capacity", value: "40h" },
              { label: "Recorded", value: "21.6h" },
            ]}
            scope="Riverstone University · last 4 weeks"
          />
        </div>
      </Band>

      <Band tone="navy">
        <SectionHeading
          onNavy
          eyebrow="Trust"
          title="An intelligence layer, not an oracle."
          lede="AI is useful here only if it can be checked. These are the constraints the layer is built under."
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard onNavy title="Grounded in your records">
            Insights are derived from activity already recorded in the platform. The layer does
            not introduce facts that are not in the underlying data.
          </FeatureCard>
          <FeatureCard onNavy title="Always traceable">
            Each finding is published with the metrics it was calculated from, so it can be
            verified against the raw records behind it.
          </FeatureCard>
          <FeatureCard onNavy title="About work, not people">
            Findings describe measurements — hours, capacity, compliance — never character
            judgements about an individual.
          </FeatureCard>
          <FeatureCard onNavy title="Detection is deterministic">
            Thresholds and rules decide what is flagged. Language explains the finding; it does
            not decide it.
          </FeatureCard>
          <FeatureCard onNavy title="Missing data stays missing">
            An absence of records is reported as exactly that, never inferred into an absence of
            work.
          </FeatureCard>
          <FeatureCard onNavy title="Reviewable by design">
            Severity, period and scope are stated so a manager can decide whether a finding
            warrants action.
          </FeatureCard>
        </div>
      </Band>

      <CTABand
        title="See what NIAT would surface for you."
        lede="We'll walk through the insight layer against the operational questions your institution cares about."
      >
        <ButtonLink href="/contact">Request access</ButtonLink>
        <ButtonLink
          href="/platform"
          variant="secondary"
          className="!border-white/25 !bg-transparent !text-white hover:!bg-white/10"
        >
          Explore Platform →
        </ButtonLink>
      </CTABand>
    </>
  );
}
