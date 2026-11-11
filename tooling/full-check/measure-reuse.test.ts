import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixtureContract } from "../gate/verdict-contract-fixture.ts";
import { hostEnvironment } from "../gate/canonical-environment.ts";
import { nodeInstallation } from "../gate/toolchain-fixture.ts";
import { scratchRepo } from "../landing/scratch-repo.ts";
import { recordLandingFixture } from "../landing/verdict-fixture.ts";
import { verdictPath } from "../landing/verdict.ts";
import { pinnedGate } from "./measure.ts";
import { candidateEnvironmentFixture } from "./run-environment-fixture.ts";
import { layout } from "./state.ts";

test("the pinned core imports an exact receipt and executes the whole request when its identity differs", t => {
  const repo = scratchRepo(t, "pinned-core-reuse"), paths = layout(repo.dir);
  const installations = join(repo.dir, "installed"), home = join(repo.dir, "landing-home");
  const invocations = join(repo.dir, "executed.jsonl");
  nodeInstallation(installations, process.versions.node, join(repo.dir, "nodes.jsonl"));
  candidateEnvironmentFixture(repo.root);
  repo.git(["add", "-f", "tooling", ".tool-versions"]);
  repo.git(["commit", "-qm", "candidate environment"]);
  const commit = repo.commit({
    "tooling/gate/verdict-contract.ts": `import {writeFileSync} from 'node:fs';writeFileSync(process.argv[2],${JSON.stringify(JSON.stringify(fixtureContract()))});\n`,
    "tooling/gate/pinned.sh": `#!/bin/sh
if [ -n "$NTS_GATE_SETUP_ONLY" ]; then
  mkdir -p "$NTS_GATE_TREE"
  git archive "$1" | tar -x -C "$NTS_GATE_TREE"
  [ -e "$NTS_GATE_TREE/.git" ] || ln -s "$PWD/.git" "$NTS_GATE_TREE/.git"
  exit 0
fi
[ "$1" = --environment-ready ] && shift
exec node "$NTS_GATE_TREE/subject.ts" "$1"
`,
    "subject.ts": `import {appendFileSync,writeFileSync} from 'node:fs';
const steps=process.env.NTS_GATE_STEPS.split(' ');
appendFileSync(${JSON.stringify(invocations)},JSON.stringify(steps)+'\\n');
writeFileSync(process.env.NTS_GATE_RUN_DIR+'/summary.json',JSON.stringify({
  identities:{commit:process.argv[2]},environment:JSON.parse(process.env.NTS_GATE_ENV_CONTEXT).report,
  verdict:'green',steps:steps.map(name=>({name,verdict:'PASS',cpu:1,wall:1}))
}));\n`,
  }, "private receipt consumer");
  const tree = repo.git(["rev-parse", commit + "^{tree}"]);
  const gate = pinnedGate(paths, repo.root, () => {}, { nodeInstallations: installations, env: hostEnvironment(repo.env), landingHome: home });
  const requested = ["build", "tests", "rustfmt"];
  const run = (label: string) => {
    const result = gate.run(commit, requested, label, undefined, { reuseLanding: true });
    assert.equal(result.verdict, "green", JSON.stringify(result.reasons) + "\n" + readFileSync(join(result.run, "full-check.log"), "utf8"));
    assert.deepEqual(result.steps, { build: "PASS", tests: "PASS", rustfmt: "PASS" });
    return result;
  };
  run("missing");
  const receipt = recordLandingFixture(home, commit, tree, ["build", "tests"]);
  const matched = run("matched");
  assert.deepEqual(matched.reused, ["tests"]);
  const summary = JSON.parse(readFileSync(join(matched.run, "summary.json"), "utf8"));
  assert.equal(summary.steps.find((step: { name: string }) => step.name === "tests").origin.commit, commit);
  writeFileSync(verdictPath(home, commit), JSON.stringify({ ...receipt, tree: "e".repeat(40) }));
  run("wrong-tree");
  writeFileSync(verdictPath(home, commit), JSON.stringify({ ...receipt, contract: { ...receipt.contract, identity: "different" } }));
  run("wrong-contract");
  assert.deepEqual(readFileSync(invocations, "utf8").trim().split("\n").map(line => JSON.parse(line)), [
    requested, ["build", "rustfmt"], requested, requested,
  ]);
});
