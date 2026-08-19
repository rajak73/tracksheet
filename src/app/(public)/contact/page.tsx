import type { Metadata } from "next";
import Link from "next/link";
import { Band, SectionHeading } from "@/app/_components/public/marketing";
import { DemoRequestForm } from "@/app/_components/public/DemoRequestForm";

export const metadata: Metadata = {
  title: "Request access | NIAT",
  description:
    "Request access to the NIAT academic workforce platform, or ask the team how a figure on it is worked out.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <Band tone="surface">
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <SectionHeading
            as="h1"
            eyebrow="Request access"
            title="Get access to the platform."
            lede="Tell us which university you teach or manage at and what you need to see. The NIAT team will set up your access — or answer the question directly, if that is faster."
          />

          <dl className="mt-10 space-y-6">
            {[
              [
                "Access is scoped to your role",
                "An instructor records their own day; a manager reads their roster. Say which you are.",
              ],
              [
                "One university at a time",
                "Access is granted against a specific university, so name the campus you work at.",
              ],
              [
                "Straight answers on security",
                "Including what we don't yet certify — see the",
              ],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="text-sm font-semibold text-content">{term}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted">
                  {detail}
                  {term === "Straight answers on security" ? (
                    <>
                      {" "}
                      <Link
                        href="/security"
                        className="rounded-control font-medium text-primary hover:underline"
                      >
                        security page
                      </Link>
                      .
                    </>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="lg:col-span-7">
          <DemoRequestForm />
        </div>
      </div>
    </Band>
  );
}
