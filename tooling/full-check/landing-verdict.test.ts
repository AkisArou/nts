import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { testScratch } from "../gate/test-scratch.ts";
import { fixtureContract } from "../gate/verdict-contract-fixture.ts";
import { recordLandingFixture } from "../landing/verdict-fixture.ts";
import { verdictPath } from "../landing/verdict.ts";
import { listedIn } from "../records/pending.ts";
import { measureWithLanding } from "./landing-verdict.ts";
import { fullCheckCeiling, readSummary, verdictOf, type Measurement } from "./measure.ts";

const commit = "a".repeat(40), tree = "b".repeat(40);

function fixture(t: Parameters<typeof testScratch>[0]) {
  const home = testScratch(t, "core-landing-verdict"), measured: string[][] = [], logs: string[] = [];
  const failing = new Set<string>();
  const options = {
    home, commit, tree, contract: fixtureContract(), requested: ["build", "tests", "rustfmt", "examples"],
    evidenceRun: join(home, "evidence"), log: (line: string) => logs.push(line),
    measure: (steps: readonly string[]): Measurement => {
      assert.ok(steps.length, "an empty selector must never reach the runner");
      measured.push([...steps]);
      const run = join(home, "fresh-" + measured.length);
      mkdirSync(run);
      const outcomes = Object.fromEntries(steps.map(name => [name, failing.has(name) ? "FAIL" as const : "PASS" as const]));
      const reasons = Object.fromEntries(steps.filter(name => failing.has(name)).map(name => [name, "fixture failure"]));
      writeFileSync(join(run, "summary.json"), JSON.stringify({
        identities: { commit }, environment: { canonical: true }, requested: steps, verdict: verdictOf(outcomes), wall_s: 2,
        steps: steps.map(name => ({ name, verdict: outcomes[name], cpu: 1, wall: 2, reason: reasons[name] })),
      }));
      writeFileSync(join(run, "prepare.cpu"), "0.5 0.5 0.25\n");
      return { commit, run, steps: outcomes, reasons, verdict: verdictOf(outcomes) };
    },
  };
  return { home, measured, logs, failing, options };
}

test("the core executes deferred work and prepares release artifacts while retaining landing notices", t => {
  const f = fixture(t);
  recordLandingFixture(f.home, commit, tree, ["build", "tests", "rustfmt"], { logs: { tests:
    "pending: new-case is not recorded in results/examples.tsv yet\nimproved, record pending: better-case in results/examples.tsv: refusal -> pass\n" } });
  const result = measureWithLanding(f.options);
  assert.equal(result.verdict, "green");
  assert.deepEqual(f.measured, [["build", "examples"]]);
  assert.deepEqual(result.reused, ["tests", "rustfmt"]);
  assert.deepEqual(Object.keys(result.steps).sort(), [...f.options.requested].sort());
  assert.deepEqual(readSummary(result.run, commit, f.options.requested).steps, result.steps);
  const notices = listedIn(result.run);
  assert.equal(notices.pending[0]?.name, "new-case");
  assert.equal(notices.accepted[0]?.name, "better-case");
  const summary = JSON.parse(readFileSync(join(result.run, "summary.json"), "utf8"));
  assert.equal(summary.execution.cpu_s, 2.75);
  assert.equal(summary.execution.credited_cpu_s, 20);
  assert.equal(summary.steps.find((step: { name: string }) => step.name === "tests").cpu, 0);
  assert.equal(summary.steps.find((step: { name: string }) => step.name === "tests").origin.cpu, 10);
});

test("a fresh deferred failure remains the commit's failure beside reused passes", t => {
  const f = fixture(t);
  recordLandingFixture(f.home, commit, tree, ["tests", "rustfmt"]);
  f.failing.add("examples");
  const result = measureWithLanding(f.options);
  assert.equal(result.verdict, "red");
  assert.equal(result.steps.tests, "PASS");
  assert.equal(result.steps.examples, "FAIL");
  assert.equal(result.reasons.examples, "fixture failure");
});

test("an entirely covered probe produces its own complete summary without invoking an empty runner", t => {
  const f = fixture(t);
  recordLandingFixture(f.home, commit, tree, ["tests", "rustfmt"]);
  const requested = ["tests", "rustfmt"];
  const result = measureWithLanding({ ...f.options, requested });
  assert.deepEqual(f.measured, []);
  assert.equal(result.run, f.options.evidenceRun);
  assert.equal(result.verdict, "green");
  assert.deepEqual(readSummary(result.run, commit, requested), { steps: { tests: "PASS", rustfmt: "PASS" }, reasons: {} });
  const summary = JSON.parse(readFileSync(join(result.run, "summary.json"), "utf8"));
  assert.equal(summary.execution.cpu_s, 0);
  assert.equal(summary.execution.credited_cpu_s, 20);
});

test("missing receipts and mismatched Git or environment identity execute the whole core", t => {
  const f = fixture(t);
  measureWithLanding(f.options);
  recordLandingFixture(f.home, commit, tree, ["build", "tests", "rustfmt"]);
  measureWithLanding({ ...f.options, tree: "e".repeat(40) });
  const contract = fixtureContract();
  contract.identity = "different";
  measureWithLanding({ ...f.options, contract });
  assert.deepEqual(f.measured, [f.options.requested, f.options.requested, f.options.requested]);
  assert.ok(f.logs.some(line => line.includes("environment contract differs")));
});

test("scoped checks and a new core step remain owed", t => {
  const f = fixture(t);
  recordLandingFixture(f.home, commit, tree, ["tests", "doctests"], { doctests: "one-crate" });
  measureWithLanding({ ...f.options, requested: ["tests", "doctests", "new-step"] });
  assert.deepEqual(f.measured, [["doctests", "new-step"]]);
});

test("a short reused core never supplies a full core's wall backstop", t => {
  const f = fixture(t);
  recordLandingFixture(f.home, commit, tree, ["tests", "rustfmt"]);
  const result = measureWithLanding({ ...f.options, requested: ["tests", "rustfmt"] });
  const previous = { commit, run: result.run, at: "", verdict: "green" as const, failed: [] };
  assert.equal(fullCheckCeiling(previous, ["build", "tests"], "build\t800\t1000\t1\ntests\t1200\t4000\t8\n"), 3600);
});

test("unmeasured CPU remains unavailable in the combined accounting", t => {
  const f = fixture(t), receipt = recordLandingFixture(f.home, commit, tree, ["tests"]);
  delete receipt.steps[0]!.outcome.cpu;
  writeFileSync(verdictPath(f.home, commit), JSON.stringify(receipt));
  const result = measureWithLanding({ ...f.options, requested: ["tests"] });
  const summary = JSON.parse(readFileSync(join(result.run, "summary.json"), "utf8"));
  assert.equal(summary.execution.cpu_s, 0);
  assert.equal(summary.execution.credited_cpu_s, null);
});
