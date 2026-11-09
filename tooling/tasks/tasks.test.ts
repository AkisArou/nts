// The task spec (spec.ts), the creation tool (new.ts), the label sync
// (labels.ts), the branch rule (branch.ts) and how a commit names its issue
// (links.ts), against the real .github/labels.json and a stand-in for gh.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrafts, draftProblems, type Draft, type Gh } from "./new.ts";
import { sync, syncPlan } from "./labels.ts";
import { bodyProblems, labelProblems, readSpec, renderCard, REQUIRED } from "./spec.ts";
import { BRANCH, issueBranch, issueOfBranch, slugOf } from "./branch.ts";
import { issuesNamed, withFixes } from "./links.ts";

const spec = readSpec();
const card = renderCard({ Goal: "g", Why: "w", Paths: "p", "Done when": "d", "Tests and rows": "t", Parent: "Stream" });

test("the label file is a spec: groups with rules, a task label, one area, one kind and at most one state", () => {
  assert.deepEqual(spec.rules, { area: "exactly one", kind: "exactly one", state: "at most one" });
  assert.ok(spec.labels.some(label => label.name === "task"));
  assert.deepEqual(labelProblems(["task", "area:compiler", "kind:abort"], spec), []);
  assert.deepEqual(labelProblems(["task", "area:compiler", "kind:abort", "state:held"], spec), []);
  assert.deepEqual(labelProblems(["area:tooling", "kind:parent"], spec), []);
  assert.match(labelProblems(["task", "kind:abort"], spec).join(), /exactly one area: label, has 0/);
  assert.match(labelProblems(["task", "area:compiler", "kind:abort", "kind:refusal"], spec).join(), /exactly one kind: label, has 2/);
  assert.match(labelProblems(["task", "area:compiler", "kind:abort", "state:held", "state:parked"], spec).join(), /at most one state/);
  assert.match(labelProblems(["task", "area:compiler", "kind:abort", "bug"], spec).join(), /unknown label bug/);
  assert.match(labelProblems(["task", "area:tooling", "kind:parent"], spec).join(), /kind:parent is not a task an agent takes/);
  assert.match(labelProblems(["area:compiler", "kind:abort"], spec).join(), /needs the task label/);
});

test("a task's card has every required section, in order", () => {
  assert.deepEqual(bodyProblems(card, ["task"]), []);
  assert.ok(card.indexOf("**Goal:**") < card.indexOf("**Done when:**") && card.indexOf("**Done when:**") < card.indexOf("**Parent:**"));
  const missing = renderCard({ Goal: "g", Why: "w", Paths: "p", "Tests and rows": "t" });
  assert.deepEqual(bodyProblems(missing, ["task"]), ["the card has no Done when"]);
  assert.deepEqual(bodyProblems("free text", ["kind:parent"]), [], "a parent's body is free");
  assert.equal(REQUIRED.length, 5);
});

const parent: Draft = { n: 1, title: "Stream", labels: ["area:tooling", "kind:parent"], parent: null, body: "The stream.\n" };
const child: Draft = { n: 2, title: "Do one thing", labels: ["task", "area:tooling", "kind:foundation"], parent: "Stream", body: card };

