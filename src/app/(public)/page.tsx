import type { Metadata } from "next";
import { ButtonLink } from "@/app/_components/ui";
import {
  IconAnalytics,
  IconInsight,
  IconUniversity,
  IconUsers,
} from "@/app/_components/icons";
import { AdminPreview } from "@/app/_components/public/DashboardPreview";
import { AIInsightCard } from "@/app/_components/public/AIInsightCard";
import { RoleSwitcher } from "@/app/_components/public/RoleSwitcher";
import {
  Band,
  BrowserFrame,
  CTABand,
  Eyebrow,
  FeatureCard,
  IllustrativeNote,
  SectionHeading,
} from "@/app/_components/public/marketing";
import {
  HowItWorks,
  OpeningClosingTimeline,
  UniversityNetwork,
  WorkloadVisualization,
} from "@/app/_components/public/sections";

export const metadata: Metadata = {
  title: "NEXTWAVE | University Workforce Intelligence Platform",
  description:
    "NEXTWAVE helps universities understand workforce workload, teaching activity, learning hours, utilization and operational performance through intelligent analytics.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "NEXTWAVE | University Workforce Intelligence Platform",
    description:
      "Understand instructor workload, teaching activity, learning hours and utilization across every university you operate.",
    type: "website",
    siteName: "NEXTWAVE",
  },
};

