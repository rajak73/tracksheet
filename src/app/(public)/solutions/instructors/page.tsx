import type { Metadata } from "next";
import { InstructorPreview } from "@/app/_components/public/DashboardPreview";
import { SolutionPage, type SolutionContent } from "@/app/_components/public/SolutionPage";

export const metadata: Metadata = {
  title: "For Instructors | NIAT",
  description:
    "Track your schedule, teaching, learning, activities and daily responsibilities from one place.",
  alternates: { canonical: "/solutions/instructors" },
};

/*
 * Rewritten against the product as it actually is.
 *
 * Nearly every claim here described a different application: a "today" view
 * opening on the current and next activity, daily opening and closing windows
 * at the top and bottom of the day, teaching and learning hours tracked
 * separately, a list of assigned deliverables with targets and due dates, and
 * a schedule. An instructor's navigation is four items — Work Log, Activity
 * Tracker, My Performance, Settings — and none of those screens does any of
 * that.
 *
 * Two of the claims were also contradicted by decisions taken since: Working
 * Hours is now every recorded minute rather than a teaching subset, so
 * "teaching and learning hours tracked separately" describes a rule that was
 * deliberately removed.
 *
 * What is below is what the screens do. A public page is the one surface
 * nobody signs in to check, so a stale claim can live there indefinitely.
 */
const CONTENT: SolutionContent = {
  eyebrow: "For instructors",
  title: "Write up your day in four fields.",
  lede: "Record what you delivered, how many, how long it took and anything worth noting — then see your own history day by day or week by week.",
  preview: InstructorPreview,
  previewLabel: "NIAT — Work Log History",
  capabilities: [
    "Four fields: deliverable, quantity, hours, remarks",
    "Several deliverables in one day, one per line",
    "Date Wise and Weekly views of your own history",
    "Correct or clear any day that has happened",
    "Days you missed stay visible instead of vanishing",
    "Your work in the report's own columns",
  ],
  questions: [
    {
      title: "How long does recording a day take?",
      body: "Four fields and Submit. A day with several deliverables goes in as several lines, with the hours beside each — there is no form to repeat per activity.",
    },
    {
      title: "What if I forget a day?",
      body: "Fill it in later. Any day that has already happened can be recorded or corrected; only days that have not arrived yet are refused.",
    },
    {
      title: "Can I fix what I submitted?",
      body: "Edit reopens the whole day with every line already in the boxes, and saving replaces it. Delete clears the day outright.",
    },
    {
      title: "How do I see what I have recorded?",
      body: "Date Wise lists your days newest first. Weekly accumulates the same entries into whole weeks, this week at the top, with a total underneath.",
    },
    {
      title: "Are the days I missed held against me?",
      body: "They are shown, not hidden — a day with nothing on it says so plainly, and can be filled in from the same row.",
    },
    {
      title: "Does my manager see the same thing?",
      body: "The same entries, in the same columns, on their own roster sheet. One record, read two ways — so there is nothing to reconcile.",
    },
  ],
  insight: {
    severity: "low",
    title: "Two days unrecorded this week",
    summary:
      "Both days are still open for recording — a day that has already happened can be filled in at any time.",
    metrics: [
      { label: "Recorded", value: "3 days" },
      { label: "Outstanding", value: "2 days" },
      { label: "Hours so far", value: "16h 15m" },
    ],
    scope: "Personal · this week",
  },
};

export default function InstructorsSolutionPage() {
  return <SolutionPage content={CONTENT} />;
}
