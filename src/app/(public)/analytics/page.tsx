import type { Metadata } from "next";
import { ButtonLink } from "@/app/_components/ui";
import { AdminPreview, ManagerPreview } from "@/app/_components/public/DashboardPreview";
import {
  Band,
  BrowserFrame,
  CTABand,
  FeatureCard,
  IllustrativeNote,
  SectionHeading,
} from "@/app/_components/public/marketing";
import { WorkloadVisualization } from "@/app/_components/public/sections";

export const metadata: Metadata = {
  title: "Analytics | NIAT",
  description:
    "Utilization, workload distribution, compliance and capacity trends calculated by one engine, so dashboards and reports never disagree.",
  alternates: { canonical: "/analytics" },
};

export default function AnalyticsPage() {
  return (
    <>
      <Band tone="surface">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              as="h1"
              eyebrow="Analytics"
              title="Real-time analytics you can rely on."
              lede="Utilization, workload distribution, compliance and capacity — calculated once, by one engine, so a dashboard and the report behind it can never disagree."
            />
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/contact">Request access</ButtonLink>
              <ButtonLink href="/platform" variant="secondary">
                Explore Platform →
              </ButtonLink>
            </div>
          </div>
          <div className="lg:col-span-7">
            <BrowserFrame label="NIAT — Network utilization">
              <AdminPreview />
            </BrowserFrame>
            <IllustrativeNote />
          </div>
        </div>
      </Band>

      <Band tone="canvas">
        <SectionHeading
          eyebrow="What gets measured"
          title="The figures behind every view."
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard title="Utilization">
            Recorded work against available capacity, with bands for over-capacity, on-track and
            under-target — each paired with a word, never colour alone.
          </FeatureCard>
          <FeatureCard title="Workload distribution">
            How capacity split across teaching, learning, meetings, administrative, support and
            other work in any period.
          </FeatureCard>
          <FeatureCard title="Compliance">
            Whether the university&rsquo;s daily opening and closing were recorded, measured against
            expected working days.
          </FeatureCard>
          <FeatureCard title="Capacity">
            Available hours after non-working days, holidays, approved leave and the configured
            break are removed.
          </FeatureCard>
          <FeatureCard title="Trends">
            Any period compared against its weekday-aligned equivalent, rather than a single
            snapshot read in isolation.
          </FeatureCard>
          <FeatureCard title="Data quality">
            Working time carrying no records, surfaced as its own figure so it can be fixed
            rather than silently absorbed.
          </FeatureCard>
        </div>
      </Band>

      <Band tone="surface">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Capacity model"
              title="Three states, never conflated."
              lede="Recorded work, unutilized capacity and missing data mean different things and drive different actions."
            />
            <p className="mt-6 text-sm leading-relaxed text-muted">
              A day nobody logged is not evidence that nobody worked. Treating those as the same
              number is the fastest way to make a utilization figure unusable — so NIAT keeps
              them apart everywhere they appear, including in exports.
            </p>
          </div>
          <div className="lg:col-span-7">
            <WorkloadVisualization />
          </div>
        </div>
      </Band>

      <Band tone="canvas">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-7">
            <BrowserFrame label="NIAT — Workload overview">
              <ManagerPreview />
            </BrowserFrame>
            <IllustrativeNote />
          </div>
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Drill-down"
              title="From a network figure to a single record."
              lede="Every headline number can be followed down — network, university, instructor, day, activity — without leaving the same set of definitions behind."
            />
          </div>
        </div>
      </Band>

      <CTABand
        title="See the analytics against your operation."
        lede="We'll show how the figures are calculated and where each one can be drilled into."
      >
        <ButtonLink href="/contact">Request access</ButtonLink>
        <ButtonLink
          href="/ai-intelligence"
          variant="secondary"
          className="!border-white/25 !bg-transparent !text-white hover:!bg-white/10"
        >
          AI Intelligence →
        </ButtonLink>
      </CTABand>
    </>
  );
}
