import type { Metadata } from "next";
import { AdminPreview } from "@/app/_components/public/DashboardPreview";
import { SolutionPage, type SolutionContent } from "@/app/_components/public/SolutionPage";

export const metadata: Metadata = {
  title: "For Universities | NEXTWAVE",
  description:
    "Monitor universities, managers, instructors and operational performance across your whole network from one centralized view.",
  alternates: { canonical: "/solutions/universities" },
};

const CONTENT: SolutionContent = {
  eyebrow: "For universities",
  title: "See the bigger picture.",
  lede: "Monitor universities, managers, instructors and operational performance from one centralized command center — with each institution keeping its own configuration.",
  preview: AdminPreview,
  previewLabel: "NEXTWAVE — Admin Overview",
  capabilities: [
    "Multi-university visibility from one platform",
    "Compare utilization and compliance across institutions",
    "Instructor workforce analytics network-wide",
    "Compliance monitoring per university",
    "AI insights and operational alerts",
    "Reports and CSV exports",
  ],
  questions: [
    {
      title: "Which universities need attention?",
      body: "Compare utilization, compliance and recorded workload side by side, and drill into any institution from the same view.",
    },
    {
      title: "How is capacity being used?",
      body: "See how the network's available hours split across teaching, learning, meetings, administrative and support work.",
    },
    {
      title: "Where is data missing?",
      body: "Working time with no records is reported separately from unused capacity, so utilization figures stay honest.",
    },
    {
      title: "Who manages each institution?",
      body: "Every university has one manager and its own instructors, with access scoped accordingly.",
    },
    {
      title: "What changed, and who changed it?",
      body: "Configuration and workforce changes are recorded in a per-university audit trail.",
    },
    {
      title: "How do we compare over time?",
      body: "Track utilization and compliance trends across periods rather than a single snapshot.",
    },
  ],
  insight: {
    severity: "high",
    title: "Compliance risk across two universities",
    summary:
      "Opening and closing compliance has fallen below the configured threshold at two institutions in this period.",
    metrics: [
      { label: "Universities", value: "2" },
      { label: "Compliance", value: "78%" },
      { label: "Threshold", value: "90%" },
    ],
    scope: "Network-wide · this period",
  },
};

export default function UniversitiesSolutionPage() {
  return <SolutionPage content={CONTENT} />;
}
