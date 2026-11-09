// An inner gate run is admitted by the memory reading and the memory ledger its
// test gives it, never the host's memory or the machine's queue. A run waits in
// the ledger (memory-ledger.ts) until its first block of memory fits, and
// inside a full gate the host can sit low: an inner run reading the host, or
// queueing behind the machine's own jobs, then waits, silently, until the
// tooling runner's watchdog calls the file hung (canonical-environment.test.ts,
// in the landing run of 11-07, under a runner that admits before its first
// step). Every test that starts a real runner gives it its own reading and
// ledger through gateEnvironment's owned values, as this one does.
//
//   node --test tooling/gate/inner-gate-memory.test.ts
//
// The fixture's one step is elastic, and its case takes a gate token as every
// case does (token.sh), so the run's memory decides whether it starts.
// **The run that is meant to wait runs in a systemd unit of its own,** and the
// test stops that unit by name: whatever the run started dies with its
// cgroup, so no waiting runner can outlive the test.
import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync} from "node:fs";
import {join, dirname} from "node:path";

import {createInterface} from "node:readline";
import {test, type TestContext} from "node:test";
import {fileURLToPath} from "node:url";
import {gateEnvironment, hostEnvironment} from "./canonical-environment.ts";
import {moduleClosure} from "./module-closure-fixture.ts";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {removable} from "./run-temporary.ts";
import {spawnTest} from "./test-wait.ts";
import {newTestScratch} from "./test-scratch.ts";
import {ownMemory} from "./test-memory.ts";
import {readLedger} from "./memory-ledger.ts";

const GATE = fileURLToPath(new URL("./", import.meta.url));
const WAITING = /memory: gate run .* waits for 1\.0 GiB \(agent\)/;

function fixture(t: TestContext) {
  const own = newTestScratch("inner-gate-memory-run");t.after(() => {removable(own);rmSync(own, {recursive:true,force:true});});
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), started = join(own, "case-started");
  // The gate's own files, with the runner copied so that it takes the fixture for its tree.
  mkdirSync(gate, { recursive: true });
  for (const file of moduleClosure(["tooling/gate/run.mjs"])) {
    const target = join(root, file), original = join(GATE, "../..", file);
    mkdirSync(dirname(target), {recursive: true});
    if (file === "tooling/gate/run.mjs") writeFileSync(target, readFileSync(original));
    else copyFileSync(original, target);
  }
  oracleWorkspaceFixture(t,root);
  symlinkSync(join(GATE, "times.tsv"), join(gate, "times.tsv"));
  // The stand-in shell executes this declared runtime asset.
  symlinkSync(join(GATE, "token.sh"), join(gate, "token.sh"));
  const listed = spawnTest("sh", [join(GATE, "all.sh"), "--list"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  // The step's one case holds a token while it runs.
  writeFileSync(join(gate, "all.sh"), `#!/bin/sh
if [ "$1" = --list ]; then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
elif [ "$2" = program-oracles ]; then
  node --input-type=module -e 'import {createProgramOracleResults} from ${JSON.stringify(new URL("../differential/oracle-results.ts",import.meta.url).href)};import {programOracleDirectory} from ${JSON.stringify(new URL("../differential/oracle-result-scope.ts",import.meta.url).href)};import {oracleRecipeIdentity} from ${JSON.stringify(new URL("../differential/oracle-emit.ts",import.meta.url).href)};import {join} from "node:path";createProgramOracleResults(join(programOracleDirectory(),"results"),oracleRecipeIdentity()).publish();'
else
  exec bash "$(dirname "$0")/token.sh" touch ${JSON.stringify(started)}
fi
`);
  const compiler = join(own, "nts"); writeFileSync(compiler, "controlled compiler identity\n");
  const planned = (name: string, availableKiB: number) => {
    const run = join(own, "home/.cache", name), memory = ownMemory(join(own, name), { availableKiB, totalKiB: 32_000_000 });
    return { run, memory, env: gateEnvironment({ ...hostEnvironment(process.env), HOME: join(own, "home") },
      { run, oracleRoot:root, owned: { NTS_GATE_STEPS: "examples", NTS_BIN: compiler, CARGO_TARGET_DIR: join(own, "target"), ...memory } }).env };
  };
  return { root, gate, started, planned };
}

test("an inner gate run admits a case against its own ample reading", t => {
  const f = fixture(t), { run, env } = f.planned("ample", 30_000_000);
  const ran = spawnTest(process.execPath, [join(f.gate, "run.mjs")], { cwd: f.root, env, encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(JSON.parse(readFileSync(join(run, "summary.json"), "utf8")).verdict, "green");
  assert.ok(existsSync(f.started), "its case ran");
  assert.doesNotMatch(ran.stdout, WAITING);
});

test("an inner gate run whose reading has no room for it waits in its own ledger, whatever the host has, and is stopped by its unit", async t => {
  // 2.5 GiB available, 2 of them kept for the system: not one block.
  const f = fixture(t), { env, memory } = f.planned("low", 2.5 * 2 ** 20);
  const unit = `nts-test-inner-gate-memory-${randomUUID().slice(0, 8)}`;
  t.after(() => { spawnSync("systemctl", ["--user", "stop", `${unit}.service`], { stdio: "ignore" }); });
  const setenv = Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([name, value]) => `--setenv=${name}=${value}`);
  // Should the run not end on SIGTERM, systemd escalates to SIGKILL after five
  // seconds rather than its default ninety.
  const child = spawn("systemd-run", ["--user", `--unit=${unit}`, "--collect", "--quiet", "--pipe", "-p", "LimitCORE=0", "-p", "TimeoutStopSec=5s",
    `--working-directory=${f.root}`, ...setenv, process.execPath, join(f.gate, "run.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
  // The event, not a timer: the run says it waits, or it ends.
  const waiting = await new Promise<boolean>(resolve => {
    const seen = (line: string) => { if (WAITING.test(line)) resolve(true); };
    createInterface({ input: child.stdout }).on("line", seen);
    createInterface({ input: child.stderr }).on("line", seen);
    child.on("close", () => resolve(false));
  });
  assert.ok(waiting, "the run waits for memory its reading does not show");
  assert.equal(existsSync(f.started), false, "no case started while it waits");
  assert.equal(readLedger(memory.NTS_MEMORY_LEDGER).waiting.length, 1, "it waits in its own ledger, not the machine's");
  const stopped = spawnSync("systemctl", ["--user", "stop", `${unit}.service`], { encoding: "utf8" });
  assert.equal(stopped.status, 0, stopped.stderr);
  if (child.exitCode === null) await new Promise(resolve => child.on("close", resolve));
  const state = spawnSync("systemctl", ["--user", "is-active", `${unit}.service`], { encoding: "utf8" }).stdout.trim();
  assert.notEqual(state, "active", "nothing of the run outlives its unit");
  assert.equal(existsSync(f.started), false, "the held case never ran");
});
