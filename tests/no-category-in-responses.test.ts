import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { daysAgo, seedDays } from "./helpers/worklog";
import {
  ACTIVITY_TYPE_CODES,
  DELIVERABLE_TYPES,
} from "../prisma/reference-data";

/**
 * The categorisation layer is gone from what the product SAYS, not only from
 * what it stores.
 *
 * ── Why a scan rather than a set of assertions ────────────────────────────
 * "No API response contains a category field" is not a claim any single test
 * makes. It is a claim about every response, and the way it fails is that one
 * endpoint nobody thought about keeps returning `broadCategory` long after the
 * column was supposed to be gone. So this walks the responses the read path
 * actually produces and looks for three things in all of them:
 *
 *   a category FIELD          — `broadCategory`, `deliverableType`, …
 *   a fixed category NAME     — "Live Class", "TECH", "ASSIGNMENT_EVALUATION"
 *   an evaluative FLAG        — `severity`, `band`, `risk`, `LOW`/`CRITICAL`
 *
 * The third is the one worth stating twice. A day is not graded. There is no
 * field that says a day was good, and a response that carries one has decided
 * something about a person that nobody asked it to decide.
 *
 * ── What this does NOT cover yet, and why that is written down ────────────
 * The manager's and admin's analytics endpoints still read `ActivityLog` and
 * still answer with the taxonomy — they move in their own commit. Scanning
 * them today would fail for a reason that is already known and scheduled, and
 * a red suite that everybody learns to ignore protects nothing.
 *
 * So this scans the endpoints the read path owns, and the `test.todo` at the
 * foot names the rest. When analytics moves, that todo is the checklist.
 */

/** Field names that would mean the taxonomy is still being reported. */
const BANNED_FIELDS = [
  "broadCategory",
  "instructorCategory",
  "activityType",
  "activityTypeCode",
  "deliverableType",
  "deliverableTypeCode",
  "categoryCode",
  "subjects",
];

/** Evaluative words. A day is described, never graded. */
const BANNED_FLAGS = ["severity", "band", "riskLevel", "flagged", "verdict", "grade"];

/**
 * Two strings that mean classification came back.
 *
 * `Unclassified` was what the matcher printed when it could not place a line —
 * a row telling somebody their own sentence did not fit any category. `Watch`
 * was the severity badge's second rung, a judgement about a person rendered as
 * a chip. Neither is a field name, so neither would be caught by the key scan
 * above; both would arrive as VALUES, which is exactly how a removed feature
 * comes back without anybody deciding to bring it back.
 */
const BANNED_VALUES = ["Unclassified", "Watch"];

const CATEGORY_NAMES = new Set<string>([
  ...ACTIVITY_TYPE_CODES,
  ...DELIVERABLE_TYPES.map((d) => d.code),
]);

/** Every key present anywhere in a JSON tree, however deeply nested. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysOf(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

/** Every string VALUE in a JSON tree — where a fixed category name would hide. */
function stringsOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) stringsOf(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) stringsOf(v, out);
  } else if (typeof value === "string") {
    out.push(value);
  }
  return out;
}

let admin: ApiClient, instructor: ApiClient, manager: ApiClient;
let instructorId = "";
let universityId = "";
const DAY = daysAgo(60);

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  instructor = new ApiClient("scan-instructor");
  const session = await instructor.login(ACCOUNTS.instructorNorth2);
  instructorId = session.user.instructorId!;
  universityId = session.user.universityId!;

  manager = new ApiClient("scan-manager");
  await manager.login(ACCOUNTS.managerNorth);

  /* A day whose text deliberately CONTAINS taxonomy words. The scan must catch
     a field the server added, not a phrase the instructor typed — if it cannot
     tell those apart it would forbid people from writing "Live Class" in a box
     labelled Deliverable, which is the most ordinary thing they could write. */
  await seedDays(instructor, instructorId, [
    {
      date: DAY,
      deliverable: "Live Class - TECH stream, assignment evaluation after",
      quantity: "2 classes",
      workingHours: "5h",
      remarks: "ENGLISH section covered too",
    },
  ]);
});

