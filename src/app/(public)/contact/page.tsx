import type { Metadata } from "next";
import Link from "next/link";
import { Band, SectionHeading } from "@/app/_components/public/marketing";
import { DemoRequestForm } from "@/app/_components/public/DemoRequestForm";

export const metadata: Metadata = {
  title: "Request a Demo | NEXTWAVE",
  description:
    "Walk through NEXTWAVE with our team and see how it maps to how your universities actually operate.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <Band tone="surface">
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <SectionHeading
            as="h1"
            eyebrow="Request a demo"
            title="See NEXTWAVE with your own questions."
            lede="Tell us how your institutions operate and what you're trying to understand about your workforce. We'll walk through the parts of the platform that answer it."
          />

          <dl className="mt-10 space-y-6">
            {[
              [
                "A working session, not a slide deck",
                "We'll use the real product and the operational questions you bring.",
              ],
              [
                "Whoever needs to be there",
                "Academic leadership, operations, and IT are all welcome on the same call.",
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
