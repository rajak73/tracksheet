/**
 * A length of time, as somebody may type it.
 *
 * The Working Hours box is free text because people write time the way they say
 * it. All of these are the same eight and a half hours: `8.5`, `8h 30m`, `8:30`,
 * `8h30`, `8 hours 30 minutes`. Refusing four of the five would be pedantry —
 * the field's job is to find out how long the day was.
 *
 * Extracted from the old entry-line splitter, which did this alongside cutting
 * one box into several. The splitting is gone with the per-activity rows; this
 * is the part that was always about time.
 */

/**
 * Hours as a number, or `null` when the text is not a length of time.
 *
 * Returns null rather than throwing, so the caller decides what to say. A parser
 * that throws its own message ends up owning wording it cannot see in context.
 */
export function parseWorkingHours(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  /* A bare number above twelve, with no unit at all.
   *
   * "45" in a box labelled Working Hours reads as forty-five hours, which is
   * longer than a day. Almost nobody means that; almost everybody means
   * forty-five minutes. Refused here so the message can say so rather than a
   * later check complaining about the wrong thing. */
  const bare = text.match(/^(\d+(?:\.\d+)?)$/);
  if (bare && Number(bare[1]) > 12) return null;

  // `45m`, `45 min`, `45 minutes` — minutes with no hours.
  const minutesOnly = text.match(/^(\d+)\s*(?:m|min|mins|minute|minutes)$/);
  if (minutesOnly) {
    const m = Number(minutesOnly[1]);
    return m > 0 ? round(m / 60) : null;
  }

  // `8:30`, `8h 30m`, `8h30`, `8 h 30`
  const split = text.match(/^(\d+)\s*(?::|h)\s*(\d{1,2})\s*(?:m|min|mins)?$/);
  if (split) {
    const m = Number(split[2]);
    if (m > 59) return null;
    return round(Number(split[1]) + m / 60);
  }

  // `8`, `8.5`, `8h`, `8 hrs`
  const whole = text.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)?$/);
  if (whole) return round(Number(whole[1]));

  /* Time written as a sentence — "6 hours 30 minutes", "about 2 hours".
   *
   * Last, so the exact forms above keep answering first and the bare-number
   * guard is not loosened by it. A unit is REQUIRED: this never decides that a
   * bare number inside a sentence meant hours, which is what keeps "2 classes"
   * out of a field that measures time. */
  const hourToken = text.match(/(\d+(?:\.\d+)?)\s*(?:h\b|hr|hrs|hour|hours)/);
  const minuteToken = text.match(/(\d+)\s*(?:m\b|min|mins|minute|minutes)/);
  if (hourToken || minuteToken) {
    const h = hourToken ? Number(hourToken[1]) : 0;
    const m = minuteToken ? Number(minuteToken[1]) : 0;
    if (m > 59 && hourToken) return null;
    const total = h + m / 60;
    return total > 0 ? round(total) : null;
  }

  return null;
}

/** Two decimals — the precision the column stores, so the value round-trips. */
const round = (n: number) => Math.round(n * 100) / 100;
