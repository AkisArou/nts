// Make task issues (docs/workflow.md, Tasks): every issue goes through here,
// so each has labels by .github/labels.json and a card with its required
// sections. A task names its stream's parent issue and becomes its sub-issue.
//
//   node tooling/tasks/new.ts --title <t> --area <a> --kind <k> [--state <s>] [--parent <N>]
//        --goal <..> --why <..> --paths <..> --done <..> --tests <..> [--depends <..>] [--dry-run]
//   node tooling/tasks/new.ts --from <drafts.json> [--ledger <file>] [--dry-run]
//
// --from takes an array of { n, title, labels, parent, body }, the parents
// (kind:parent) first: a child's `parent` and its "**Parent:**" line name its
// parent by title, and are written as #<number> once the parent exists. A
// draft whose title is already an issue is skipped, so a run that stopped can
// be run again. --ledger writes the draft numbers and the issues they became.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { bodyProblems, labelProblems, readSpec, renderCard, type LabelSpec } from "./spec.ts";

/** The GitHub command line, as the tool uses it: arguments in, stdout out, a failure thrown. */
export type Gh = (args: readonly string[], input?: string) => string;
export const gh: Gh = (args, input) => {
  const r = spawnSync("gh", args, { encoding: "utf8", input, maxBuffer: 64 << 20 });
  if (r.error || r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${(r.error?.message ?? r.stderr).trim()}`);
  return r.stdout;
};

export type Draft = { n: number; title: string; labels: string[]; parent: string | null; body: string };

/** Why each draft breaks the spec, by draft number; empty when all keep it. */
export function draftProblems(drafts: readonly Draft[], spec: LabelSpec): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const parents = new Set(drafts.filter(draft => draft.labels.includes("kind:parent")).map(draft => draft.title));
  for (const draft of drafts) {
    const problems = [...labelProblems(draft.labels, spec), ...bodyProblems(draft.body, draft.labels)];
    if (!draft.title.trim() || draft.title.length > 100) problems.push("a title of 1 to 100 characters");
    if (draft.parent && !parents.has(draft.parent)) problems.push(`its parent "${draft.parent}" is not a parent draft`);
    if (draft.labels.includes("task") && !draft.parent) problems.push("a task names its stream's parent");
    if (drafts.filter(other => other.title === draft.title).length > 1) problems.push("its title is not unique");
    if (problems.length) out.set(draft.n, problems);
  }
  return out;
}

type Created = { n: number; title: string; number: number; url: string; skipped: boolean };

/** Every issue's number by its exact title, open or closed: one listing, not a search, which matches loosely. */
function existingTitles(run: Gh): Map<string, number> {
  const all = JSON.parse(run(["issue", "list", "--state", "all", "--limit", "5000", "--json", "number,title"])) as { number: number; title: string }[];
  return new Map(all.map(issue => [issue.title, issue.number]));
}

/** Make one issue and, under a parent, link it as the parent's sub-issue. */
function create(run: Gh, title: string, labels: readonly string[], body: string, parent: number | null): { number: number; url: string } {
  const url = run(["issue", "create", "--title", title, "--body-file", "-", ...labels.flatMap(label => ["--label", label])], body).trim();
  const number = Number(url.slice(url.lastIndexOf("/") + 1));
  if (!Number.isSafeInteger(number)) throw new Error(`gh issue create printed no issue URL: ${url}`);
  if (parent !== null) {
    const id = (n: number) => run(["issue", "view", String(n), "--json", "id", "--jq", ".id"]).trim();
    run(["api", "graphql", "-H", "GraphQL-Features: sub_issues", "-f", "query=mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}",
      "-f", `p=${id(parent)}`, "-f", `c=${id(number)}`]);
  }
  return { number, url };
}

/** GitHub limits how fast content is made; a batch keeps under it. */
const PACE_MS = 1500;
const pause = (ms: number) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** Make every draft, parents first; a child's parent and "Parent:" line become the parent's #number. */
export function createDrafts(drafts: readonly Draft[], run: Gh, say: (line: string) => void, paceMs = PACE_MS): Created[] {
  const ordered = [...drafts.filter(draft => draft.labels.includes("kind:parent")), ...drafts.filter(draft => !draft.labels.includes("kind:parent"))];
  const numbers = new Map<string, number>(), done: Created[] = [], titles = existingTitles(run);
  for (const draft of ordered) {
    const before = titles.get(draft.title) ?? null;
    if (before !== null) {
      numbers.set(draft.title, before);
      done.push({ n: draft.n, title: draft.title, number: before, url: "", skipped: true });
      say(`kept #${before}: ${draft.title}`);
      continue;
    }
    const parent = draft.parent ? numbers.get(draft.parent) ?? null : null;
    if (draft.parent && parent === null) throw new Error(`draft ${draft.n}: its parent "${draft.parent}" was not made`);
    const body = parent === null ? draft.body : draft.body.replace(`**Parent:** ${draft.parent}`, `**Parent:** #${parent}`);
    const made = create(run, draft.title, draft.labels, body, parent);
    numbers.set(draft.title, made.number);
    done.push({ n: draft.n, title: draft.title, ...made, skipped: false });
    say(`made #${made.number}: ${draft.title}`);
    pause(paceMs);
  }
  return done;
}

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? undefined : argv[at + 1];
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const argv = process.argv.slice(2), spec = readSpec(), dry = argv.includes("--dry-run");
  try {
    const from = option(argv, "from");
    if (from) {
      if (!existsSync(from)) throw new Error(`no drafts file ${from}`);
      const drafts = JSON.parse(readFileSync(from, "utf8")) as Draft[];
      const problems = draftProblems(drafts, spec);
      for (const [n, list] of problems) console.log(`draft ${n}: ${list.join("; ")}`);
      if (problems.size) throw new Error(`${problems.size} draft(s) break the spec; nothing is made`);
      console.log(`${drafts.length} drafts keep the spec (${drafts.filter(draft => draft.labels.includes("kind:parent")).length} parents)`);
      if (!dry) {
        const made = createDrafts(drafts, gh, line => console.log(line));
        const ledger = option(argv, "ledger");
        if (ledger) writeFileSync(ledger, JSON.stringify(made.map(({ n, title, number }) => ({ n, title, number })), null, 2) + "\n");
      }
    } else {
      const area = option(argv, "area"), kind = option(argv, "kind"), state = option(argv, "state"), title = option(argv, "title");
      const labels = ["task", `area:${area}`, `kind:${kind}`, ...(state ? [`state:${state}`] : [])].filter(label => label !== "task" || (kind !== "parent" && kind !== "question"));
      const parent = option(argv, "parent");
      const body = renderCard({ Goal: option(argv, "goal"), Why: option(argv, "why"), Paths: option(argv, "paths"), "Done when": option(argv, "done"),
        "Tests and rows": option(argv, "tests"), "Depends on": option(argv, "depends"), Parent: parent ? `#${parent}` : undefined });
      const problems = [...labelProblems(labels, spec), ...bodyProblems(body, labels), ...(title ? [] : ["a --title"]), ...(labels.includes("task") && !parent ? ["a task names its stream's parent (--parent N)"] : [])];
      if (problems.length) throw new Error(`the issue breaks the spec: ${problems.join("; ")}`);
      if (dry) console.log(`would make: ${title} [${labels.join(", ")}]\n\n${body}`);
      else console.log(create(gh, title!, labels, body, parent ? Number(parent) : null).url);
    }
  } catch (error) {
    console.error(`tasks: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