/** The endpoints the read path owns. */
const SCANNED: Array<{ name: string; url: () => string; as?: () => ApiClient }> = [
  { name: "the explorer", url: () => `/api/activities?from=${DAY}&to=${DAY}&limit=50` },
  {
    name: "the explorer, scoped to one instructor",
    url: () => `/api/activities?instructorId=${instructorId}&from=${DAY}&to=${DAY}&limit=50`,
  },

  /* ── Item 22: the manager's and the admin's surfaces ─────────────────────
   *
   * These were the three `test.todo`s at the foot of this file. They were owed
   * a move rather than a decision: the manager's views read `ActivityLog` and
   * still answered with the taxonomy, so scanning them then would have failed
   * for a reason that was already known and scheduled, and a red suite
   * everybody learns to ignore protects nothing.
   *
   * They read `WorklogEntry` now. So the claim this file makes — no response
   * carries a category — is finally a claim about the product rather than
   * about one role's corner of it. */
  {
    name: "the manager's worklog",
    as: () => manager,
    url: () => `/api/manager/worklog?from=${DAY}&to=${DAY}`,
  },
  {
    name: "the manager's overview",
    as: () => manager,
    url: () => `/api/manager/overview?date=${DAY}&month=${DAY.slice(0, 7)}`,
  },
  {
    name: "the tracker",
    as: () => manager,
    url: () => `/api/universities/${universityId}/tracker?from=${DAY}&to=${DAY}`,
  },
  {
    name: "the admin's dashboard",
    as: () => admin,
    url: () => `/api/admin/dashboard?date=${DAY}`,
  },
  {
    name: "the admin's overview",
    as: () => admin,
    url: () => `/api/admin/overview?from=${DAY}&to=${DAY}`,
  },
  {
    name: "the staff sheet",
    as: () => admin,
    url: () => `/api/instructors?limit=50`,
  },
];

describe("the scan can fail", () => {
  /* A scan that cannot fail is not a scan. Both walkers are checked against a
     planted value first, because every assertion below is of the form "this is
     absent" — and a walker that silently returned nothing would make all of
     them pass on any response at all, including one still carrying the whole
     taxonomy. */
  test("a planted field is found however deeply it is buried", () => {
    const planted = { days: [{ id: "x", instructor: { profile: { broadCategory: "TECH" } } }] };
    expect(keysOf(planted).has("broadCategory")).toBe(true);
    expect(stringsOf(planted)).toContain("TECH");
  });

  test("and a planted value is found by the string scan", () => {
    for (const banned of BANNED_VALUES) {
      const planted = { days: [{ id: "x", insight: { title: `${banned} — 3 days` } }] };
      expect(JSON.stringify(planted).includes(banned)).toBe(true);
    }
  });

  test("and a response with none of them is genuinely clean", () => {
    const clean = { days: [{ id: "x", deliverable: "a class" }] };
    expect(keysOf(clean).has("broadCategory")).toBe(false);
  });
});

describe("no response carries a category field", () => {
  for (const endpoint of SCANNED) {
    test(endpoint.name, async () => {
      const res = await (endpoint.as ? endpoint.as() : instructor).get(endpoint.url());
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);

      const keys = keysOf(res.body);
      /* An absence scan over an empty response passes and proves nothing. Each
         endpoint has to have actually answered with a shape before "the shape
         contains no category" means anything about it. */
      expect(keys.size, `${endpoint.name} answered with nothing to scan`).toBeGreaterThan(3);

      for (const banned of BANNED_FIELDS) {
        expect(keys.has(banned), `${endpoint.name} still returns \`${banned}\``).toBe(false);
      }
    });
  }
});

describe("no response carries an evaluative flag", () => {
  for (const endpoint of SCANNED) {
    test(endpoint.name, async () => {
      const res = await (endpoint.as ? endpoint.as() : instructor).get(endpoint.url());
      const keys = keysOf(res.body);
      for (const banned of BANNED_FLAGS) {
        expect(keys.has(banned), `${endpoint.name} grades the work: \`${banned}\``).toBe(false);
      }
    });
  }
});

