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
export const SECTIONS = ["Goal", "Why", "Design", "Parts", "Paths", "Done when", "Tests and rows", "Depends on", "Branch", "Old ids",
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
  const role = roleOf(labels);
  if (labels.includes("task") && role !== "task") problems.push(`kind:${role === "stream" ? "parent" : role} is not a task an agent takes`);
  if (labels.includes("task") && labels.some(label => label.startsWith("state:"))) problems.push("a held, parked or needs-user issue cannot carry task");
  return problems;
}

/** The card as an issue body: each section a bold heading, in SECTIONS order. */
export function renderCard(card: Partial<Record<Section, string>>): string {
  return SECTIONS.filter(section => card[section]?.trim()).map(section => `**${section}:** ${card[section]!.trim()}`).join("\n\n") + "\n";
}

export type Role = "stream" | "group" | "task" | "question";
export function roleOf(labels: readonly string[]): Role {
  return labels.includes("kind:parent") ? "stream" : labels.includes("kind:group") ? "group" : labels.includes("kind:question") ? "question" : "task";
}

/** Both the CLI card and GitHub's issue-form headings use one parser. */
export function parseCard(body: string): { card: Partial<Record<Section, string>>; headings: string[]; problems: string[] } {
  const matches = [...body.matchAll(/^(?:\*\*([^*\n]+?):?\*\*:?|### ([^\n]+))[^\S\n]*(.*)$/gm)];
  const card: Partial<Record<Section, string>> = {}, headings: string[] = [], problems: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!, heading = (m[1] ?? m[2]!).replace(/:$/, "").trim();
    if (!(SECTIONS as readonly string[]).includes(heading)) continue;
    const section = heading as Section;
    if (headings.includes(section)) problems.push(`the card repeats ${section}`);
    if (headings.length && SECTIONS.indexOf(section) < SECTIONS.indexOf(headings.at(-1)! as Section)) problems.push(`the card has ${section} out of order`);
    headings.push(section);
    card[section] = (m[3]! + body.slice(m.index! + m[0].length, matches[i + 1]?.index ?? body.length)).trim();
  }
  return { card, headings, problems };
}

export const PLACEHOLDER = /\b(?:to scope(?: when taken)?|tbd|todo|to be (?:scoped|decided)|scope per part when taken)\b/i;

/** Empty headings are not a card. Unready leaves remain legal without task. */
export function bodyProblems(body: string, labels: readonly string[]): string[] {
  const role = roleOf(labels), ready = labels.includes("task"), parsed = parseCard(body);
  if (role === "stream") return [];
  const required: readonly Section[] = role === "group" ? ["Goal", "Why", "Design", "Parts", "Done when", "Tests and rows"] : ready ? REQUIRED : ["Goal"];
  const problems = [...parsed.problems];
  for (const key of required) {
    if (!parsed.card[key] || parsed.card[key] === "_No response_") problems.push(`the card has no ${key}`);
  }
  if (ready) {
    for (const key of REQUIRED) if (PLACEHOLDER.test(parsed.card[key] ?? "")) problems.push(`a ready task needs concrete ${key}`);
    if (/^- \[[ x]\]/m.test(parsed.card.Parts ?? "")) problems.push("several wanted parts belong in a group, not a ready task");
    if (parsed.card["Depends on"] && /\b(?:unresolved|unnamed|unidentified|names no issue)\b/i.test(parsed.card["Depends on"])) problems.push("a ready task has an unresolved dependency");
  }
  if (role === "group") {
    if (!/\bdocs\/[\w./#-]+\.md(?:#[\w-]+)?/.test(parsed.card.Design ?? "")) problems.push("a group names its governing design page");
    const rows = parsed.card["Tests and rows"] ?? "";
    const exemption = /(?:not applicable|no (?:benchmark|throughput)|contract.only)/i.test(rows);
    if (PLACEHOLDER.test(rows) || rows.length < 12 || (!/[\w./-]+\.(?:ts|rs|mjs|sh)|`[\w-]+`|(?:rows?|fixtures?|tests?|corpus|checks?)/i.test(rows))) problems.push("a group names its acceptance rows or executable contract tests");
    if (exemption && !/(?:tests?|fixtures?|corpus|checks?)/i.test(rows)) problems.push("a row exemption names executable contract tests");
  }
  return problems;
}

export type Parent = { number: number; title: string; labels: string[]; state: string; id?: string; body?: string; parent?: number | null };
export function parentProblems(labels: readonly string[], parent: Parent | null): string[] {
  const role = roleOf(labels);
  if (role === "stream") return parent ? ["a stream has no parent"] : [];
  if (!parent) return [`a ${role} names its ${role === "group" ? "stream" : "group"} parent`];
  const wanted = role === "group" ? "stream" : "group", problems: string[] = [];
  if (roleOf(parent.labels) !== wanted) problems.push(`a ${role} needs a ${wanted} parent, #${parent.number} is ${roleOf(parent.labels)}`);
  if (parent.state.toUpperCase() !== "OPEN") problems.push(`parent #${parent.number} is closed`);
  if (labels.includes("task") && parent.labels.some(label => label.startsWith("state:"))) problems.push(`ready task's group #${parent.number} is held`);
  return problems;
}
