/**
 * The shared body of all three /solutions pages.
 *
 * One component rather than three near-identical pages: the roles differ in
 * content, not in structure, and three copies of this layout is exactly how
 * they would drift apart the first time one of them was edited.
 */

import { ButtonLink } from "@/app/_components/ui";
import { AIInsightCard, type InsightSeverity } from "@/app/_components/public/AIInsightCard";
import {
  Band,
  BrowserFrame,
  CTABand,
  CapabilityItem,
  FeatureCard,
  IllustrativeNote,
  SectionHeading,
} from "@/app/_components/public/marketing";

export type SolutionContent = {
  eyebrow: string;
  title: string;
  lede: string;
  preview: () => React.ReactElement;
  previewLabel: string;
  capabilities: string[];
  /** The questions this role opens the product to answer. */
  questions: Array<{ title: string; body: string }>;
  insight: {
    severity: InsightSeverity;
    title: string;
    summary: string;
    metrics: Array<{ label: string; value: string }>;
    scope: string;
  };
};

export function SolutionPage({ content }: { content: SolutionContent }) {
  const Preview = content.preview;

  return (
    <>
      <Band tone="surface">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              as="h1"
              eyebrow={content.eyebrow}
              title={content.title}
              lede={content.lede}
            />
            <ul className="mt-9 space-y-3">
              {content.capabilities.map((capability) => (
                <CapabilityItem key={capability}>{capability}</CapabilityItem>
              ))}
            </ul>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/contact">Request a Demo</ButtonLink>
              <ButtonLink href="/platform" variant="secondary">
                Explore Platform →
              </ButtonLink>
            </div>
          </div>

          <div className="lg:col-span-7">
            <BrowserFrame label={content.previewLabel}>
              <Preview />
            </BrowserFrame>
            <IllustrativeNote />
          </div>
        </div>
      </Band>

      <Band tone="canvas">
        <SectionHeading title="The questions this answers." />
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {content.questions.map((question) => (
            <FeatureCard key={question.title} title={question.title}>
              {question.body}
            </FeatureCard>
          ))}
        </div>
      </Band>

      <Band tone="surface">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="AI intelligence"
              title="Insights that show their evidence."
              lede="Every insight names the metric it came from, so it can be checked against the underlying records rather than taken on trust."
            />
            <div className="mt-8">
              <ButtonLink href="/ai-intelligence" variant="secondary">
                How the AI layer works →
              </ButtonLink>
            </div>
          </div>
          <div className="lg:col-span-7">
            <AIInsightCard {...content.insight} href="/ai-intelligence" />
          </div>
        </div>
      </Band>

      <CTABand
        title="See it against your own data."
        lede="Walk through the platform with our team using the questions your institution actually needs answered."
      >
        <ButtonLink href="/contact">Request a Demo</ButtonLink>
        <ButtonLink
          href="/login"
          variant="secondary"
          className="!border-white/25 !bg-transparent !text-white hover:!bg-white/10"
        >
          Login
        </ButtonLink>
      </CTABand>
    </>
  );
}
