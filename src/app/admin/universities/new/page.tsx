"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert, Breadcrumb, Button, Card, CardBody, CardHeader, Field, IconButton,
  PageHeader, Select, inputClass,
} from "@/app/_components/ui";
import { useToast } from "@/app/_components/interactive";
import { IconClose, IconPlus } from "@/app/_components/icons";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Common zones first; any IANA name is accepted by the backend. */
const TIMEZONES = [
  "Asia/Kolkata", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Australia/Sydney", "Asia/Singapore", "UTC",
];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export default function NewUniversityPage() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    name: "", code: "", slug: "", timezone: "Asia/Kolkata",
    openingDurationMin: 15, closingDurationMin: 15, breakDurationMin: 60,
    start: "09:00", end: "18:00",
    country: "", contactEmail: "",
  });
  const [workingDays, setWorkingDays] = useState<boolean[]>([false, true, true, true, true, true, false]);
  const [holidays, setHolidays] = useState<Array<{ date: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (toMinutes(form.end) <= toMinutes(form.start)) {
      setError("The working day must end after it starts.");
      return;
    }
    if (!workingDays.some(Boolean)) {
      setError("Select at least one working day.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/universities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: form.code.toUpperCase(),
          slug: form.slug.toLowerCase(),
          timezone: form.timezone,
          openingDurationMin: Number(form.openingDurationMin),
          closingDurationMin: Number(form.closingDurationMin),
          breakDurationMin: Number(form.breakDurationMin),
          country: form.country || undefined,
          contactEmail: form.contactEmail || undefined,
          workingHours: DAYS.map((_, dayOfWeek) => ({
            dayOfWeek,
            isWorkingDay: workingDays[dayOfWeek],
            // Non-working days still need a well-formed window for the
            // database CHECK; isWorkingDay is what actually counts.
            startMinute: workingDays[dayOfWeek] ? toMinutes(form.start) : 0,
            endMinute: workingDays[dayOfWeek] ? toMinutes(form.end) : 1,
          })),
          holidays: holidays.filter((h) => h.date && h.name),
        }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // Surface the server's own reason — "code already exists" is useful,
        // "failed" is not.
        setError(body?.error?.message ?? `Could not create university (HTTP ${res.status})`);
        return;
      }
      toast("success", `${form.name} created.`);
      router.push(`/admin/universities/${body.university.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create a university"
        description="Working hours drive every opening/closing window and capacity figure, so they are set here rather than defaulted."
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Universities", href: "/admin/universities" }, { label: "New" }]}
          />
        }
      />

      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader title="Identity" description="How this university is named and referenced." />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name" className="lg:col-span-2" required>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Code" hint="Shown in exports, e.g. UNIV003." required>
              <input required placeholder="UNIV003" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Slug" hint="Lowercase, used in URLs." required>
              <input required placeholder="northfield" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Country" hint="Optional.">
              <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Contact email" hint="Optional." className="lg:col-span-2">
              <input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className={inputClass} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Working hours"
            description="These feed the time-calculation engine directly — capacity, opening and closing windows all derive from them."
          />
          <CardBody className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Timezone" hint="Working days are resolved in this zone." required>
                <Select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </Select>
              </Field>
              <Field label="Day starts" required>
                <input type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Day ends" required>
                <input type="time" required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Break (min)" hint="Excluded from capacity.">
                <input type="number" min={0} value={form.breakDurationMin} onChange={(e) => setForm({ ...form, breakDurationMin: Number(e.target.value) })} className={inputClass} />
              </Field>
              <Field label="Opening (min)" hint="Once per working day.">
                <input type="number" min={1} value={form.openingDurationMin} onChange={(e) => setForm({ ...form, openingDurationMin: Number(e.target.value) })} className={inputClass} />
              </Field>
              <Field label="Closing (min)" hint="Once per working day.">
                <input type="number" min={1} value={form.closingDurationMin} onChange={(e) => setForm({ ...form, closingDurationMin: Number(e.target.value) })} className={inputClass} />
              </Field>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-content">Working days</legend>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((day, i) => (
                  <label
                    key={day}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      workingDays[i]
                        ? "border-primary bg-primary-subtle text-primary-text"
                        : "border-line-strong text-muted hover:bg-hovered"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={workingDays[i]}
                      onChange={() => setWorkingDays(workingDays.map((v, j) => (j === i ? !v : v)))}
                    />
                    {day.slice(0, 3)}
                  </label>
                ))}
              </div>
            </fieldset>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Initial holidays"
            description="Optional — holidays can also be added later from the university's configuration."
            actions={
              <Button type="button" variant="secondary" size="sm" onClick={() => setHolidays([...holidays, { date: "", name: "" }])}>
                <IconPlus size={16} />
                Add holiday
              </Button>
            }
          />
          <CardBody>
            {holidays.length === 0 ? (
              <p className="text-sm text-muted">
                No holidays added. A holiday makes an otherwise-working day non-working for this
                university only.
              </p>
            ) : (
              <div className="space-y-3">
                {holidays.map((h, i) => (
                  <div key={i} className="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="date"
                      value={h.date}
                      onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
                      className={inputClass}
                    />
                    <input
                      placeholder="Name"
                      value={h.name}
                      onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      className={inputClass}
                    />
                    <IconButton
                      type="button"
                      label="Remove holiday"
                      onClick={() => setHolidays(holidays.filter((_, j) => j !== i))}
                      className="shrink-0 border border-line-strong"
                    >
                      <IconClose size={16} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create university"}
          </Button>
          <p className="text-sm text-muted">
            You can add the primary manager immediately afterwards.
          </p>
        </div>
      </form>
    </div>
  );
}