export default function HomePage() {
  return (
    <>
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <Band tone="surface" className="!pb-14 !pt-16 lg:!pb-20 lg:!pt-24">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <Eyebrow>University Workforce Intelligence Platform</Eyebrow>
            <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-content sm:text-5xl lg:text-6xl">
              Turn university workforce data into better decisions.
            </h1>
            <p className="mt-6 text-pretty text-lg leading-relaxed text-muted">
              NEXTWAVE gives universities a unified view of instructor workload, teaching
              activity, learning hours, utilization and operational performance — powered by
              intelligent analytics.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/contact">Request a Demo</ButtonLink>
              <ButtonLink href="/platform" variant="secondary">
                Explore Platform →
              </ButtonLink>
            </div>
          </div>

          <div className="lg:col-span-7">
            <BrowserFrame label="NEXTWAVE — Admin Overview">
              <AdminPreview />
            </BrowserFrame>
            <IllustrativeNote />
          </div>
        </div>
      </Band>

      {/* ── Capability strip ────────────────────────────────────────────── */}
      <Band tone="canvas">
        <SectionHeading
          title="Everything you need to understand your university workforce."
          align="center"
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard icon={<IconUniversity size={20} />} title="Multi-university visibility">
            Manage and understand multiple universities from one platform.
          </FeatureCard>
          <FeatureCard icon={<IconUsers size={20} />} title="Workforce intelligence">
            Understand instructor workload, capacity and performance.
          </FeatureCard>
          <FeatureCard icon={<IconInsight size={20} />} title="AI-powered insights">
            Identify risks, workload imbalance and opportunities.
          </FeatureCard>
          <FeatureCard icon={<IconAnalytics size={20} />} title="Real-time analytics">
            Turn workforce activity into actionable operational insight.
          </FeatureCard>
        </div>
      </Band>

      {/* ── One platform, every role ────────────────────────────────────── */}
      <Band tone="surface">
        <SectionHeading
          eyebrow="One platform. Every role."
          title="Built for everyone who runs the academic day."
          lede="NEXTWAVE connects administrators, university managers and instructors around the same data — each with the visibility their role requires, and no more."
        />
        <div className="mt-14">
          <RoleSwitcher />
        </div>
      </Band>

      {/* ── Workforce intelligence ──────────────────────────────────────── */}
      <Band tone="canvas">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Workforce intelligence"
              title="Know where every hour goes."
              lede="From teaching and learning to meetings and administrative work, NEXTWAVE gives organizations visibility into how workforce time is actually being used."
            />
            <p className="mt-6 text-sm leading-relaxed text-muted">
              Recorded work, unutilized capacity and missing data are reported as three separate
              things. Time with no records is never silently counted as time not worked — a
              distinction that decides whether a utilization figure can be trusted.
            </p>
          </div>
          <div className="lg:col-span-7">
            <WorkloadVisualization />
          </div>
        </div>
      </Band>

      {/* ── Opening and closing ─────────────────────────────────────────── */}
      <Band tone="surface">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Structured workday"
              title="Start aligned. End with clarity."
              lede="NEXTWAVE represents the university's own workday opening and closing periods — the short windows used to brief the team at the start of the day and review what was completed at the end."
            />
          </div>
          <div className="lg:col-span-7">
            <OpeningClosingTimeline />
          </div>
        </div>
      </Band>

      {/* ── AI intelligence ─────────────────────────────────────────────── */}
      <Band tone="navy">
        <SectionHeading
          onNavy
          eyebrow="AI intelligence"
          title="Smarter insights. Better outcomes."
          lede="NEXTWAVE analyzes workforce activity and performance data to identify patterns, risks and opportunities that deserve attention."
        />
        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <AIInsightCard
            severity="high"
            title="High workload detected"
            summary="Three instructors are recording teaching hours above the configured weekly target."
            metrics={[
              { label: "Target", value: "24h" },
              { label: "Actual", value: "29.4h" },
              { label: "Variance", value: "+5.4h" },
            ]}
            scope="Northfield University"
            href="/ai-intelligence"
          />
          <AIInsightCard
            severity="medium"
            title="Data quality issue"
            summary="Twelve instructors have working days with no recorded activity in this period."
            metrics={[
              { label: "Instructors", value: "12" },
              { label: "Days", value: "34" },
              { label: "Hours", value: "246h" },
            ]}
            scope="Network-wide"
            href="/ai-intelligence"
          />
          <AIInsightCard
            severity="low"
            title="Underutilized capacity"
            summary="Available capacity is consistently unused in one department across recent weeks."
            metrics={[
              { label: "Utilization", value: "54%" },
              { label: "Capacity", value: "40h" },
              { label: "Recorded", value: "21.6h" },
            ]}
            scope="Westbrook Institute"
            href="/ai-intelligence"
          />
        </div>
        <p className="mt-8 text-sm text-sidebar-text-muted">
          Insights are derived from activity already recorded in the platform. Each one shows the
          figures behind it so it can be checked rather than taken on trust.
        </p>
      </Band>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <Band tone="canvas">
        <SectionHeading
          eyebrow="How it works"
          title="From recorded activity to operational decisions."
        />
        <div className="mt-14">
          <HowItWorks />
        </div>
      </Band>

      {/* ── Multi-university ────────────────────────────────────────────── */}
      <Band tone="surface">
        <SectionHeading
          eyebrow="Multi-university"
          title="Built for organizations managing multiple universities."
          lede="One organization, many institutions. Compare performance across the network while each university keeps its own configuration, working hours and access boundaries."
        />
        <div className="mt-14">
          <UniversityNetwork />
        </div>
      </Band>

      {/* ── Security ────────────────────────────────────────────────────── */}
      <Band tone="canvas">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Security"
              title="Security you can trust."
              lede="Access is scoped by role and by institution, and every meaningful change is recorded."
            />
            <div className="mt-8">
              <ButtonLink href="/security" variant="secondary">
                Read about security →
              </ButtonLink>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-7">
            <FeatureCard title="Role-based access">
              Administrators, managers and instructors each see only what their role permits.
            </FeatureCard>
            <FeatureCard title="Tenant isolation">
              Every request is scoped to one university on the server, never by the browser.
            </FeatureCard>
            <FeatureCard title="Secure authentication">
              Server-side sessions with hashed credentials and revocable sign-in.
            </FeatureCard>
            <FeatureCard title="Audit logs">
              Configuration and workforce changes are recorded with who made them and when.
            </FeatureCard>
          </div>
        </div>
      </Band>

      {/* ── Closing CTA ─────────────────────────────────────────────────── */}
      <CTABand
        title="See NEXTWAVE with your own workforce questions."
        lede="Walk through the platform with our team and see how it maps to how your universities actually operate."
      >
        <ButtonLink href="/contact">Request a Demo</ButtonLink>
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
