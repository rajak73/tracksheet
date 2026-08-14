import type { Metadata } from "next";
import { ButtonLink } from "@/app/_components/ui";
import {
  Band,
  CTABand,
  FeatureCard,
  SectionHeading,
} from "@/app/_components/public/marketing";

export const metadata: Metadata = {
  title: "Security | NEXTWAVE",
  description:
    "Role-based access, per-university tenant isolation, secure server-side sessions and an audit trail of meaningful changes.",
  alternates: { canonical: "/security" },
};

/**
 * NOTE FOR ANYONE EDITING THIS PAGE
 *
 * Every claim below describes a control that is actually implemented in this
 * codebase — role gating in the route wrapper, server-derived tenant scope,
 * scrypt-hashed credentials with server-side sessions, and the audit log.
 *
 * Do NOT add SOC 2, ISO 27001, HIPAA, GDPR or FERPA badges here. NEXTWAVE
 * holds no such certifications, and a compliance claim a buyer's procurement
 * team can disprove in one email is worse than having no badge at all.
 */
export default function SecurityPage() {
  return (
    <>
      <Band tone="surface">
        <SectionHeading
          as="h1"
          eyebrow="Security"
          title="Security you can trust."
          lede="Universities are handing over data about their staff. These are the controls that data sits behind — described as they are actually built, not as a badge wall."
        />
      </Band>

      <Band tone="canvas">
        <SectionHeading title="Access controls." />
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard title="Role-based access">
            Administrator, manager and instructor are distinct roles with distinct permissions.
            Every request is checked against the role on the server before a handler runs.
          </FeatureCard>
          <FeatureCard title="Tenant isolation">
            A request&rsquo;s university is derived from the authenticated session on the server — never
            read from the browser. A manager cannot reach another institution&rsquo;s data by changing
            an identifier.
          </FeatureCard>
          <FeatureCard title="Scoped instructor data">
            Instructors are scoped to their own records. Colleague-level data is withheld even
            within the same university, because same-tenant does not mean same-permission.
          </FeatureCard>
          <FeatureCard title="Secure authentication">
            Credentials are hashed with scrypt. Sessions are stored server-side and can be
            revoked, so signing out invalidates the session rather than only clearing a cookie.
          </FeatureCard>
          <FeatureCard title="Audit trail">
            Configuration changes, workforce provisioning, scheduling and report exports are
            recorded with the acting user and timestamp, readable per university.
          </FeatureCard>
          <FeatureCard title="One authorization path">
            Authorization is enforced in a single shared wrapper rather than re-implemented per
            endpoint — the pattern that makes a gap in one route unlikely.
          </FeatureCard>
        </div>
      </Band>

      <Band tone="surface">
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            eyebrow="Certifications"
            title="What we don't claim."
            lede="NEXTWAVE does not currently hold SOC 2, ISO 27001, HIPAA, GDPR or FERPA certification, and this page will not display badges for them."
          />
          <p className="mt-6 text-base leading-relaxed text-muted">
            If your procurement process requires a specific certification or a completed security
            questionnaire, contact us and we will tell you plainly where things stand rather than
            implying coverage that does not exist.
          </p>
          <div className="mt-8">
            <ButtonLink href="/contact" variant="secondary">
              Contact us about security →
            </ButtonLink>
          </div>
        </div>
      </Band>

      <CTABand
        title="Questions about how your data is handled?"
        lede="We're happy to walk through the access model and answer security questionnaires directly."
      >
        <ButtonLink href="/contact">Contact NEXTWAVE</ButtonLink>
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
