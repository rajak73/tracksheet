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

/* ── A note on the claims below ───────────────────────────────────────────
 * Everything this page states about NIAT — launched by NxtWave in 2023, the
 * 30+ collaborating universities, the ten states, the specializations, the
 * B.Tech awarded by the collaborating university alongside NIAT's own
 * certification — comes from NxtWave's published description of the program.
 * Nothing here is estimated or rounded up, and no student, placement or
 * ranking figure appears at all: those change, and a stale number on a public
 * page is worse than no number. The same rule the security page already
 * follows (§ "No invented certifications").
 */
export const metadata: Metadata = {
  title: "NIAT | Academic Workforce Platform",
  description:
    "NIAT delivers its B.Tech program with 30+ collaborating universities across ten states. This is the platform its academic day is recorded in — instructor workload, teaching hours and utilization, campus by campus.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "NIAT | Academic Workforce Platform",
    description:
      "Instructor workload, teaching activity and utilization across every university delivering the NIAT program.",
    type: "website",
    siteName: "NIAT",
  },
};

export default function HomePage() {
  return (
    <>
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <Band tone="surface" className="!pb-14 !pt-16 lg:!pb-20 lg:!pt-24">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <Eyebrow>Academic Workforce Platform</Eyebrow>
            <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-content sm:text-5xl lg:text-6xl">
              Every teaching hour, across every campus.
            </h1>
            <p className="mt-6 text-pretty text-lg leading-relaxed text-muted">
              NIAT delivers its program with more than thirty collaborating universities. This
              is where the academic day is recorded — what instructors taught, how long it
              took, and where the capacity actually went.
            </p>
            {/* The primary action is signing in, not requesting a demo: this is
                NIAT's own platform for its own faculty, not something being sold
                to them. */}
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/login">Sign in</ButtonLink>
              <ButtonLink href="/platform" variant="secondary">
                Explore the platform →
              </ButtonLink>
            </div>
          </div>

          <div className="lg:col-span-7">
            <BrowserFrame label="NIAT — Admin Overview">
              <AdminPreview />
            </BrowserFrame>
            <IllustrativeNote />
          </div>
        </div>
      </Band>

      {/* ── About ───────────────────────────────────────────────────────── */}
      <Band tone="canvas">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <SectionHeading
              eyebrow="About NIAT"
              title="An institute that runs inside universities."
              lede="NIAT was launched by NxtWave in 2023 to close the distance between a computer science degree and the work the industry actually hires for."
            />
            <p className="mt-6 text-sm leading-relaxed text-muted">
              Its program is delivered in collaboration with more than thirty universities across
              ten states. A student finishes with two things: the UGC-recognized B.Tech in
              Computer Science awarded by their university, and NIAT&apos;s own industry
              certification in AI &amp; Machine Learning, Data Science or Cyber Security.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              That structure is exactly why this platform exists. The teaching happens on many
              campuses, under many universities, but the program is one program — and it can
              only be understood if every campus records the day the same way.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:col-span-6">
            {[
              ["30+", "Collaborating universities"],
              ["10", "States across India"],
              ["3", "Specialization tracks"],
              ["2023", "Launched by NxtWave"],
            ].map(([figure, label]) => (
              <div key={label} className="bg-surface px-6 py-7">
                <dt className="tabular text-3xl font-semibold tracking-tight text-content">
                  {figure}
                </dt>
                <dd className="mt-1.5 text-sm leading-snug text-muted">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Band>

      {/* ── Capability strip ────────────────────────────────────────────── */}
      <Band tone="surface">
        <SectionHeading
          title="Everything NIAT needs to see the academic day."
          align="center"
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard icon={<IconUniversity size={20} />} title="Every collaborating university">
            One view across the network, each university keeping its own configuration.
          </FeatureCard>
          <FeatureCard icon={<IconUsers size={20} />} title="Workforce intelligence">
            Understand instructor workload, capacity and where the hours go.
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
      <Band tone="canvas">
        <SectionHeading
          eyebrow="One platform. Every role."
          title="Built for everyone who runs the academic day."
          lede="NIAT connects administrators, university managers and instructors around the same record — each with the visibility their role requires, and no more."
        />
        <div className="mt-14">
          <RoleSwitcher />
        </div>
      </Band>

      {/* ── Workforce intelligence ──────────────────────────────────────── */}
      <Band tone="surface">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Workforce intelligence"
              title="Know where every hour goes."
              lede="From lectures and practice sessions to meetings and administrative work, NIAT sees how the teaching day is actually spent — on every campus, in the same terms."
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
      <Band tone="canvas">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Structured workday"
              title="Start aligned. End with clarity."
              lede="NIAT represents each university's own workday opening and closing periods — the short windows used to brief the team at the start of the day and review what was completed at the end."
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
          lede="NIAT analyzes recorded teaching activity to identify patterns, risks and opportunities that deserve attention."
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
      <Band tone="surface">
        <SectionHeading
          eyebrow="How it works"
          title="From recorded activity to operational decisions."
        />
        <div className="mt-14">
          <HowItWorks />
        </div>
      </Band>

      {/* ── Multi-university ────────────────────────────────────────────── */}
      <Band tone="canvas">
        <SectionHeading
          eyebrow="Multi-university"
          title="One institute. More than thirty universities."
          lede="The program is delivered inside each collaborating university, so compare across the network while every university keeps its own configuration, working hours and access boundaries."
        />
        <div className="mt-14">
          <UniversityNetwork />
        </div>
      </Band>

      {/* ── Security ────────────────────────────────────────────────────── */}
      <Band tone="surface">
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
        title="See the academic day as it actually happened."
        lede="Sign in to your campus, or talk to the NIAT team if you need access."
      >
        <ButtonLink href="/login">Sign in</ButtonLink>
        <ButtonLink
          href="/contact"
          variant="secondary"
          className="!border-white/25 !bg-transparent !text-white hover:!bg-white/10"
        >
          Contact the NIAT team →
        </ButtonLink>
      </CTABand>
    </>
  );
}
