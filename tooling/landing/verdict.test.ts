import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { testScratch } from "../gate/test-scratch.ts";
import { fixtureContract } from "../gate/verdict-contract-fixture.ts";
import { readLandingVerdict, verdictPath, writeLandingVerdict, type LandingVerdict } from "./verdict.ts";
import type { Ran } from "./run.ts";
import type { Selection } from "./selection.ts";

const commit = "a".repeat(40), tree = "b".repeat(40);

function fixture(t: Parameters<typeof testScratch>[0]) {
  const home = testScratch(t, "landing-verdict"), run = join(home, "run"), contract = fixtureContract();
  mkdirSync(run);
  const steps = ["build", "tests", "doctests", "interop", "sample"];
  for (const name of steps) writeFileSync(join(run, name + ".log"), name === "tests" ? "pending: new-case is not recorded in results/examples.tsv yet\n" : "");
  const selection: Selection = {
    owed: [...steps, "examples"], deferred: [{ step: "examples", why: "over the budget" }],
    landing: steps.map(step => ({ step, form: step === "sample" ? "sample" : "as-is", seconds: 1, cost: { cpu: 1, measured: true, source: "fixture" } })),
    budget: { slots: 24, frontends: 24, seconds: 600 }, fits: true,
    estimate: { seconds: 2, build: 1, work: 1, longest: 1, longestStep: "tests", fixed: 2 },
  };
  const ran: Ran = { state: "green", message: "green", run, steps: steps.map(name => ({ name, verdict: "PASS", cpu: 2, wall: 1 })),
    pending: [], wall_s: 2, contract };
  const input = { commit, tree, submission: "c".repeat(40), landing: "fixture-landing", base: "d".repeat(40),
    selected: { selection, interop: "narrow-project", doctests: "narrow-crate" }, ran };
  return { home, run, contract, input };
}

test("receipts preserve actual checked-tip evidence after logs and queue state disappear", t => {
  const f = fixture(t), receipt = writeLandingVerdict(f.home, f.input)!;
  assert.equal(receipt.commit, commit);
  assert.notEqual(receipt.commit, receipt.submission);
  assert.deepEqual(receipt.steps.find(step => step.outcome.name === "tests")?.notices,
    ["pending: new-case is not recorded in results/examples.tsv yet"]);
  rmSync(f.run, { recursive: true });
  const result = readLandingVerdict(f.home, commit, tree, f.contract, ["build", "tests", "doctests", "interop", "sample", "examples"]);
  assert.deepEqual(result.reused.map(step => step.outcome.name), ["build", "tests"]);
  assert.deepEqual(result.execute, ["doctests", "interop", "sample", "examples"]);
  assert.equal(result.reason, undefined);
  assert.equal(readLandingVerdict(f.home, f.input.submission, tree, f.contract, ["tests"]).receipt, undefined);
});

test("missing, malformed and incompatible receipts execute every requested step", t => {
  const f = fixture(t), requested = ["build", "tests", "examples"];
  const assertFallback = () => {
    const result = readLandingVerdict(f.home, commit, tree, f.contract, requested);
    assert.deepEqual(result.execute, requested);
    assert.deepEqual(result.reused, []);
    assert.ok(result.reason);
  };
  assertFallback();
  const original = writeLandingVerdict(f.home, f.input)!;
  const changes: unknown[] = [
    null, { ...original, version: 2 }, { ...original, commit: "f".repeat(40) }, { ...original, tree: "f".repeat(40) },
    { ...original, contract: { ...original.contract, identity: "wrong" } },
    { ...original, profile: "release" },
    { ...original, binaries: [] },
    { ...original, steps: [{ ...original.steps[0], outcome: { ...original.steps[0]!.outcome, binaries: { nts: "wrong" } } }] },
    { ...original, steps: [...original.steps, original.steps[0]] },
    { ...original, steps: [{ ...original.steps[0], outcome: { name: "build", verdict: "FAIL" } }] },
  ];
  for (const value of changes) {
    writeFileSync(verdictPath(f.home, commit), JSON.stringify(value));
    assertFallback();
  }
  writeFileSync(verdictPath(f.home, commit), "{broken");
  assertFallback();
  writeFileSync(verdictPath(f.home, commit), JSON.stringify(original));
  const changed = fixtureContract();
  changed.identity = "changed";
  assert.deepEqual(readLandingVerdict(f.home, commit, tree, changed, requested).execute, requested);
});

test("a whole step's accepted skip and platform findings remain visible", t => {
  const f = fixture(t);
  f.input.selected.interop = "";
  f.input.ran.steps.find(step => step.name === "interop")!.verdict = "SKIPPED";
  f.input.ran.steps.find(step => step.name === "interop")!.accepted = true;
  writeFileSync(join(f.run, "interop.log"), "SKIP windows-toolchain\n");
  writeLandingVerdict(f.home, f.input);
  const result = readLandingVerdict(f.home, commit, tree, f.contract, ["interop"]);
  assert.equal(result.reused[0]?.outcome.verdict, "SKIPPED");
  assert.equal(result.reused[0]?.platforms[0]?.accepted, true);
});

test("a selected plan, canonical contract and successful outcomes are all required", t => {
  const f = fixture(t);
  for (const state of ["red", "held"] as const) {
    assert.throws(() => writeLandingVerdict(f.home, { ...f.input, ran: { ...f.input.ran, state } }), /completed green/);
  }
  f.input.ran.steps.pop();
  assert.throws(() => writeLandingVerdict(f.home, f.input), /selected steps/);
  delete f.input.ran.contract;
  assert.equal(writeLandingVerdict(f.home, f.input), undefined);
  assert.throws(() => verdictPath(f.home, "../wrong"), /full commit/);
});

test("an entirely covered plan executes nothing and new steps remain owed", t => {
  const f = fixture(t);
  writeLandingVerdict(f.home, f.input);
  assert.deepEqual(readLandingVerdict(f.home, commit, tree, f.contract, ["build", "tests"]).execute, []);
  assert.deepEqual(readLandingVerdict(f.home, commit, tree, f.contract, ["tests", "new-step"]).execute, ["new-step"]);
  const saved = JSON.parse(readFileSync(verdictPath(f.home, commit), "utf8")) as LandingVerdict;
  assert.equal(saved.profile, "nts-dev");
});
