"use client";

/**
 * University configuration, editable — the one role permitted to PATCH it.
 *
 * Grouped identity/hours/targets, same field-grouping rule as university
 * creation (§26). This edits an EXISTING university rather than duplicating
 * the creation form; the working-hours grid mirrors the read-only view shown
 * to managers and instructors, so all three roles see the identical shape of
 * the same configuration.
 */

import { useCallback, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  PageHeader,
  Section,
  Select,
  Skeleton,
  inputClass,
} from "@/app/_components/ui";
import { useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { formatMinuteOfDay } from "@/app/_lib/format";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type University = { id: string; name: string };
type Config = {
  timezone: string;
  openingDurationMin: number;
  closingDurationMin: number;
  workingHours: Array<{
    dayOfWeek: number;
    isWorkingDay: boolean;
    startMinute: number;
    endMinute: number;
  }>;
};

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min: number) => formatMinuteOfDay(min);

export default function AdminSettingsPage() {
  const toast = useToast();
  const [universityId, setUniversityId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    openingDurationMin: number;
    closingDurationMin: number;
    days: boolean[];
    start: string;
    end: string;
  } | null>(null);
  // Which university's config `draft` currently holds. Compared against the
  // active university below so a draft is seeded exactly once per selection
  // — without it, re-seeding on every render would silently discard edits the
  // user just made.
  const [draftFor, setDraftFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const body = await apiGet<{ universities: University[] }>(
      "/api/universities",
      "Could not load universities.",
    );
    return body.universities;
  }, []);

  const { data: universities, error: listError, loading: listLoading } = useLoad(
    load,
    "admin-settings-universities",
  );

  const activeId = universityId || universities?.[0]?.id || "";

  const configLoad = useCallback(async () => {
    if (!activeId) return null;
    const body = await apiGet<{ config: Config }>(
      `/api/universities/${activeId}/config`,
      "Could not load this university's configuration.",
    );
    return body.config;
  }, [activeId]);

  const config = useLoad(configLoad, activeId);

  // Seed the editable draft from the loaded config, exactly once per
  // university — re-running this on every render would overwrite whatever
  // the user is mid-way through typing.
  if (config.data && activeId && draftFor !== activeId) {
    const byDay = new Map(config.data.workingHours.map((h) => [h.dayOfWeek, h]));
    const anyWorking = config.data.workingHours.find((h) => h.isWorkingDay);
    setDraft({
      openingDurationMin: config.data.openingDurationMin,
      closingDurationMin: config.data.closingDurationMin,
      days: DAYS.map((_, i) => byDay.get(i)?.isWorkingDay ?? false),
      start: anyWorking ? toHHMM(anyWorking.startMinute) : "09:00",
      end: anyWorking ? toHHMM(anyWorking.endMinute) : "17:00",
    });
    setDraftFor(activeId);
  }

  async function save() {
    if (!draft || !activeId) return;
    setError(null);

    if (toMinutes(draft.end) <= toMinutes(draft.start)) {
      setError("The working day must end after it starts.");
      return;
    }
    if (!draft.days.some(Boolean)) {
      setError("Select at least one working day.");
      return;
    }

    setSaving(true);
    try {
      await apiSend(
        `/api/universities/${activeId}/config`,
        "PATCH",
        {
          openingDurationMin: Number(draft.openingDurationMin),
          closingDurationMin: Number(draft.closingDurationMin),
          workingHours: DAYS.map((_, dayOfWeek) => ({
            dayOfWeek,
            isWorkingDay: draft.days[dayOfWeek],
            startMinute: draft.days[dayOfWeek] ? toMinutes(draft.start) : 0,
            endMinute: draft.days[dayOfWeek] ? toMinutes(draft.end) : 1,
          })),
        },
        "Could not save that configuration just now.",
      );
      toast("success", "Configuration saved.");
      config.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that configuration just now.");
    } finally {
      setSaving(false);
    }
  }

  if (listLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <Card padded>
          <Skeleton className="h-40 w-full" />
        </Card>
      </div>
    );
  }
  if (listError || !universities) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <Alert tone="danger">{listError ?? "Could not load universities."}</Alert>
      </div>
    );
  }
  if (universities.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <Card padded>
          <p className="text-sm text-muted">Create a university before configuring it.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="University configuration. Changes here affect every capacity and compliance figure for that tenant."
        actions={
          <Field label="University" className="w-auto">
            <Select value={activeId} onChange={(e) => setUniversityId(e.target.value)} className="w-auto min-w-48">
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        }
      />

      {config.loading || !draft ? (
        <Card padded>
          <Skeleton className="h-40 w-full" />
        </Card>
      ) : config.error ? (
        <Alert tone="danger">{config.error}</Alert>
      ) : (
        <Section title="Working hours" description="These feed the time-calculation engine directly.">
          <Card>
            <CardHeader
              title="Weekly pattern"
              actions={<Badge tone="info">{config.data?.timezone}</Badge>}
            />
            <CardBody className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Day starts">
                  <input
                    type="time"
                    value={draft.start}
                    onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Day ends">
                  <input
                    type="time"
                    value={draft.end}
                    onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Opening (min)" hint="Once per working day.">
                  <input
                    type="number"
                    min={1}
                    value={draft.openingDurationMin}
                    onChange={(e) => setDraft({ ...draft, openingDurationMin: Number(e.target.value) })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Closing (min)" hint="Once per working day.">
                  <input
                    type="number"
                    min={1}
                    value={draft.closingDurationMin}
                    onChange={(e) => setDraft({ ...draft, closingDurationMin: Number(e.target.value) })}
                    className={inputClass}
                  />
                </Field>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-content">Working days</legend>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day, i) => (
                    <label
                      key={day}
                      className={`cursor-pointer rounded-control border px-3 py-1.5 text-sm transition-colors ${
                        draft.days[i]
                          ? "border-primary bg-primary-subtle text-primary-text"
                          : "border-line-strong text-muted hover:bg-hovered"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={draft.days[i]}
                        onChange={() =>
                          setDraft({ ...draft, days: draft.days.map((v, j) => (j === i ? !v : v)) })
                        }
                      />
                      {day.slice(0, 3)}
                    </label>
                  ))}
                </div>
              </fieldset>

              {error ? <Alert tone="danger">{error}</Alert> : null}

              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save configuration"}
              </Button>
            </CardBody>
          </Card>
        </Section>
      )}
    </div>
  );
}
