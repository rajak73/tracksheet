"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader,
  Skeleton,
} from "@/app/_components/ui";

type University = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  openingDurationMin: number;
  closingDurationMin: number;
  workingHours: { dayOfWeek: number; isWorkingDay: boolean; startMinute: number; endMinute: number }[];
  _count: { instructors: number; managers: number };
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default function AdminUniversitiesPage() {
  const [universities, setUniversities] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/universities");
        if (!res.ok) return setError(`Could not load universities (HTTP ${res.status})`);
        setUniversities((await res.json()).universities);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Universities" />
        {[0, 1].map((i) => <Card key={i} padded><Skeleton className="h-24 w-full" /></Card>)}
      </div>
    );
  }
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Universities"
        description="Working hours and daily opening/closing configuration per tenant."
        actions={
          <Link href="/admin/universities/new" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
            New university
          </Link>
        }
      />

      {universities.length === 0 ? (
        <Card>
          <EmptyState
            title="No universities yet"
            description="Create the first university to start tracking instructor workload."
            action={
              <Link href="/admin/universities/new" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
                Create a university
              </Link>
            }
          />
        </Card>
      ) : (
        universities.map((u) => (
          <Card key={u.id}>
            <CardHeader
              title={u.name}
              description={`${u._count.managers} manager(s) · ${u._count.instructors} instructor(s) · opening ${u.openingDurationMin} min · closing ${u.closingDurationMin} min`}
              actions={
                <Link href={`/admin/universities/${u.id}`} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-content hover:bg-hovered">
                  Open
                </Link>
              }
            />
            <CardBody>
              <div className="mb-3 flex items-center gap-2">
                <Badge tone="info">{u.timezone}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {u.workingHours.map((w) => (
                  <span
                    key={w.dayOfWeek}
                    className={`tabular rounded-md px-2 py-1 text-xs ${
                      w.isWorkingDay ? "bg-success-subtle text-success-text" : "bg-sunken text-subtle"
                    }`}
                  >
                    {DAYS[w.dayOfWeek]}
                    {w.isWorkingDay ? ` ${hhmm(w.startMinute)}–${hhmm(w.endMinute)}` : " closed"}
                  </span>
                ))}
              </div>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
