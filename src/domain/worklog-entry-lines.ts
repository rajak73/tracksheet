/**
 * Four boxes, several entries.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 * The quick-entry form asks what you produced, how many, how long, and any
 * remark — and a day is rarely one thing. Typing it four times is four trips
 * through a dialog for one afternoon's work, so the boxes take lists:
 *
 *     Deliverable       Live Class, Doubt Session, Assignment Evaluation
 *     Quantity          1, 1, 12
 *     Working Hours     2h, 45m, 1h
 *     Remarks           binary trees
 *
 * ── Working Hours decides how many entries there are ──────────────────────
 * Not the deliverable, which is the obvious choice and the wrong one.
 *
 * Deliverable is free text an instructor writes in their own words, and it
 * routinely contains commas: "lecture on trees, graphs and heaps", "doubt
 * session for section A, second years". Counting entries by splitting THAT
 * turns one activity into three, and then quietly attaches the next field's
 * values to the wrong halves — a shifted quantity that looks like a real one.
 *
 * Working Hours cannot contain a comma except as a separator. "2h", "1.5",
 * "45m", "8:30" — every form of it is one token. So it is the field that can
 * be split safely, and it is what N comes from.
 *
 * The consequence worth stating: when Working Hours holds ONE value, the whole
 * Deliverable box is ONE deliverable, commas and all. That is exactly how the
 * form behaved before it took lists, so nothing anybody types today changes
 * meaning tomorrow.
 *
 * ── Nothing is spread, and nothing is guessed ─────────────────────────────
 * With N entries, Deliverable must give N. Quantity must give N or be empty.
 * A mismatch is refused, naming both counts, because the alternative is
 * deciding on somebody's behalf which deliverable the 12 belonged to.
 *
 * Remarks is the one exception, and only in one direction: a single remark
 * applies to every entry. That invents nothing — it is the same sentence — 
 * whereas a single quantity spread across three deliverables invents two
 * counts.
 */

/** A day cannot hold more than this many entries from one submission. */
export const MAX_ENTRIES = 20;

/** What one entry will be recorded as. */
export type EntryDraft = {
  deliverable: string;
  /** `null` is the client's `?` — they did not say how many. Never 0 for that. */
  quantity: number | null;
  workingHours: number;
  remarks: string | null;
  /**
   * The Quantity box for THIS entry, exactly as typed — "2", "2 classes", "".
   *
   * Carried beside the parsed number rather than instead of it. The number is
   * what every total is summed from; this is what the person wrote, and it is
   * what the table prints. Neither is recoverable from the other: "2" and
   * "2 classes" parse identically, and printing the parse back is how an
   * instructor ends up unable to find their own words on the screen.
   */
  rawQuantity: string;
  /** The Working Hours box for this entry, exactly as typed — "6h 00m". */
  rawWorkingHours: string;
};

export type SplitResult =
  | { ok: true; entries: EntryDraft[] }
  | { ok: false; reason: string };

/**
 * Hours as somebody may type them.
 *
 * The field asks for a number, and people write time the way they say it. All
 * of these mean the same eight and a half hours: `8.5`, `8h 30m`, `8:30`,
 * `8h30`. Refusing three of the four would be pedantry — the field's job is to
 * find out how long something took.
 *
 * Minutes alone count too: `45m` is the form the client's own report prints
 * ("Doubt Clearing - 45m"), and it used to be refused, so an instructor
 * copying the wording back into the box was told it was invalid.
 */
export function parseHours(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  /* A bare number above twelve, with no unit at all.
   *
   * "45" in a box labelled Working Hours reads as forty-five hours, which is
   * longer than a day and would be refused three checks later with a message
   * about the wrong thing. Almost nobody means that; almost everybody means
   * forty-five minutes. Refused here so the message can say so. */
  const bareLarge = text.match(/^(\d+(?:\.\d+)?)$/);
  if (bareLarge && Number(bareLarge[1]) > 12) return null;

  // `45m`, `45 min`, `45 mins`, `45 minutes` — minutes with no hours.
  const minutesOnly = text.match(/^(\d+)\s*(?:m|min|mins|minute|minutes)$/);
  if (minutesOnly) {
    const m = Number(minutesOnly[1]);
    return m > 0 ? m / 60 : null;
  }

  // `8:30`, `8h 30m`, `8h30`, `8 h 30`
  const split = text.match(/^(\d+)\s*(?::|h)\s*(\d{1,2})\s*(?:m|min|mins)?$/);
  if (split) {
    const h = Number(split[1]);
    const m = Number(split[2]);
    if (m > 59) return null;
    return h + m / 60;
  }

  // `8`, `8.5`, `8h`, `8 hrs`
  const whole = text.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)?$/);
  if (whole) return Number(whole[1]);

  /* ── Time written as a sentence ──────────────────────────────────────────
   * Everything above requires the WHOLE box to be a duration and nothing else,
   * which refuses the way most people actually write one: "6 hours 30
   * minutes", "6 hours and 30 mins", "about 2 hours". Each was rejected with a
   * message telling the instructor to write it a way they had not chosen to.
   *
   * So as a last resort the units are read out of the text wherever they sit,
   * and anything around them is ignored as context. A unit is REQUIRED — this
   * never guesses that a bare number in a sentence was hours — which is what
   * keeps "2 classes" refused here rather than silently becoming two hours.
   *
   * Deliberately after the exact forms above: `8:30` and the bare-number-over-
   * twelve guard must keep answering first, or this would loosen rules they
   * exist to enforce. */
  const hourToken = text.match(/(\d+(?:\.\d+)?)\s*(?:h\b|hr|hrs|hour|hours)/);
  const minuteToken = text.match(/(\d+)\s*(?:m\b|min|mins|minute|minutes)/);
  if (hourToken || minuteToken) {
    const h = hourToken ? Number(hourToken[1]) : 0;
    const m = minuteToken ? Number(minuteToken[1]) : 0;
    if (m > 59 && hourToken) return null;
    const total = h + m / 60;
    return total > 0 ? total : null;
  }

  return null;
}

