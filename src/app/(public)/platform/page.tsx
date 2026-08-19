import type { Metadata } from "next";
import { ButtonLink } from "@/app/_components/ui";
import {
  IconActivity,
  IconAnalytics,
  IconAudit,
  IconCalendar,
  IconDeliverable,
  IconInsight,
  IconUniversity,
  IconUsers,
} from "@/app/_components/icons";
import { RoleSwitcher } from "@/app/_components/public/RoleSwitcher";
import {
  Band,
  CTABand,
  FeatureCard,
  SectionHeading,
} from "@/app/_components/public/marketing";
import {
  HowItWorks,
  OpeningClosingTimeline,
  UniversityNetwork,
  WorkloadVisualization,
} from "@/app/_components/public/sections";

export const metadata: Metadata = {
  title: "Platform | NIAT",
  description:
    "One platform connecting administrators, university managers and instructors around the same workforce data — workload, utilization, deliverables and analytics.",
  alternates: { canonical: "/platform" },
};

export default function PlatformPage() {
  return (
    <>
      <Band tone="surface">
        <SectionHeading
          as="h1"
          eyebrow="Platform"
          title="One platform. Every role."
          lede="NIAT connects the complete university workforce ecosystem — administrators overseeing a network, managers running one institution, and instructors recording the work that everything else is calculated from."
        />
        <div className="mt-14">
          <RoleSwitcher />
        </div>
      </Band>

      <Band tone="canvas">
        <SectionHeading
          eyebrow="Capabilities"
          title="What the platform covers."
          lede="Each capability exists because a real operational question depends on it."
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard icon={<IconUniversity size={20} />} title="University configuration">
            Working hours, timezone, holidays and daily opening/closing windows, set per
            institution.
          </FeatureCard>
          <FeatureCard icon={<IconActivity size={20} />} title="Activity tracking">
            Teaching, learning, meetings, administrative and support work recorded against the
            working day.
          </FeatureCard>
          <FeatureCard icon={<IconCalendar size={20} />} title="Scheduling">
            Planned slots for instructors, shown alongside what was actually recorded.
          </FeatureCard>
          <FeatureCard icon={<IconDeliverable size={20} />} title="Deliverables">
            Assigned work with targets, dated progress increments and due dates.
          </FeatureCard>
          <FeatureCard icon={<IconAnalytics size={20} />} title="Workload analytics">
            Utilization, capacity, unutilized time and missing data, calculated by one engine.
          </FeatureCard>
          <FeatureCard icon={<IconUsers size={20} />} title="Workforce management">
            Managers and instructors provisioned per university with scoped access.
          </FeatureCard>
          <FeatureCard icon={<IconInsight size={20} />} title="AI insights">
            Detected risks and imbalances, each shown with the metrics behind it.
          </FeatureCard>
          <FeatureCard icon={<IconAudit size={20} />} title="Audit trail">
            A per-university record of configuration and workforce changes.
          </FeatureCard>
        </div>
      </Band>

      <Band tone="surface">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Capacity model"
              title="Know where every hour goes."
              lede="Recorded work, unutilized capacity and missing data are three different things, and NIAT reports them as three different things."
            />
            <p className="mt-6 text-sm leading-relaxed text-muted">
              Worked time is measured as the union of recorded intervals rather than the sum of
              their durations, so two overlapping activities never inflate a total. Capacity
              excludes non-working days, holidays, approved leave and the configured break.
            </p>
          </div>
          <div className="lg:col-span-7">
            <WorkloadVisualization />
          </div>
        </div>
      </Band>

      <Band tone="canvas">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Structured workday"
              title="Start aligned. End with clarity."
              lede="The university's working day is bracketed by a short opening and closing period — used to brief the team at the start and review what was completed at the end."
            />
          </div>
          <div className="lg:col-span-7">
            <OpeningClosingTimeline />
          </div>
        </div>
      </Band>

      <Band tone="surface">
        <SectionHeading eyebrow="How it works" title="From recorded activity to decisions." />
        <div className="mt-14">
          <HowItWorks />
        </div>
      </Band>

      <Band tone="canvas">
        <SectionHeading
          eyebrow="Multi-university"
          title="Built for organizations managing multiple universities."
          lede="One organization, many institutions, centralized visibility and scoped access."
        />
        <div className="mt-14">
          <UniversityNetwork />
        </div>
      </Band>

      <CTABand
        title="Ready to see the platform?"
        lede="We'll walk through the parts that matter to how your institutions operate."
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
