import { describe, expect, test } from "vitest";
import {
  GROUP_SYSTEM,
  groupingInstruction,
  parseGrouping,
  runGrouping,
  type GroupMember,
} from "@/server/insights/group";

/**
 * Grouping names what repeated. It never counts.
 *
 * The model is sent labels and dates — no durations, no counts, no day total —
 * because a model that can see a number will eventually repeat one, and a
 * repeated number is a second source for a figure that already has one. When
 * two sources disagree, the one on screen is the invented one.
 */

const MEMBERS: GroupMember[] = [
  { label: "Live class on binary tree", date: "2026-09-01", subtopic: "binary tree", topic: "DSA" },
  { label: "Live class on hashing", date: "2026-09-02", subtopic: "hashing", topic: "Data Structures" },
  { label: "Doubt clearing session", date: "2026-09-02", subtopic: null, topic: null },
];

/* One topic under two names on two days, resolved to one; and an activity with
   no topic that recurs, so it earns a group rather than falling to Other. */
const ok = JSON.stringify({
  groups: [
    { name: "DSA — taught", members: [0, 1] },
    { name: "Doubt clearing", members: [2] },
  ],
});

/** The period's subtopics, so a name carrying one can be refused. */
const SUBTOPICS = ["binary tree", "hashing"];

function provider(replies: string[]) {
  let calls = 0;
  return {
    calls: () => calls,
    call: async () => {
      const body = replies[Math.min(calls, replies.length - 1)]!;
      calls += 1;
      return { ok: true as const, text: body };
    },
  };
}

describe("the grouping prompt", () => {
  test("sends labels, dates and topics, and no figures at all", () => {
    const text = groupingInstruction(MEMBERS);
    expect(text).toContain("Live class on binary tree");
    expect(text).toContain("2026-09-01");
    // What each DAY called it, so the period can settle on one name.
    expect(text).toContain("DSA");
    expect(text).toContain("binary tree");
    /* The figures a week view knows and the model must not be told. Asserted on
       the PAYLOAD KEYS rather than on the prose: the instructions legitimately
       use the word "sessions" when explaining that two subtopics were separate
       sessions, and a test that forbids the word forbids explaining the rule. */
    expect(text).not.toContain('"sessions"');
    expect(text).not.toContain('"minutes"');
    expect(text).not.toContain('"duration');
    expect(text).not.toContain("working_minutes");
    /* The rule itself lives in the system instruction, which is sent alongside
       rather than folded into the payload — so the rules are not read as part
       of the period being described. */
    expect(GROUP_SYSTEM).toContain("Output no numbers of any kind");
  });

  test("9. it names no topics of its own", () => {
    /* The standing guard against the taxonomy walking back in through a prompt.
       The instruction may say what a topic IS; it must never list which topics
       exist, because a list in a prompt is a list. The examples of naming are
       the model's own reasoning material, not a vocabulary to choose from. */
    const vocabulary = ["Teaching", "Meetings", "Administrative", "Lesson Prep", "Evaluation"];
    for (const word of vocabulary) {
      expect(groupingInstruction(MEMBERS)).not.toContain(word);
      expect(GROUP_SYSTEM).not.toContain(word);
    }
  });

  test("7. teaching a topic and preparing for it are asked to stay apart", () => {
    expect(GROUP_SYSTEM).toContain("teaching and preparing are");
  });
});

