// The task spec (spec.ts), the creation tool (new.ts) and the label sync
// (labels.ts), against the real .github/labels.json and a stand-in for gh.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrafts, draftProblems, type Draft, type Gh } from "./new.ts";
import { syncPlan } from "./labels.ts";
import { bodyProblems, labelProblems, readSpec, renderCard, REQUIRED } from "./spec.ts";

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