test("drafts are checked together: a parent that exists, a unique title, the spec on each", () => {
  assert.deepEqual([...draftProblems([parent, child], spec)], []);
  const orphan = { ...child, parent: "No such stream" };
  assert.match(draftProblems([parent, orphan], spec).get(2)!.join(), /is not a parent draft/);
  assert.match(draftProblems([parent, child, { ...child, n: 3 }], spec).get(3)!.join(), /not unique/);
  assert.match(draftProblems([parent, { ...child, parent: null }], spec).get(2)!.join(), /names its stream's parent/);
});

/** gh as GitHub would answer it: issues made in order, a search by title, sub-issue links recorded. */
function fakeGh(existing: { number: number; title: string }[] = []) {
  const issues = [...existing], links: [string, string][] = [], made: { title: string; body: string; labels: string[] }[] = [];
  const run: Gh = (args, input) => {
    const [a, b] = args;
    if (a === "issue" && b === "list") return JSON.stringify(issues);
    if (a === "issue" && b === "create") {
      const title = args[args.indexOf("--title") + 1]!, labels = args.flatMap((arg, i) => arg === "--label" ? [args[i + 1]!] : []);
      const number = 500 + issues.length;
      issues.push({ number, title });
      made.push({ title, body: input!, labels });
      return `https://github.com/o/r/issues/${number}\n`;
    }
    if (a === "issue" && b === "view") return `ID_${args[2]}\n`;
    if (a === "api") { links.push([args.find(arg => arg.startsWith("p="))!, args.find(arg => arg.startsWith("c="))!]); return "{}"; }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { run, made, links };
}

test("parents are made first, a child's parent becomes #N in its card and a sub-issue link, and a rerun keeps what exists", () => {
  const g = fakeGh(), lines: string[] = [];
  const made = createDrafts([child, parent], g.run, line => lines.push(line), 0);
  assert.deepEqual(made.map(one => [one.title, one.number, one.skipped]), [["Stream", 500, false], ["Do one thing", 501, false]]);
  assert.match(g.made[1]!.body, /\*\*Parent:\*\* #500/);
  assert.deepEqual(g.made[1]!.labels, ["task", "area:tooling", "kind:foundation"]);
  assert.deepEqual(g.links, [["p=ID_500", "c=ID_501"]]);
  const again = fakeGh([{ number: 500, title: "Stream" }, { number: 501, title: "Do one thing" }]);
  assert.deepEqual(createDrafts([parent, child], again.run, () => {}, 0).map(one => one.skipped), [true, true]);
  assert.equal(again.made.length, 0, "a draft whose title is an issue is not made twice");
});

test("the label sync makes what is missing, writes what changed, and only reports a label the file lacks", () => {
  const have = [{ name: "task", color: "0E8A16", description: spec.labels[0]!.description }, { name: "area:compiler", color: "ffffff", description: "old" }, { name: "bug", color: "d73a4a", description: "x" }];
  const plan = syncPlan(spec, have);
  assert.ok(!plan.make.some(label => label.name === "task"), "a colour differing only in case is the same");
  assert.deepEqual(plan.edit.map(label => label.name), ["area:compiler"]);
  assert.deepEqual(plan.extra, ["bug"]);
  assert.equal(plan.make.length, spec.labels.length - 2);
});

test("--prune deletes a label the file lacks, and says how many issues carry it; without it nothing is deleted", () => {
  const calls: string[][] = [];
  const have = [...spec.labels, { name: "wontfix", color: "ffffff", description: "x" }];
  const run: Gh = args => {
    calls.push([...args]);
    if (args[0] === "label" && args[1] === "list") return JSON.stringify(have);
    if (args[1] === "list" && args.includes("--label")) return JSON.stringify(args[0] === "issue" ? [{ number: 1 }, { number: 2 }] : [{ number: 3 }]);
    return "";
  };
  const lines: string[] = [];
  sync(run, spec, { dry: false, prune: false }, line => lines.push(line));
  assert.ok(!calls.some(args => args[1] === "delete"), "no --prune: nothing is deleted");
  assert.deepEqual(lines, ["kept, not in .github/labels.json: wontfix"]);
  calls.length = 0; lines.length = 0;
  sync(run, spec, { dry: false, prune: true }, line => lines.push(line));
  assert.deepEqual(calls.filter(args => args[1] === "delete"), [["label", "delete", "wontfix", "--yes"]]);
  assert.deepEqual(lines, ["delete wontfix (carried by 3 issue(s) or pull request(s))"]);
  calls.length = 0;
  sync(run, spec, { dry: true, prune: true }, () => {});
  assert.ok(!calls.some(args => args[1] === "delete"), "a dry run deletes nothing");
});

test("a task's branch is its issue number and a slug, and only the number counts", () => {
  assert.equal(issueBranch(516, "LLVM: at least as fast as C"), "516-llvm-at-least-as-fast-as-c");
  assert.equal(issueBranch(42), "42");
  assert.equal(issueOfBranch("516-llvm-linkage-nsw"), 516);
  assert.equal(issueOfBranch("42"), 42);
  for (const branch of ["compiler/llvm-linkage-nsw", "0516-x", "516-", "516-X", "516--x", "x-516", "main"]) assert.equal(issueOfBranch(branch), null, branch);
  assert.throws(() => issueBranch(0), /positive integer/);
  assert.equal(slugOf("Map and Set: by the proven layout, their contents", 4), "map-and-set-by");
  assert.ok(BRANCH.test("547-records-listed-kinds"));
});

test("a commit names its issue as closed, with GitHub's keywords, or as Part of it; a bare mention or a longer number does not count", () => {
  assert.deepEqual(issuesNamed("gate: one ledger\n\nFixes #590\n"), [590]);
  assert.deepEqual(issuesNamed("Closes: #12, resolved #13 and fixed #14"), [12, 13, 14]);
  assert.deepEqual(issuesNamed("records: by kind\n\nPart of #547\n\nFixes #547\n"), [547], "each issue once");
  assert.deepEqual(issuesNamed("see #590, the pull request #69 and T335"), []);
  assert.deepEqual(issuesNamed("Fixes #5900"), [5900]);
  assert.ok(!issuesNamed("Fixes #5900").includes(590), "#5900 is not #590");
});

test("Fixes #N goes in a paragraph of its own, ahead of the trailers", () => {
  const trailer = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
  assert.equal(withFixes(`tasks: a thing\n\nWhy it is.\n\n${trailer}\n`, 42), `tasks: a thing\n\nWhy it is.\n\nFixes #42\n\n${trailer}\n`);
  assert.equal(withFixes(`tasks: a thing\n\n${trailer}\n  continued\nSigned-off-by: A <a@b>`, 42), `tasks: a thing\n\nFixes #42\n\n${trailer}\n  continued\nSigned-off-by: A <a@b>\n`);
  assert.equal(withFixes("tasks: a thing", 42), "tasks: a thing\n\nFixes #42\n", "a subject alone");
  assert.equal(withFixes("docs: the rule\n\nNote: a paragraph, not trailers.\nIt goes on.\n", 7), "docs: the rule\n\nNote: a paragraph, not trailers.\nIt goes on.\n\nFixes #7\n");
  assert.equal(withFixes("fix: the subject looks like one\n", 7), "fix: the subject looks like one\n\nFixes #7\n", "the subject is never a trailer block");
  assert.deepEqual(issuesNamed(withFixes(`a\n\n${trailer}`, 42)), [42]);
  assert.throws(() => withFixes("a", 0), /positive integer/);
});
