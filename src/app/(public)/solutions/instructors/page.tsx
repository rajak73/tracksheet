import type { Metadata } from "next";
import { InstructorPreview } from "@/app/_components/public/DashboardPreview";
import { SolutionPage, type SolutionContent } from "@/app/_components/public/SolutionPage";

export const metadata: Metadata = {
  title: "For Instructors | NEXTWAVE",
  description:
    "Track your schedule, teaching, learning, activities and daily responsibilities from one place.",
  alternates: { canonical: "/solutions/instructors" },
};

const CONTENT: SolutionContent = {
  eyebrow: "For instructors",
  title: "Your day. Your workload. One clear view.",
  lede: "Track your schedule, teaching, learning, activities and daily responsibilities from one place — and see where the working day currently stands.",
  preview: InstructorPreview,
  previewLabel: "NEXTWAVE — Instructor Today",
  capabilities: [
    "Today's schedule and timeline",
    "Daily opening and closing for the university workday",
    "Teaching and learning hours",
    "Activity recording in a few taps",
    "Assigned deliverables and progress",
    "Personal workload trends",
  ],
  questions: [
    {
      title: "What is happening next?",
      body: "The day opens on the current and next activity, so the answer is available without navigating anywhere.",
    },
    {
      title: "What have I recorded today?",
      body: "Recorded hours, available capacity and anything still outstanding, summarised for the current day.",
    },
    {
      title: "When does the workday start and end?",
      body: "Opening and closing are the university's own once-daily windows, shown at the top and bottom of the day.",
    },
    {
      title: "How much have I taught and learned?",
      body: "Teaching and learning hours are tracked separately, both against the period you choose.",
    },
    {
      title: "What is due?",
      body: "Assigned deliverables show their target, progress and due date in one list.",
    },
    {
      title: "Is my own data complete?",
      body: "Days with no records are flagged as missing data so they can be filled in rather than counting against you.",
    },
  ],
  insight: {
    severity: "low",
    title: "Learning activity below target",
    summary:
      "Recorded professional development is under the configured weekly target for this period.",
    metrics: [
      { label: "Target", value: "6h" },
      { label: "Recorded", value: "1.5h" },
      { label: "Variance", value: "−4.5h" },
    ],
    scope: "Personal · this week",
  },
};

export default function InstructorsSolutionPage() {
  return <SolutionPage content={CONTENT} />;
}