/**
 * The count inside a Quantity box that also carries context.
 *
 * "2" and "2 classes" and "2 classes taken" are all two. The box is labelled
 * Deliverable Quantity and people answer it in words, so the first whole number
 * is taken as the count and the rest is kept as the context it is — stored
 * verbatim on the row and printed unchanged in the table.
 *
 * Text with no digit at all returns null, which is the client's `?`: "some
 * classes" is an honest statement that they did not count, and refusing it
 * would only teach people to leave the box empty. Nothing is lost by being
 * lenient here — the raw words are stored either way, so the reader always
 * sees exactly what was written.
 */
function parseQuantity(raw: string): number | null {
  const found = raw.match(/\d+/);
  if (!found) return null;
  const n = Number(found[0]);
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : null;
}

/**
 * Does this reading of the box carry its own unit?
 *
 * Only asked of a COMMA-separated part, and it is what makes commas safe.
 * "2h", "45m", "8:30" and "1h 30m" each say what they are. A bare "5" or "200"
 * does not — and after a comma those are far more likely to be the second half
 * of something that was never a list:
 *
 *     1,5      one and a half hours, written the European way
 *     1,200    a quantity with a thousands separator
 *
 * Both split into two parts that both parse as durations, so counting cannot
 * catch them: they add a token at exactly the moment a deliverable's own
 * English comma adds one, the counts agree, and a day of 1h30m is recorded as
 * six hours with nothing on screen looking wrong.
 *
 * Requiring a unit after a comma refuses both and costs nothing real — nobody
 * writing a genuine list of durations writes it without units.
 */
function carriesItsOwnUnit(value: string): boolean {
  return /[a-z:]/i.test(value.trim());
}

/**
 * Splits one field into its parts.
 *
 * Newlines win wherever they appear: pressing Return is the unambiguous way to
 * say "these are separate", and it is the escape hatch for text that contains
 * commas of its own. Commas are the fallback, for the one-line case.
 */
function parts(raw: string): string[] {
  const text = raw ?? "";
  const pieces = text.includes("\n") ? text.split("\n") : text.split(",");
  return pieces.map((p) => p.trim()).filter((p) => p !== "");
}

/** `?`, `-` and an empty cell all mean "they did not say". */
const UNSTATED_MARKS = new Set(["", "?", "-", "–", "—", "na", "n/a"]);

/**
 * Turns the four boxes into the entries they describe, or explains why not.
 *
 * Every refusal names what it counted, because "3 deliverables but 2 working
 * hour values" is something an instructor can act on and "invalid input" is
 * not.
 */
