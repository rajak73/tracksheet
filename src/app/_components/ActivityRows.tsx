"use client";

/**
 * The entry form's activity rows.
 *
 * ── What this ends ────────────────────────────────────────────────────────
 * Two boxes joined by nothing but position. Half the days in the database show
 * what that produces: "1, 1, 12, 1, 4, 1, 1, 1, 6" beside a list of nine
 * descriptions, and one day with five descriptions against four numbers, so
 * even counting them off fails. Nobody meant to write that — the form asked
 * for it.
 *
 * A quantity now lives on the row it belongs to. The pairing is authored, so
 * nothing downstream has to guess it, and for these days the numbers are given
 * rather than extracted.
 */
import { useRef } from "react";
import { formatMinutes } from "@/app/_lib/format";

export type Row = {
  /** Stable across edits, so React does not reuse a node for a different row. */
  id: string;
  description: string;
  /** Blank stays blank — see `quantityDigits`. */
  quantity: string;
  hr: string;
  min: string;
};

export const emptyRow = (): Row => ({
  id: `r${Math.random().toString(36).slice(2, 10)}`,
  description: "",
  quantity: "",
  hr: "",
  min: "",
});

/** Digits only. Letters and decimals never reach state, so nothing to reject later. */
const digits = (v: string) => v.replace(/[^0-9]/g, "");

/** Blank Hr and Min genuinely mean no time, so zero is the right reading. */
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

/** `90` minutes is 1 hour 30 — rolled up on blur, and again on the server. */
export function rollMinutes(row: Row): Row {
  const total = num(row.hr) * 60 + num(row.min);
  return { ...row, hr: String(Math.floor(total / 60)), min: String(total % 60) };
}

export const rowMinutes = (row: Row) => num(row.hr) * 60 + num(row.min);
export const totalRowMinutes = (rows: Row[]) => rows.reduce((n, r) => n + rowMinutes(r), 0);
export const isBlank = (row: Row) =>
  row.description.trim() === "" && row.quantity === "" && row.hr === "" && row.min === "";

/** What goes on the wire. Quantity stays null when it was never counted. */
export const toSubmitted = (rows: Row[]) =>
  rows
    .filter((r) => r.description.trim() !== "" || !isBlank(r))
    .map((r) => ({
      description: r.description,
      /* Blank and zero are different facts. Blank means it was not counted — a
         meeting, a debugging session. Zero would claim zero classes happened. */
      quantity: r.quantity.trim() === "" ? null : Number(r.quantity),
      hr: num(r.hr),
      min: num(r.min),
    }));

export function ActivityRows({
  rows,
  onChange,
  invalidIds,
}: {
  rows: Row[];
  onChange: (next: Row[]) => void;
  /** Rows the server refused — numbers with nothing said about them. */
  invalidIds?: string[];
}) {
  const descRefs = useRef(new Map<string, HTMLInputElement | null>());

  const update = (id: string, patch: Partial<Row>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const focusDescription = (id: string) => {
    // After React has committed the new row, or there is nothing to focus.
    requestAnimationFrame(() => descRefs.current.get(id)?.focus());
  };

  /** Enter opens the next row. From the last one it appends; otherwise inserts. */
  const openNext = (index: number) => {
    const created = emptyRow();
    const next = [...rows];
    next.splice(index + 1, 0, created);
    onChange(next);
    focusDescription(created.id);
  };

  /**
   * A row that says nothing is removed once the cursor leaves it.
   *
   * Never the row being edited — deleting what somebody is typing in is the
   * worst thing a self-tidying list can do — and never the last one, which
   * stays as the empty row the form always shows.
   */
  const pruneOnBlur = (id: string) => {
    setTimeout(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.dataset.rowId === id) return;
      if (rows.length <= 1) return;
      const row = rows.find((r) => r.id === id);
      if (!row || !isBlank(row)) return;
      onChange(rows.filter((r) => r.id !== id));
    }, 0);
  };

  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id);
    onChange(next.length ? next : [emptyRow()]);
  };

  const cell = "border border-line bg-surface px-2 py-1.5 text-sm text-content focus:border-primary focus:outline-none";

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-xs font-medium text-muted">
              <th className="pb-1 pl-1">Description</th>
              <th className="w-24 pb-1 pl-1">Quantity</th>
              <th className="w-16 pb-1 pl-1">Hr</th>
              <th className="w-16 pb-1 pl-1">Min</th>
              <th className="w-8 pb-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const invalid = invalidIds?.includes(row.id);
              return (
                <tr key={row.id}>
                  <td className="p-0.5">
                    <input
                      ref={(el) => {
                        descRefs.current.set(row.id, el);
                      }}
                      data-row-id={row.id}
                      value={row.description}
                      onChange={(e) => update(row.id, { description: e.target.value })}
                      onBlur={() => pruneOnBlur(row.id)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        openNext(i);
                      }}
                      placeholder="Live class on binary search"
                      className={`w-full rounded-control ${cell} ${invalid ? "border-danger" : ""}`}
                    />
                  </td>
                  <td className="p-0.5">
                    <input
                      inputMode="numeric"
                      data-row-id={row.id}
                      value={row.quantity}
                      onChange={(e) => update(row.id, { quantity: digits(e.target.value) })}
                      onBlur={() => pruneOnBlur(row.id)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        if (i === rows.length - 1) openNext(i);
                        else focusDescription(rows[i + 1]!.id);
                      }}
                      className={`w-full rounded-control text-right ${cell}`}
                    />
                  </td>
                  {(["hr", "min"] as const).map((field) => (
                    <td key={field} className="p-0.5">
                      <input
                        inputMode="numeric"
                        data-row-id={row.id}
                        value={row[field]}
                        onChange={(e) => update(row.id, { [field]: digits(e.target.value) })}
                        onBlur={() => {
                          // Blank becomes 0, and 90 minutes becomes 1h 30m.
                          const rolled = rollMinutes(rows.find((r) => r.id === row.id) ?? row);
                          if (!isBlank(row)) update(row.id, { hr: rolled.hr, min: rolled.min });
                          pruneOnBlur(row.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          if (i === rows.length - 1) openNext(i);
                          else focusDescription(rows[i + 1]!.id);
                        }}
                        className={`w-full rounded-control text-right ${cell}`}
                      />
                    </td>
                  ))}
                  <td className="p-0.5 text-center">
                    <button
                      type="button"
                      onClick={() => remove(row.id)}
                      aria-label={`Remove row ${i + 1}`}
                      className="px-1 text-sm text-subtle hover:text-danger-text"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Calculated, and never sent. The server recomputes it from the rows, so
          a payload claiming a total the rows do not support cannot set one. */}
      <div className="flex items-baseline justify-between border-t border-line-subtle pt-2">
        <span className="text-sm font-semibold text-content">Working Hours</span>
        <span className="tabular text-sm text-content">
          {formatMinutes(totalRowMinutes(rows))}
          <span className="ml-2 text-xs text-muted">calculated</span>
        </span>
      </div>
    </div>
  );
}
