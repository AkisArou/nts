// What a task issue is (docs/workflow.md, Tasks): its labels, by the rules in
// .github/labels.json, and its card, the sections an agent reads before it
// starts. One spec for the creation tool (new.ts), the label sync (labels.ts)
// and their tests.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LABELS_FILE = fileURLToPath(new URL("../../.github/labels.json", import.meta.url));

export type Label = { name: string; color: string; description: string };
export type Rule = "exactly one" | "at most one";
export type LabelSpec = { version: 1; rules: Record<string, Rule>; labels: Label[] };

/** The card's sections, in order. A task issue has the required ones; the rest appear when they say something. */
export const SECTIONS = ["Goal", "Why", "Parts", "Paths", "Done when", "Tests and rows", "Depends on", "Branch", "Old ids",
  "Merged from", "Moved out", "Check first", "Not in scope", "Parent"] as const;
export type Section = typeof SECTIONS[number];
export const REQUIRED: readonly Section[] = ["Goal", "Why", "Paths", "Done when", "Tests and rows"];

export function readSpec(file = LABELS_FILE): LabelSpec {
  const spec = JSON.parse(readFileSync(file, "utf8")) as LabelSpec;
  if (spec.version !== 1 || !spec.rules || !Array.isArray(spec.labels)) throw new Error(`${file}: not a version 1 label spec`);
  const names = new Set<string>();
  for (const label of spec.labels) {
    if (!/^[a-z0-9:-]+$/.test(label.name) || !/^[0-9a-f]{6}$/.test(label.color) || !label.description) throw new Error(`${file}: malformed label ${JSON.stringify(label)}`);
    if (names.has(label.name)) throw new Error(`${file}: ${label.name} twice`);
    names.add(label.name);
    const group = label.name.includes(":") ? label.name.slice(0, label.name.indexOf(":")) : null;
    if (group && !spec.rules[group]) throw new Error(`${file}: ${label.name} is in group ${group}, which has no rule`);
  }
  return spec;
}

/** Why a set of labels breaks the spec; empty when it keeps it. */
export function labelProblems(labels: readonly string[], spec: LabelSpec): string[] {
  const known = new Set(spec.labels.map(label => label.name)), problems: string[] = [];
  for (const label of labels) if (!known.has(label)) problems.push(`unknown label ${label}`);
  for (const [group, rule] of Object.entries(spec.rules)) {
    const n = labels.filter(label => label.startsWith(`${group}:`)).length;
    if (rule === "exactly one" && n !== 1) problems.push(`needs exactly one ${group}: label, has ${n}`);
    if (rule === "at most one" && n > 1) problems.push(`may have at most one ${group}: label, has ${n}`);
  }
  // A parent holds a stream and a question waits for an answer: neither is work an agent takes.
  const kind = labels.find(label => label.startsWith("kind:"));
  if (labels.includes("task") && (kind === "kind:parent" || kind === "kind:question")) problems.push(`${kind} is not a task an agent takes`);
  if (!labels.includes("task") && kind && kind !== "kind:parent" && kind !== "kind:question") problems.push(`${kind} is work an agent takes: it needs the task label`);
  return problems;
}

/** The card as an issue body: each section a bold heading, in SECTIONS order. */
export function renderCard(card: Partial<Record<Section, string>>): string {
  return SECTIONS.filter(section => card[section]?.trim()).map(section => `**${section}:** ${card[section]!.trim()}`).join("\n\n") + "\n";
}

/** Why an issue's body breaks the spec: a task's body has every required section. */
export function bodyProblems(body: string, labels: readonly string[]): string[] {
  if (!labels.includes("task")) return [];
  return REQUIRED.filter(section => !new RegExp(`^\\*\\*${section}:\\*\\*`, "m").test(body)).map(section => `the card has no ${section}`);
}
