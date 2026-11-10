// Create issues against the shared stream/group/task card contract. Parent
// roles are read before any write, in both the CLI and batch forms.
//   node tooling/tasks/new.ts --role group --title <t> --area <a> --kind group
//     --parent <N> --goal <g> --why <w> --design <page> --parts <p> --done <d> --tests <rows>
//   node tooling/tasks/new.ts --from <drafts.json> [--ledger <file>] [--dry-run]
// A batch parent is an existing issue number, a draft's id, or its exact title.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { bodyProblems, labelProblems, parentProblems, parseCard, readSpec, renderCard, roleOf,
  type LabelSpec, type Parent, type Role } from "./spec.ts";

export type Gh = (args: readonly string[], input?: string) => string;
export const gh: Gh = (args, input) => {
  const r = spawnSync("gh", args, { encoding: "utf8", input, maxBuffer: 64 << 20 });
  if (r.error || r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${(r.error?.message ?? r.stderr).trim()}`);
  return r.stdout;
};
export type Draft = { n: number; id?: string; title: string; labels: string[]; parent: number | string | null; body: string };
export type Created = { n: number; title: string; number: number; url: string; skipped: boolean; linked: boolean };
const numberOf = (value: Draft["parent"]): number | null => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  return typeof value === "string" && /^#?[1-9][0-9]*$/.test(value) ? Number(value.replace(/^#/, "")) : null;
};
function draftParent(draft: Draft, drafts: readonly Draft[]): Draft | undefined {
  return typeof draft.parent === "string" && numberOf(draft.parent) === null
    ? drafts.find(other => other.id === draft.parent || other.title === draft.parent) : undefined;
}
const asParent = (d: Draft): Parent => ({ number: d.n, title: d.title, labels: d.labels, state: "OPEN" });

/** Deterministic parent-first order; a cyclic or unknown parent is refused. */
export function orderedDrafts(drafts: readonly Draft[]): Draft[] {
  const out: Draft[] = [], pending = new Set(drafts), done = new Set<Draft>();
  while (pending.size) {
    let progress = false;
    for (const draft of pending) {
      const parent = draftParent(draft, drafts);
      if (typeof draft.parent === "string" && numberOf(draft.parent) === null && !parent) throw new Error(`draft ${draft.n}: unknown parent ${draft.parent}`);
      const dependencies = [...(parseCard(draft.body).card["Depends on"] ?? "").matchAll(/\{\{issue:([^}]+)\}\}/g)].map(m => drafts.find(d => d.id === m[1]));
      if (dependencies.some(d => !d)) throw new Error(`draft ${draft.n}: unknown symbolic dependency`);
      if ((parent && !done.has(parent)) || dependencies.some(d => !done.has(d!))) continue;
      out.push(draft); done.add(draft); pending.delete(draft); progress = true;
    }
    if (!progress) throw new Error("draft parent/dependency cycle; nothing is made");
  }
  return out;
}

/** Pure validation; callers obtain numeric parents read-only before invoking it. */
export function draftProblems(drafts: readonly Draft[], spec: LabelSpec, parents: ReadonlyMap<number, Parent> = new Map()): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const draft of drafts) {
    const problems = [...labelProblems(draft.labels, spec), ...bodyProblems(draft.body, draft.labels)];
    if (typeof draft.parent === "number" && (!Number.isSafeInteger(draft.parent) || draft.parent < 1)) problems.push("invalid numeric parent");
    if (!draft.title.trim() || draft.title.length > 100) problems.push("a title of 1 to 100 characters");
    if (drafts.filter(other => other.title === draft.title).length > 1) problems.push("its title is not unique");
    if (drafts.filter(other => other.n === draft.n).length > 1) problems.push("its draft number is not unique");
    if (draft.id && drafts.filter(other => other.id === draft.id).length > 1) problems.push("its symbolic id is not unique");
    const pending = draftParent(draft, drafts), existing = numberOf(draft.parent);
    const parent = pending ? asParent(pending) : existing !== null ? parents.get(existing) ?? null : null;
    if (draft.parent !== null && !parent) problems.push(`its parent "${draft.parent}" was not resolved read-only`);
    problems.push(...parentProblems(draft.labels, parent));
    const text = parseCard(draft.body).card.Parent;
    if (roleOf(draft.labels) !== "stream") {
      const references = new Set([String(draft.parent), existing === null ? "" : `#${existing}`, pending?.title ?? "", pending?.id ? `{{issue:${pending.id}}}` : ""]);
      if (!text || !references.has(text.trim())) problems.push("its Parent card section disagrees with its parent reference");
    }
    if (problems.length) out.set(draft.n, [...new Set(problems)]);
  }
  const incoming = new Map(drafts.map(d => [d, new Set<Draft>()]));
  for (const d of drafts) for (const m of (parseCard(d.body).card["Depends on"] ?? "").matchAll(/\{\{issue:([^}]+)\}\}/g)) {
    const dependency = drafts.find(other => other.id === m[1]);
    if (dependency) incoming.get(d)!.add(dependency);
    else out.set(d.n, [...out.get(d.n) ?? [], `unknown draft dependency ${m[1]}`]);
  }
  const remaining = new Set(drafts);
  while (remaining.size) {
    const ready = [...remaining].filter(d => [...incoming.get(d)!].every(other => !remaining.has(other)));
    if (!ready.length) { for (const d of remaining) out.set(d.n, [...out.get(d.n) ?? [], "draft dependency cycle"]); break; }
    for (const d of ready) remaining.delete(d);
  }
  try { orderedDrafts(drafts); } catch (e) {
    for (const d of drafts) out.set(d.n, [...out.get(d.n) ?? [], String(e instanceof Error ? e.message : e)]);
  }
  return out;
}