describe("6. no group name contains a subtopic", () => {
  test("a name carrying one of the period's subtopics is refused", () => {
    /* "DSA — taught binary search" is the day view with a week's heading on it,
       and it is wrong the moment a second subtopic joins the group. */
    const named = JSON.stringify({
      groups: [
        { name: "DSA — taught binary tree", members: [0, 1] },
        { name: "Doubt clearing", members: [2] },
      ],
    });
    const r = parseGrouping(named, 3, SUBTOPICS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("binary tree");
  });

  test("a multi-word subtopic is matched whole, not by one of its words", () => {
    /* "review" inside "code review" must not refuse "Submission review", which
       is a name the instruction asks for. The check that costs a correct answer
       is worse than the one that misses an incorrect one. */
    const r = parseGrouping(
      JSON.stringify({ groups: [{ name: "Submission review", members: [0, 1, 2] }] }),
      3,
      ["code review"],
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  test("the same reply passes when the subtopic is not in the name", () => {
    expect(parseGrouping(ok, 3, SUBTOPICS).ok).toBe(true);
  });

  test("a group named for its own topic is not refused for it", () => {
    /* "Prepared for dsa" names the subtopic "dsa" and the topic "DSA" — the
       writer named only the broad area, so the two are the same word. The
       instruction then asks for exactly "DSA — taught", and this check refused
       it three attempts running, on every week and month in the product. */
    const r = parseGrouping(
      JSON.stringify({ groups: [{ name: "DSA — taught", members: [0, 1, 2] }] }),
      3,
      ["dsa", "binary search"],
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  test("but a name narrowed PAST its topic still is", () => {
    const r = parseGrouping(
      JSON.stringify({ groups: [{ name: "DSA — taught hashing", members: [0, 1, 2] }] }),
      3,
      ["dsa", "hashing"],
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("hashing");
  });
});

describe("6. a week settles on one name for one topic", () => {
  test("Monday's DSA and Wednesday's Data Structures become one group", async () => {
    /* The grouping is the only step that sees every day at once, so resolving
       two names for one thing is its job and not the day extraction's. */
    const p = provider([ok]);
    const result = await runGrouping(MEMBERS, p.call);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const topic = result.groups.find((g) => g.members.includes(0))!;
    expect(topic.name).toBe("DSA — taught");
    expect(topic.members, "both days land under the one name").toEqual([0, 1]);
    expect(result.groups).toHaveLength(2);
  });
});

describe("11. a grouping response containing a digit is rejected", () => {
  test("a digit in a group name is refused", () => {
    const withNumber = JSON.stringify({
      groups: [
        { name: "Live class (2 sessions)", members: [0, 1] },
        { name: "Doubt clearing session", members: [2] },
      ],
    });
    const r = parseGrouping(withNumber, 3);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("number");
  });

  test("a digit anywhere else in the reply is refused too", () => {
    /* Including a field nobody reads today. A number sitting in an unread
       field is a number somebody renders next month. */
    const withHeadline = JSON.stringify({
      groups: [
        { name: "Live class", members: [0, 1], headline: "2 live classes this week" },
        { name: "Doubt clearing session", members: [2] },
      ],
    });
    expect(parseGrouping(withHeadline, 3).ok).toBe(false);
  });

  test("member indices are not mistaken for stated numbers", () => {
    // The indices ARE digits, and they are the one number the reply must carry.
    expect(parseGrouping(ok, 3).ok).toBe(true);
  });

  test("it is retried once, and a clean second answer is kept", async () => {
    const dirty = JSON.stringify({ groups: [{ name: "Live class x3", members: [0, 1, 2] }] });
    const p = provider([dirty, ok]);
    const result = await runGrouping(MEMBERS, p.call);
    expect(result.ok).toBe(true);
    expect(p.calls()).toBe(2);
  });
});

describe("every activity is placed exactly once", () => {
  test("a dropped activity is refused", () => {
    const dropped = JSON.stringify({ groups: [{ name: "Live class", members: [0, 1] }] });
    const r = parseGrouping(dropped, 3);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("left out");
  });

  test("an activity in two groups is refused", () => {
    const twice = JSON.stringify({
      groups: [
        { name: "Live class", members: [0, 1] },
        { name: "Doubt clearing session", members: [1, 2] },
      ],
    });
    expect(parseGrouping(twice, 3).ok).toBe(false);
  });

  test("an index nobody sent is refused", () => {
    const invented = JSON.stringify({
      groups: [
        { name: "Live class", members: [0, 1] },
        { name: "Doubt clearing session", members: [2] },
        { name: "Something else", members: [7] },
      ],
    });
    expect(parseGrouping(invented, 3).ok).toBe(false);
  });

  test("an empty period asks nothing of the model", async () => {
    const p = provider([ok]);
    const result = await runGrouping([], p.call);
    expect(result.ok && result.groups).toEqual([]);
    expect(p.calls(), "no activities is not a question worth paying for").toBe(0);
  });
});
