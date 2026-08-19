import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/app/_components/ui";
import { IconChevronRight } from "@/app/_components/icons";
import {
  Band,
  CTABand,
  SectionHeading,
} from "@/app/_components/public/marketing";

export const metadata: Metadata = {
  title: "Resources | NIAT",
  description:
    "Understand how NIAT models the university workday, calculates utilization, and turns recorded activity into operational insight.",
  alternates: { canonical: "/resources" },
};

/**
 * A directory of what already exists, not a stub blog.
 *
 * The brief asks for Guides and Insights sections. Those articles have not
 * been written, and a grid of cards linking to empty pages is worse than an
 * honest index — so this page routes to the substantive explanations that
 * genuinely exist elsewhere on the site, and says plainly that the written
 * library is still to come.
 */

const TOPICS: Array<{ href: string; title: string; body: string }> = [
  {
    href: "/platform",
    title: "How the platform fits together",
    body: "The three roles, what each one sees, and how a university's configuration drives every calculated figure.",
  },
  {
    href: "/analytics",
    title: "How utilization is calculated",
    body: "Capacity, recorded work, unutilized time and missing data — what each means and why they are never merged.",
  },
  {
    href: "/ai-intelligence",
    title: "What the AI layer actually does",
    body: "Deterministic detection, generated explanation, and why every insight is published with its evidence.",
  },
  {
    href: "/security",
    title: "How access and isolation work",
    body: "Role gating, per-university scoping, session handling and the audit trail.",
  },
  {
    href: "/solutions/universities",
    title: "Running a network of universities",
    body: "Comparing institutions, spotting risk, and keeping each university's configuration its own.",
  },
  {
    href: "/solutions/instructors",
    title: "The instructor's working day",
    body: "Opening and closing, activity recording, deliverables and personal workload.",
  },
];

export default function ResourcesPage() {
  return (
    <>
      <Band tone="surface">
        <SectionHeading
          as="h1"
          eyebrow="Resources"
          title="Understand how NIAT works."
          lede="How the platform models the university workday, calculates workload and utilization, and turns recorded activity into something worth acting on."
        />
      </Band>

      <Band tone="canvas">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TOPICS.map((topic) => (
            <Link
              key={topic.href}
              href={topic.href}
              className="group rounded-card border border-line bg-surface p-6 transition-shadow hover:shadow-card"
            >
              <h2 className="flex items-start justify-between gap-3 text-base font-semibold text-content">
                {topic.title}
                <IconChevronRight
                  size={16}
                  className="mt-1 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5"
                />
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{topic.body}</p>
            </Link>
          ))}
        </div>

        <p className="mt-10 text-sm text-muted">
          A written library of guides and product insights is in progress. In the meantime, the
          pages above cover how the platform works in detail — or{" "}
          <Link href="/contact" className="rounded-control font-medium text-primary hover:underline">
            contact us
          </Link>{" "}
          with a specific question.
        </p>
      </Band>

      <CTABand
        title="Still have questions?"
        lede="Tell us what you're trying to understand about your workforce and we'll show you the relevant part of the platform."
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
