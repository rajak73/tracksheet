import { config } from "dotenv";
config({ path: ".env", quiet: true });
const { loadTaxonomy } = await import("@/server/worklog/taxonomy");
const { parseBullets, buildParseInstruction } = await import("@/server/worklog/parse");
const { prisma } = await import("@/server/db");

const bullets = [
  "took DSA lec 10:00 AM to 11:30 AM",
  "lab session for unit 3 from 11:30 to 1",
  "checked 40 answer sheets 2pm-4pm",
  "sat with 3 students about their projects 4-5pm",
  "made slides for unit 2, 1.5 hrs",                 // no range -> must be flagged
  "took another lecture on trees, 5 to 6",
];

const taxonomy = await loadTaxonomy();
console.log(`taxonomy: ${taxonomy.categories.length} categories, ${taxonomy.deliverableByCode.size} deliverables\n`);

const instruction = buildParseInstruction(bullets, taxonomy);
console.log("────── WHAT GOES TO THE AI (options ke saath) ──────");
console.log(instruction.split("\nThen read the time")[0]);
console.log("   … (rules + the 7 lines) …\n");

let res = await parseBullets(bullets, taxonomy);
let attempt = 1;
const t0 = Date.now();
while (!res.ok && attempt < 6) {
  console.log(`  attempt ${attempt}: ${res.reason} — retrying`);
  await new Promise((r) => setTimeout(r, 5000));
  res = await parseBullets(bullets, taxonomy);
  attempt++;
}
console.log(`────── WHAT COMES BACK (${Date.now() - t0}ms, attempt ${attempt}) ──────`);
if (!res.ok) {
  console.log("FAILED:", res.reason);
} else {
  for (const b of res.bullets) {
    const when = b.startLocal ? `${b.startLocal}-${b.endLocal}` : "duration only";
    console.log(
      `  ${b.index}. "${b.rawText}"\n` +
      `       → ${b.categoryCode} / ${b.deliverableCode}   ${when}   ${b.durationMinutes}min   qty ${b.quantity}` +
      (b.problem ? `   ⚠ ${b.problem}` : ""),
    );
  }
  const byDeliverable = new Map<string, { qty: number; min: number }>();
  for (const b of res.bullets) {
    if (!b.deliverableCode) continue;
    const e = byDeliverable.get(b.deliverableCode) ?? { qty: 0, min: 0 };
    e.qty += b.quantity; e.min += b.durationMinutes ?? 0;
    byDeliverable.set(b.deliverableCode, e);
  }
  console.log("\n────── DAY KA AGGREGATE (code me, AI se nahi) ──────");
  for (const [code, e] of byDeliverable) console.log(`  ${code.padEnd(26)} qty ${e.qty}   ${e.min} min`);
}
await prisma.$disconnect();