describe("two strings that would mean classification came back", () => {
  for (const endpoint of SCANNED) {
    test(endpoint.name, async () => {
      const res = await (endpoint.as ? endpoint.as() : instructor).get(endpoint.url());
      const body = JSON.stringify(res.body);
      for (const banned of BANNED_VALUES) {
        /* Matched against the whole serialized response rather than against
           known fields: the point is to catch it arriving somewhere nobody
           thought to look. The fixture never types either word, so a hit here
           is the server's. */
        expect(body.includes(banned), `${endpoint.name} says "${banned}"`).toBe(false);
      }
    });
  }
});

describe("a fixed category name only ever appears because somebody typed it", () => {
  test("the explorer echoes the text and adds no name of its own", async () => {
    const res = await instructor.get(`/api/activities?from=${DAY}&to=${DAY}&limit=50`);
    const day = (res.body.days as Array<Record<string, unknown>>).find(
      (d) => d.instructorId === instructorId,
    );
    expect(day, "the seeded day").toBeTruthy();

    /* The taxonomy words in this response are all inside the three free-text
       fields, and they are there because the fixture typed them. Anywhere else
       — a `label`, a `code`, a name beside the text — would be the server
       classifying, which is the thing that was removed. */
    const typed = [day!.deliverable, day!.deliverableQuantity, day!.remarks]
      .filter((v): v is string => typeof v === "string")
      .join(" ");

    const elsewhere = stringsOf({ ...day, deliverable: "", deliverableQuantity: "", remarks: "" });
    for (const value of elsewhere) {
      expect(
        CATEGORY_NAMES.has(value),
        `a category code "${value}" appears outside the text somebody typed`,
      ).toBe(false);
    }

    // And the scan is not passing because the fixture's words vanished.
    expect(typed).toContain("Live Class");
    expect(typed).toContain("TECH");
  });
});

/* CLOSED. All three of these were `test.todo`s holding open the rest of the
   surface while the manager's and admin's views still read `ActivityLog`.

   They have rows in SCANNED above now — the manager's worklog, overview and
   tracker; the admin's dashboard, overview, network view and staff sheet — so
   the claim this file makes covers the product rather than one role's corner
   of it.

   The CSV exports get their own block below rather than a row in SCANNED,
   because they answer with text rather than a JSON tree — the key and value
   walkers have nothing to walk, so the scan has to read the header line. */

describe("no CSV export carries a category column", () => {
  /* Two server-rendered exports, both behind `?export=csv`. They are worth
     scanning separately and not by inference: a CSV is built by its own
     formatter, so a column can exist there that no JSON response has. */
  const EXPORTS = [
    {
      name: "the tracker export",
      as: () => manager,
      url: () => `/api/universities/${universityId}/tracker?from=${DAY}&to=${DAY}&export=csv`,
    },
    {
      name: "the workload report export",
      as: () => manager,
      url: () => `/api/universities/${universityId}/reports?from=${DAY}&to=${DAY}&export=csv`,
    },
  ];

  for (const endpoint of EXPORTS) {
    test(endpoint.name, async () => {
      const res = await endpoint.as().get(endpoint.url());
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
      expect(typeof res.body, "a CSV comes back as text").toBe("string");

      const csv = res.body as string;
      const header = csv.split("\n")[0] ?? "";
      // Not a vacuous pass: there is a header, and it has columns in it.
      expect(header.split(",").length).toBeGreaterThan(2);

      for (const banned of [...BANNED_FIELDS, ...BANNED_FLAGS]) {
        expect(
          header.toLowerCase().includes(banned.toLowerCase()),
          `${endpoint.name} has a \`${banned}\` column`,
        ).toBe(false);
      }
      for (const value of BANNED_VALUES) {
        expect(csv.includes(value), `${endpoint.name} prints "${value}"`).toBe(false);
      }
    });
  }
});
