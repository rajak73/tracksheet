/**
 * Telling somebody something went wrong, or that there is nothing here.
 *
 * Part of the shared UI primitives — see `ui/index.ts`.
 */

import { Button } from "@/app/_components/ui/buttons";
import { Card } from "@/app/_components/ui/surfaces";

import type { ReactNode } from "react";
import {
  IconAlert,
  IconCheck,
  IconEmpty,
  IconInfo,
} from "@/app/_components/icons";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Feedback ──────────────────────────────────────────────────────────── */

const ALERT_ICON = {
  danger: IconAlert,
  warning: IconAlert,
  success: IconCheck,
  info: IconInfo,
} as const;

export function Alert({
  tone = "danger",
  title,
  children,
  actions,
}: {
  tone?: "danger" | "warning" | "success" | "info";
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const tones = {
    danger: "border-danger/30 bg-danger-subtle text-danger-text",
    warning: "border-warning/30 bg-warning-subtle text-warning-text",
    success: "border-success/30 bg-success-subtle text-success-text",
    info: "border-info/30 bg-info-subtle text-info-text",
  } as const;
  const Glyph = ALERT_ICON[tone];

  return (
    <div
      className={cx("flex gap-3 rounded-control border px-4 py-3 text-sm", tones[tone])}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Glyph size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

/**
 * An empty list is a normal state, not a failure. Each one says what is
 * missing and, where there is one, offers the action that fills it — so a
 * fresh university reads as "ready to set up" rather than "broken" (§29).
 */
export function EmptyState({
  title,
  description,
  action,
  icon = true,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: boolean;
}) {
  return (
    <div className="px-5 py-12 text-center">
      {icon ? (
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-card bg-sunken text-subtle">
          <IconEmpty size={20} />
        </div>
      ) : null}
      <p className="text-sm font-medium text-content">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * A failure the user can act on.
 *
 * The message is written for a university administrator, not for whoever reads
 * the logs. Status codes and stack traces stay out of it (§31, §49); `detail`
 * exists for the rare case where the SERVER's own reason is genuinely
 * actionable ("endTime must be after startTime").
 */
export function ErrorState({
  message,
  detail,
  onRetry,
}: {
  message: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <Card padded>
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0 text-danger">
          <IconAlert size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-content">{message}</p>
          <p className="mt-1 text-sm text-muted">
            {detail ?? "Something went wrong while retrieving this information."}
          </p>
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
