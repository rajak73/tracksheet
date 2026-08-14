"use client";

/**
 * The manager's account and university configuration, read-only.
 *
 * Working hours are set by an administrator, not a manager — the config PATCH
 * route is admin-only server-side. Rather than build controls that would 403
 * on submit, this page shows the configuration and says plainly who can
 * change it, which is the honest reading of the authorization rule (§39: this
 * pass does not change authorization).
 */

import { useCallback } from "react";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
} from "@/app/_components/ui";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatMinuteOfDay } from "@/app/_lib/format";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

export default function ManagerSettingsPage() {
  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) throw new Error("No university is linked to this account.");
    const config = await apiGet<{ config: Config }>(
      `/api/universities/${me.user.universityId}/config`,
      "Could not load your university's configuration.",
    );
    return { user: me.user, config: config.config };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "manager-settings");

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <Card padded>
          <Skeleton className="h-24 w-full" />
        </Card>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <ErrorState message="Unable to load settings" detail={error ?? undefined} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Your account and your university's configuration." />

      <Card>
        <CardHeader title="Account" />
        <CardBody>
          <DescriptionList
            items={[
              { label: "Name", value: data.user.name },
              { label: "Email", value: data.user.email },
              { label: "Role", value: "Manager" },
            ]}
          />
        </CardBody>
      </Card>

      <Section
        title="University configuration"
        description="Set by your platform administrator. Contact them to request a change."
      >
        <Card>
          <CardHeader
            title="Working hours"
            actions={<Badge tone="info">{data.config.timezone}</Badge>}
          />
          <CardBody>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[...data.config.workingHours]
                .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                .map((h) => (
                  <li
                    key={h.dayOfWeek}
                    className="flex items-center justify-between rounded-control bg-sunken px-3 py-2 text-sm"
                  >
                    <span className="text-muted">{DAYS[h.dayOfWeek]}</span>
                    <span className={h.isWorkingDay ? "tabular text-content" : "text-subtle"}>
                      {h.isWorkingDay
                        ? `${formatMinuteOfDay(h.startMinute)}–${formatMinuteOfDay(h.endMinute)}`
                        : "Closed"}
                    </span>
                  </li>
                ))}
            </ul>
            <p className="mt-4 text-sm text-muted">
              Daily opening takes {data.config.openingDurationMin} minutes and closing{" "}
              {data.config.closingDurationMin} minutes, both counted as capacity.
            </p>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
