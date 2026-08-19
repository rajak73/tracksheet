import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The one deliberate typographic departure from Geist-everywhere (see
 * DESIGN.md). Used ONLY for the wordmark and page titles via the `font-display`
 * utility — never for body copy, table text, or figures, which stay on Geist's
 * tabular numerals. A serif restricted to that one role is what keeps NIAT
 * from reading as another Geist-and-indigo Tailwind dashboard without
 * introducing a second voice into the data itself.
 */
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "NIAT — University Workforce Intelligence",
  description:
    "Instructor workload, utilisation and deliverable tracking across universities.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
