"use client";

import { useCallback, useEffect, useState } from "react";

type Deliverable = {
  id: string;
  title: string;
  targetQuantity: number;
  targetHours: number;
  dueDate: string;
  status: string;
};

type DayBreakdown = {
  date: string;
  isWorkingDay: boolean;
  nonWorkingReason: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number | null;
  hasData: boolean;
  openingLogged: boolean;
  closingLogged: boolean;
};

type Personal = {
  from: string;
  to: string;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  hoursByActivityType: Record<string, number>;
  days: DayBreakdown[];
};

type PersonalInsight = { type: string; severity: string; recommendation: string };

type Windows = {
  date: string;
  isWorkingDay: boolean;
  nonWorkingReason: string | null;
  opening: { startLocal: string; endLocal: string } | null;
  closing: { startLocal: string; endLocal: string } | null;
};

function Metric({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="truncate text-sm font-medium text-gray-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-gray-900 dark:text-zinc-100">
        {value === null ? (
          <span className="text-base font-normal text-gray-400">Not measurable</span>
        ) : (
          <>
            {value}
            {suffix ? <span className="ml-1 text-base font-normal text-gray-500">{suffix}</span> : null}
          </>
        )}
      </dd>
    </div>
  );
}

export default function InstructorDashboardPage() {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [personal, setPersonal] = useState<Personal | null>(null);
  const [today, setToday] = useState<Windows | null>(null);
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [insights, setInsights] = useState<PersonalInsight[]>([]);

  const load = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        setError("Your session has expired.");
        return;
      }
      const me = await meRes.json();
      const iid = me.user.instructorId as string | null;
      const uid = me.user.universityId as string;
      setInstructorId(iid);
      if (!iid) {
        setError("No instructor profile is linked to this account.");
        return;
      }

      const [dRes, aRes, iRes] = await Promise.all([
        fetch(`/api/instructors/${iid}/deliverables`),
        fetch(`/api/universities/${uid}/analytics`),
        fetch(`/api/instructors/${iid}/insights`),
      ]);

      if (dRes.ok) setDeliverables((await dRes.json()).deliverables);
      if (iRes.ok) setInsights((await iRes.json()).insights);

      if (aRes.ok) {
        const analytics = (await aRes.json()).analytics;
        const mine = analytics.instructors[0];
        if (mine) {
          setPersonal({
            from: analytics.from,
            to: analytics.to,
            capacityHours: mine.capacityHours,
            productiveHours: mine.productiveHours,
            unutilizedHours: mine.unutilizedHours,
            missingDataHours: mine.missingDataHours,
            utilizationPct: mine.utilizationPct,
            hoursByActivityType: mine.hoursByActivityType,
            days: mine.days,
          });

          const lastDay = mine.days[mine.days.length - 1];
          if (lastDay) {
            const wRes = await fetch(`/api/universities/${uid}/windows?date=${lastDay.date}`);
            if (wRes.ok) setToday((await wRes.json()).windows);
          }
        }
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data fetch. `load` only calls setState after awaiting the network,
    // so no state is set synchronously during the effect; the rule cannot see
    // through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** Records the daily opening or closing against the configured window. */
  async function logDaily(kind: "DAILY_OPENING" | "DAILY_CLOSING") {
    if (!instructorId || !today || !personal) return;
    const window = kind === "DAILY_OPENING" ? today.opening : today.closing;
    if (!window) return;

    setLogging(true);
    try {
      const toIso = (hhmm: string) => `${today.date}T${hhmm}:00`;
      await fetch(`/api/instructors/${instructorId}/activities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityTypeCode: kind,
          startTime: new Date(toIso(window.startLocal)).toISOString(),
          endTime: new Date(toIso(window.endLocal)).toISOString(),
        }),
      });
      await load();
    } finally {
      setLogging(false);
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
        <h2 className="font-semibold text-red-800 dark:text-red-300">Unable to load dashboard</h2>
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
      </div>
    );
  }

  const todayRow = personal?.days[personal.days.length - 1];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
          My Dashboard
        </h1>
        {personal ? (
          <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
            {personal.from} to {personal.to}
          </p>
        ) : null}
      </header>

      {today ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">
            {today.date}
            {!today.isWorkingDay ? (
              <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600 dark:bg-zinc-800 dark:text-zinc-400">
                {today.nonWorkingReason === "HOLIDAY" ? "Holiday" : "Non-working day"}
              </span>
            ) : null}
          </h2>

          {today.isWorkingDay && today.opening && today.closing ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => logDaily("DAILY_OPENING")}
                disabled={logging || todayRow?.openingLogged}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:bg-gray-300 disabled:text-gray-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
              >
                {todayRow?.openingLogged
                  ? `Opening recorded (${today.opening.startLocal}–${today.opening.endLocal})`
                  : `Record daily opening ${today.opening.startLocal}–${today.opening.endLocal}`}
              </button>
              <button
                onClick={() => logDaily("DAILY_CLOSING")}
                disabled={logging || todayRow?.closingLogged}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:bg-gray-300 disabled:text-gray-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
              >
                {todayRow?.closingLogged
                  ? `Closing recorded (${today.closing.startLocal}–${today.closing.endLocal})`
                  : `Record daily closing ${today.closing.startLocal}–${today.closing.endLocal}`}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
              No opening or closing is expected on a non-working day.
            </p>
          )}
        </section>
      ) : null}

      {todayRow ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Today</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-sm text-gray-500 dark:text-zinc-400">Productive</dt>
              <dd className="text-xl font-semibold text-gray-900 dark:text-zinc-100">
                {todayRow.productiveHours} hrs
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500 dark:text-zinc-400">Capacity</dt>
              <dd className="text-xl font-semibold text-gray-900 dark:text-zinc-100">
                {todayRow.capacityHours} hrs
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500 dark:text-zinc-400">Unutilized</dt>
              <dd className="text-xl font-semibold text-gray-900 dark:text-zinc-100">
                {todayRow.unutilizedHours === null ? (
                  <span className="text-base font-normal text-amber-600 dark:text-amber-400">
                    Not recorded
                  </span>
                ) : (
                  `${todayRow.unutilizedHours} hrs`
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500 dark:text-zinc-400">Opening / Closing</dt>
              <dd className="text-xl font-semibold text-gray-900 dark:text-zinc-100">
                {todayRow.openingLogged ? "✓" : "—"} / {todayRow.closingLogged ? "✓" : "—"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {personal ? (
        <>
          <dl className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Metric label="Capacity" value={personal.capacityHours} suffix="hrs" />
            <Metric label="Productive" value={personal.productiveHours} suffix="hrs" />
            <Metric label="Unutilized" value={personal.unutilizedHours} suffix="hrs" />
            <Metric label="Utilization" value={personal.utilizationPct} suffix="%" />
          </dl>

          {personal.missingDataHours > 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {personal.missingDataHours} hours of your expected working time have no activity
              recorded. This is shown as missing data, not as time you did not work.
            </p>
          ) : null}

          {Object.keys(personal.hoursByActivityType).length > 0 ? (
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">
                Hours by activity
              </h2>
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(personal.hoursByActivityType).map(([code, hrs]) => (
                  <li key={code} className="flex justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-zinc-800">
                    <span className="text-gray-600 dark:text-zinc-400">{code.replaceAll("_", " ")}</span>
                    <span className="font-medium text-gray-900 dark:text-zinc-100">{hrs}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {insights.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-gray-200 px-4 py-5 sm:px-6 dark:border-zinc-800">
            <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">
              Personal insights
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
              Derived from your own recorded activity only.
            </p>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
            {insights.map((i, idx) => (
              <li key={`${i.type}-${idx}`} className="px-4 py-4 sm:px-6">
                <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                  {i.type.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-sm text-gray-600 dark:text-zinc-400">{i.recommendation}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-gray-200 px-4 py-5 sm:px-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">My deliverables</h2>
        </div>
        {deliverables.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">
            No deliverables have been assigned to you.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
            {deliverables.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-4 sm:px-6">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{d.title}</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
                    Target {d.targetQuantity} · {d.targetHours} hrs · due{" "}
                    {new Date(d.dueDate).toISOString().slice(0, 10)}
                  </p>
                </div>
                <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