export function splitEntries(input: {
  deliverable: string;
  quantity: string;
  workingHours: string;
  remarks: string;
}): SplitResult {
  const hoursHasNewline = input.workingHours.includes("\n");
  const hours = parts(input.workingHours);

  /* A comma in the hours box is only a separator when every part says what it
   * is. See `carriesItsOwnUnit` — this is the guard that stops "1,5" becoming
   * two entries. Newlines need no such guard: pressing Return is unambiguous. */
  if (!hoursHasNewline && hours.length > 1) {
    const bare = hours.find((h) => !carriesItsOwnUnit(h));
    if (bare !== undefined) {
      return {
        ok: false,
        reason:
          `"${input.workingHours.trim()}" is ambiguous — "${bare}" has no unit, so this could be ` +
          `one length of time or ${hours.length}. Write the unit on each ` +
          `("2h, 45m"), or put each entry on its own line.`,
      };
    }
  }

  if (hours.length === 0) {
    return { ok: false, reason: "Enter how long it took — 8, 8.5, 8h 30m, or 45m." };
  }
  if (hours.length > MAX_ENTRIES) {
    return { ok: false, reason: `One submission may hold at most ${MAX_ENTRIES} entries.` };
  }

  const count = hours.length;

  const parsedHours: number[] = [];
  for (const [i, value] of hours.entries()) {
    const parsed = parseHours(value);
    if (parsed === null || parsed <= 0) {
      return {
        ok: false,
        reason:
          count === 1
            ? `"${value}" is not a length of time. Try 8, 8.5, 8h 30m, or 45m` +
              (/^\d+$/.test(value) && Number(value) > 12
                ? ` — write ${value}m for ${value} minutes, or ${value}h if you really mean hours.`
                : ".")
            : `Working hours ${i + 1} of ${count} — "${value}" is not a length of time.`,
      };
    }
    if (parsed > 24) {
      return { ok: false, reason: `"${value}" is longer than a day.` };
    }
    parsedHours.push(parsed);
  }

  /* With one entry the whole box is one deliverable, commas and all — see the
   * note at the top. With several, it must say which is which. */
  const deliverables = count === 1 ? [input.deliverable.trim()] : parts(input.deliverable);
  if (deliverables.length === 0 || deliverables.some((d) => d === "")) {
    return { ok: false, reason: "Say what you worked on." };
  }
  if (deliverables.length !== count) {
    return {
      ok: false,
      reason:
        `${deliverables.length} ${deliverables.length === 1 ? "deliverable" : "deliverables"} ` +
        `but ${count} working-hour ${count === 1 ? "value" : "values"}. ` +
        "Give one of each, in the same order — put each on its own line if any of them contains a comma.",
    };
  }

  /* An empty Quantity box means nobody stated a count, for every entry. That
   * is the client's `?` and it is a real answer — not zero, which is a count. */
  const quantityParts = parts(input.quantity);
  let quantities: Array<number | null>;
  if (quantityParts.length === 0) {
    quantities = deliverables.map(() => null);
  } else if (quantityParts.length !== count) {
    return {
      ok: false,
      reason:
        `${quantityParts.length} ${quantityParts.length === 1 ? "quantity" : "quantities"} ` +
        `but ${count} ${count === 1 ? "entry" : "entries"}. ` +
        "Give one for each, in the same order, or leave the box empty and none will be assumed.",
    };
  } else {
    quantities = [];
    for (const value of quantityParts) {
      if (UNSTATED_MARKS.has(value.toLowerCase())) {
        quantities.push(null);
        continue;
      }
      /* Context is allowed and no longer a refusal — "2 classes" is two. Text
         carrying no number at all is `?`, not an error; see `parseQuantity`.
         The words are preserved on the row regardless, so nothing a person
         wrote is lost by this being lenient. */
      quantities.push(parseQuantity(value));
    }
  }

  /* ── Remarks split on NEWLINES ONLY ────────────────────────────────────
   * It is the one prose field. "binary trees, AVL rotations" and "unit 3,
   * mostly recursion" are one remark with a comma in them, not two remarks,
   * and splitting them produces two half-sentences attached to the wrong
   * entries — a mistake that reads as deliberate once it is in the column.
   *
   * Pressing Return remains the way to say "one of these each", which is what
   * the other boxes use too. Nothing is lost.
   *
   * One remark covers every entry. Spreading it invents nothing — it is the
   * same sentence — where spreading one QUANTITY across three deliverables
   * would invent two counts. */
  const remarkParts = (input.remarks ?? "")
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r !== "");
  let remarks: Array<string | null>;
  if (remarkParts.length === 0) {
    remarks = deliverables.map(() => null);
  } else if (remarkParts.length === 1) {
    remarks = deliverables.map(() => remarkParts[0]!);
  } else if (remarkParts.length !== count) {
    return {
      ok: false,
      reason:
        `${remarkParts.length} remarks but ${count} entries. Give one for each, ` +
        "one for all of them, or none.",
    };
  } else {
    remarks = remarkParts;
  }

  /* The raw boxes, aligned to the entries they produced.
   *
   * `quantityParts` is empty when the box was left blank, and one shorter than
   * `count` is impossible by the check above — so the index either hits a part
   * or the box had none, which is an empty string rather than a missing one.
   * The table prints these verbatim; nothing downstream re-parses them. */
  return {
    ok: true,
    entries: deliverables.map((deliverable, i) => ({
      deliverable,
      quantity: quantities[i]!,
      workingHours: parsedHours[i]!,
      remarks: remarks[i]!,
      rawQuantity: quantityParts[i] ?? "",
      rawWorkingHours: hours[i] ?? "",
    })),
  };
}
