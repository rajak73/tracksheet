import type { Metadata } from "next";
import { ManagerPreview } from "@/app/_components/public/DashboardPreview";
import { SolutionPage, type SolutionContent } from "@/app/_components/public/SolutionPage";

export const metadata: Metadata = {
  title: "For Managers | NEXTWAVE",
  description:
    "Understand instructor workload, schedules, deliverables and operational risks inside your university.",
  alternates: { canonical: "/solutions/managers" },
};

const CONTENT: SolutionContent = {
  eyebrow: "For managers",
  title: "Turn workforce data into action.",
  lede: "Understand instructor workload, schedules, deliverables and operational risks inside your university — and see who needs attention first.",
  preview: ManagerPreview,
  previewLabel: "NEXTWAVE — Manager Dashboard",
  capabilities: [
    "Workforce visibility across your university",
    "Instructor workload and utilization",
    "Schedule planning and monitoring",
    "Deliverable assignment and progress",
    "Analytics and period comparison",
    "AI recommendations with supporting figures",
  ],
  questions: [
    {
      title: "Who needs attention this week?",
      body: "Instructors are ranked by utilization so the people furthest from target surface first, not alphabetically.",
    },
    {
      title: "Is anyone over capacity?",
      body: "Recorded work is compared against configured capacity, with overload and underuse flagged distinctly.",
    },
    {
      title: "What was planned versus recorded?",
      body: "Scheduled slots sit alongside what was actually logged, so gaps are visible rather than inferred.",
    },
    {
      title: "Are deliverables on track?",
      body: "Progress is recorded as dated increments against a target, so any period can be reconstructed.",
    },
    {
      title: "Which days have no records?",
      body: "Missing activity data is reported as its own category, never folded into unused capacity.",
    },
    {
      title: "How is the university trending?",
      body: "Compare this period against the equivalent prior one rather than reading a single number.",
    },
  ],
  insight: {
    severity: "high",
    title: "Workload imbalance detected",
    summary:
      "Teaching workload is above the configured weekly target for three instructors, for a second consecutive week.",
    metrics: [
      { label: "Target", value: "24h" },
      { label: "Actual", value: "29.4h" },
      { label: "Variance", value: "+5.4h" },
    ],
    scope: "Northfield University · this week",
  },
};

export default function ManagersSolutionPage() {
  return <SolutionPage content={CONTENT} />;
}