function readParent(run: Gh, number: number): Parent {
  const p = JSON.parse(run(["issue", "view", String(number), "--json", "number,title,labels,state,id,body"])) as Omit<Parent, "labels"> & { labels: { name: string }[] };
  return { ...p, labels: p.labels.map(l => l.name) };
}
export function prepareDrafts(drafts: readonly Draft[], run: Gh, spec = readSpec()): Draft[] {
  const parents = new Map<number, Parent>();
  for (const d of drafts) {
    const n = numberOf(d.parent);
    if (n !== null && !parents.has(n)) parents.set(n, readParent(run, n));
  }
  const problems = draftProblems(drafts, spec, parents);
  if (problems.size) throw new Error([...problems].map(([n, p]) => `draft ${n}: ${p.join("; ")}`).join("\n") + "\nnothing is made");
  return orderedDrafts(drafts);
}

function currentParent(run: Gh, number: number): number | null {
  const query = "query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){issue(number:$n){parent{number}}}}";
  const name = run(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim().split("/");
  const response = JSON.parse(run(["api", "graphql", "-H", "GraphQL-Features: sub_issues", "-f", `query=${query}`, "-f", `owner=${name[0]}`, "-f", `repo=${name[1]}`, "-F", `n=${number}`]));
  if (response.errors) throw new Error("the existing issue parent was not measured");
  return response.data.repository.issue.parent?.number ?? null;
}
function link(run: Gh, parent: number, child: number): void {
  const id = (n: number) => run(["issue", "view", String(n), "--json", "id", "--jq", ".id"]).trim();
  run(["api", "graphql", "-H", "GraphQL-Features: sub_issues", "-f", "query=mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}", "-f", `p=${id(parent)}`, "-f", `c=${id(child)}`]);
}

/** Validate the whole batch before writes; record creation before its link.
 * Existing titles are reused only when their open scope and parent agree.
 * An ambiguous response is inspected read-only, never blindly retried here.
 */
export function createDrafts(drafts: readonly Draft[], run: Gh, say: (line: string) => void, paceMs = 1500,
  record: (effects: readonly Created[]) => void = () => {}): Created[] {
  const ordered = prepareDrafts(drafts, run);
  const all = JSON.parse(run(["issue", "list", "--state", "all", "--limit", "5000", "--json", "number,title"])) as { number: number; title: string }[];
  if (all.length >= 5000) throw new Error("existing-title listing is incomplete; nothing is made");
  const done: Created[] = [], numbers = new Map<Draft, number>();
  for (const d of ordered) {
    const pd = draftParent(d, drafts), parent = pd ? numbers.get(pd)! : numberOf(d.parent);
    const parsed = parseCard(d.body).card;
    const body = (parent === null ? d.body : renderCard({ ...parsed, Parent: `#${parent}` })).replace(/\{\{issue:([^}]+)\}\}/g, (_, key: string) => {
      const dependency = drafts.find(other => other.id === key), number = dependency && numbers.get(dependency);
      if (!number) throw new Error(`unresolved body reference ${key}; inspect before continuing`);
      return `#${number}`;
    });
    const matches = all.filter(i => i.title === d.title);
    if (matches.length > 1) throw new Error(`ambiguous existing title: ${d.title}`);
    if (matches.length) {
      const existing = readParent(run, matches[0]!.number);
      if (existing.state !== "OPEN" || existing.body !== body || [...existing.labels].sort().join("\n") !== [...d.labels].sort().join("\n") || currentParent(run, existing.number) !== parent)
        throw new Error(`existing #${existing.number} differs or is closed; inspect it read-only before continuing`);
      numbers.set(d, existing.number);
      done.push({ n: d.n, title: d.title, number: existing.number, url: "", skipped: true, linked: true }); record(done);
      say(`kept #${existing.number}: ${d.title}`); continue;
    }
    const url = run(["issue", "create", "--title", d.title, "--body-file", "-", ...d.labels.flatMap(l => ["--label", l])], body).trim();
    const number = Number(url.slice(url.lastIndexOf("/") + 1));
    if (!Number.isSafeInteger(number) || number < 1) throw new Error(`creation response is ambiguous; inspect GitHub: ${url}`);
    numbers.set(d, number);
    const effect = { n: d.n, title: d.title, number, url, skipped: false, linked: parent === null };
    done.push(effect); record(done);
    if (parent !== null) { link(run, parent, number); effect.linked = true; record(done); }
    say(`made #${number}: ${d.title}`);
    if (paceMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, paceMs);
  }
  return done;
}

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`); return at < 0 ? undefined : argv[at + 1];
}
function checkArguments(argv: readonly string[]): void {
  const flags = new Set(["dry-run", "unready"]), values = new Set(["from", "ledger", "role", "kind", "area", "state", "title", "parent", "body-file", "goal", "why", "design", "parts", "paths", "done", "tests", "depends"]), seen = new Set<string>();
  for (let i=0;i<argv.length;i++) {
    const key=argv[i]!.replace(/^--/, "");
    if (!argv[i]!.startsWith("--") || (!flags.has(key) && !values.has(key))) throw new Error(`unknown argument ${argv[i]}`);
    if (seen.has(key)) throw new Error(`duplicate --${key}`); seen.add(key);
    if (values.has(key) && (!argv[++i] || argv[i]!.startsWith("--"))) throw new Error(`--${key} needs a value`);
  }
}
export function cliDraft(argv: readonly string[]): Draft {
  checkArguments(argv);
  const kind = option(argv, "kind"), explicit = option(argv, "role");
  const inferred = kind === "parent" ? "stream" : kind === "group" ? "group" : kind === "question" ? "question" : "task";
  if (explicit && (!["stream", "group", "task", "question"].includes(explicit) || explicit !== inferred)) throw new Error("--role disagrees with --kind");
  const role = (explicit ?? inferred) as Role, state = option(argv, "state");
  const labels = [`area:${option(argv, "area")}`, `kind:${kind}`, ...(state ? [`state:${state}`] : [])];
  if (role === "task" && !state && !argv.includes("--unready")) labels.unshift("task");
  const parent = option(argv, "parent"), file = option(argv, "body-file");
  if (parent && !/^#?[1-9][0-9]*$/.test(parent)) throw new Error("--parent needs a positive issue number");
  return { n: 1, title: option(argv, "title") ?? "", labels, parent: parent ? Number(parent.replace(/^#/, "")) : null,
    body: file ? readFileSync(file, "utf8") : renderCard({ Goal: option(argv, "goal"), Why: option(argv, "why"), Design: option(argv, "design"), Parts: option(argv, "parts"), Paths: option(argv, "paths"), "Done when": option(argv, "done"), "Tests and rows": option(argv, "tests"), "Depends on": option(argv, "depends"), Parent: parent ? `#${parent.replace(/^#/, "")}` : undefined }) };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const argv = process.argv.slice(2); checkArguments(argv);
    const from = option(argv, "from"), ledger = option(argv, "ledger");
    const drafts = from ? JSON.parse(readFileSync(from, "utf8")) as Draft[] : [cliDraft(argv)];
    prepareDrafts(drafts, gh);
    if (argv.includes("--dry-run")) process.stdout.write(`${drafts.length} draft(s) keep the spec; no writes\n`);
    else createDrafts(drafts, gh, line => process.stdout.write(line + "\n"), 1500,
      effects => { if (ledger) writeFileSync(ledger, JSON.stringify(effects, null, 2) + "\n"); });
  } catch (e) {
    process.stderr.write(`tasks: ${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 2;
  }
}
