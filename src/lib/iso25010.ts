// ISO/IEC 25010:2011 product quality model as a 5-point evaluation instrument:
// 8 characteristics, 31 sub-characteristics, one statement each. Pure, so tests,
// the API and the pages share it. Statements stay English: schools put them in Chapter 3.

export const ISO25010 = [
  { id: "fs", name: "Functional suitability", items: [
    { id: "fs1", name: "Functional completeness", text: "The functions cover all the tasks the system is meant to support." },
    { id: "fs2", name: "Functional correctness", text: "The system gives correct results with the needed precision." },
    { id: "fs3", name: "Functional appropriateness", text: "The functions make the users' tasks easier to finish." },
  ] },
  { id: "pe", name: "Performance efficiency", items: [
    { id: "pe1", name: "Time behaviour", text: "Pages and actions respond quickly." },
    { id: "pe2", name: "Resource utilization", text: "The system uses a reasonable amount of memory, storage and bandwidth." },
    { id: "pe3", name: "Capacity", text: "The system handles the expected number of users and records." },
  ] },
  { id: "co", name: "Compatibility", items: [
    { id: "co1", name: "Co-existence", text: "The system works alongside other software without problems." },
    { id: "co2", name: "Interoperability", text: "The system exchanges data correctly with the systems it connects to." },
  ] },
  { id: "us", name: "Usability", items: [
    { id: "us1", name: "Appropriateness recognizability", text: "Users can tell whether the system fits their needs." },
    { id: "us2", name: "Learnability", text: "A new user can learn to use the system quickly." },
    { id: "us3", name: "Operability", text: "The system is easy to operate and control." },
    { id: "us4", name: "User error protection", text: "The system prevents or catches user mistakes." },
    { id: "us5", name: "User interface aesthetics", text: "The interface is pleasing and consistent." },
    { id: "us6", name: "Accessibility", text: "People with different abilities can use the system." },
  ] },
  { id: "re", name: "Reliability", items: [
    { id: "re1", name: "Maturity", text: "The system works without errors during normal use." },
    { id: "re2", name: "Availability", text: "The system is available when users need it." },
    { id: "re3", name: "Fault tolerance", text: "The system keeps working when inputs are wrong or a part fails." },
    { id: "re4", name: "Recoverability", text: "The system recovers its data and normal state after a failure." },
  ] },
  { id: "se", name: "Security", items: [
    { id: "se1", name: "Confidentiality", text: "Data is accessible only to those authorized to see it." },
    { id: "se2", name: "Integrity", text: "The system prevents unauthorized changes to data and programs." },
    { id: "se3", name: "Non-repudiation", text: "Actions and events can be proven to have taken place." },
    { id: "se4", name: "Accountability", text: "Actions can be traced to the user who did them." },
    { id: "se5", name: "Authenticity", text: "The system verifies the identity of its users." },
  ] },
  { id: "ma", name: "Maintainability", items: [
    { id: "ma1", name: "Modularity", text: "Changing one part of the system has little effect on the others." },
    { id: "ma2", name: "Reusability", text: "Parts of the system can be reused in other systems." },
    { id: "ma3", name: "Analysability", text: "Problems and the effect of changes are easy to diagnose." },
    { id: "ma4", name: "Modifiability", text: "The system can be changed without adding defects." },
    { id: "ma5", name: "Testability", text: "The system can be tested effectively." },
  ] },
  { id: "po", name: "Portability", items: [
    { id: "po1", name: "Adaptability", text: "The system works on different devices, browsers or environments." },
    { id: "po2", name: "Installability", text: "The system is easy to install, deploy and remove." },
    { id: "po3", name: "Replaceability", text: "The system can replace the software or process it is meant to replace." },
  ] },
] as const;

export const ISO_ITEM_IDS = ISO25010.flatMap((c) => c.items.map((i) => i.id));
export type IsoItemId = (typeof ISO_ITEM_IDS)[number];
export type IsoScores = Record<IsoItemId, number>;

/** The 5-point scale, highest first, with the usual verbal interpretation ranges. */
export const ISO_SCALE = [
  { score: 5, label: "Excellent", range: "4.21 – 5.00" },
  { score: 4, label: "Very Good", range: "3.41 – 4.20" },
  { score: 3, label: "Good", range: "2.61 – 3.40" },
  { score: 2, label: "Fair", range: "1.81 – 2.60" },
  { score: 1, label: "Poor", range: "1.00 – 1.80" },
] as const;

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Verbal interpretation of a weighted mean (equal 0.8-wide bands from 1 to 5). */
export function interpret(m: number): string {
  if (m >= 4.21) return "Excellent";
  if (m >= 3.41) return "Very Good";
  if (m >= 2.61) return "Good";
  if (m >= 1.81) return "Fair";
  return "Poor";
}

/**
 * Weighted mean (sum of f·x over N) per item across evaluators, then per
 * characteristic (mean of its items) and overall (mean of the 8 characteristics).
 */
export function tabulate(all: Partial<IsoScores>[]) {
  // Means stay unrounded until output, so a panel re-doing the arithmetic gets the same 2 decimals.
  const raw = ISO25010.map((c) => {
    const items = c.items.map((i) => {
      const xs = all.map((s) => s[i.id]).filter((x): x is number => typeof x === "number");
      return { id: i.id, name: i.name, text: i.text, mean: mean(xs) };
    });
    return { id: c.id, name: c.name, items, mean: mean(items.map((i) => i.mean)) };
  });
  const overall = mean(raw.map((c) => c.mean));
  const characteristics = raw.map((c) => ({ ...c, mean: round2(c.mean), items: c.items.map((i) => ({ ...i, mean: round2(i.mean) })) }));
  return { n: all.length, characteristics, overall: round2(overall) };
}

/** Tab-separated table for pasting into Word or Excel (Chapter 4). */
export function toTsv(t: ReturnType<typeof tabulate>): string {
  const rows = [["Indicator", "Weighted mean", "Interpretation"]];
  for (const c of t.characteristics) {
    rows.push([c.name, c.mean.toFixed(2), interpret(c.mean)]);
    for (const i of c.items) rows.push([`  ${i.name}`, i.mean.toFixed(2), interpret(i.mean)]);
  }
  rows.push(["Overall", t.overall.toFixed(2), interpret(t.overall)]);
  return rows.map((r) => r.join("\t")).join("\n");
}
