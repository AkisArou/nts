// An inner gate run admits against the memory reading its test gives it, never
// the host's. The runner starts no new case below the floor until 14 GB is
// available (admission.ts), and inside a full gate the host can sit below it:
// an inner run reading the host then waits, silently, until the tooling
// runner's watchdog calls the file hung (canonical-environment.test.ts, in the
// train of 11-07, under a runner that admits before its first step). Every test
// that starts a real runner gives it its own reading through gateEnvironment's
// owned values, as this one does.
//
//   node --test tooling/gate/inner-gate-memory.test.ts
//
// The fixture's one step is elastic, and its case takes a gate token as every
// case does (token.sh), so the run's case admission decides whether it starts.
// **The run that is meant to wait runs in a systemd unit of its own,** and the
// test stops that unit by name: whatever the run started dies with its
// cgroup, so no waiting runner can outlive the test.
import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync} from "node:fs";
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

const GATE = fileURLToPath(new URL("./", import.meta.url));
const WAITING = /waiting for 14 GB before the first case/;

function fixture(t: TestContext) {
  const own = newTestScratch("inner-gate-memory-run");t.after(() => {removable(own);rmSync(own, {recursive:true,force:true});});
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), started = join(own, "case-started");
  // The gate's own files, with the runner copied so that it takes the fixture for its tree.
  mkdirSync(gate, { recursive: true });
  for (const file of moduleClosure(["tooling/gate/run.mjs"])) {
    const target = join(root, file), original = join(GATE, "../..", file);
    mkdirSync(dirname(target), {recursive: true});
    if (file === "tooling/gate/run.mjs") writeFileSync(target, readFileSync(original));
    else symlinkSync(original, target);
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
  const reading = (name: string, kb: number) => { const file = join(own, name); writeFileSync(file, `MemTotal: 32000000 kB\nMemAvailable: ${kb} kB\n`); return file; };
  const planned = (name: string, meminfo: string) => {
    const run = join(own, "home/.cache", name);
    return { run, env: gateEnvironment({ ...hostEnvironment(process.env), HOME: join(own, "home") },
      { run, oracleRoot:root, owned: { NTS_GATE_STEPS: "examples", NTS_BIN: compiler, CARGO_TARGET_DIR: join(own, "target"), NTS_MEMINFO: meminfo } }).env };
  };
  return { root, gate, started, reading, planned };
}

test("an inner gate run admits a case against its own ample reading", t => {
  const f = fixture(t), { run, env } = f.planned("ample", f.reading("ample", 64_000_000));
  const ran = spawnTest(process.execPath, [join(f.gate, "run.mjs")], { cwd: f.root, env, encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(JSON.parse(readFileSync(join(run, "summary.json"), "utf8")).verdict, "green");
  assert.ok(existsSync(f.started), "its case ran");
  assert.doesNotMatch(ran.stdout, WAITING);
});

test("an inner gate run whose reading is below the floor holds its case, whatever the host has, and is stopped by its unit", async t => {
  const f = fixture(t), { env } = f.planned("low", f.reading("low", 4_000_000));
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
  const stopped = spawnSync("systemctl", ["--user", "stop", `${unit}.service`], { encoding: "utf8" });
  assert.equal(stopped.status, 0, stopped.stderr);
  if (child.exitCode === null) await new Promise(resolve => child.on("close", resolve));
  const state = spawnSync("systemctl", ["--user", "is-active", `${unit}.service`], { encoding: "utf8" }).stdout.trim();
  assert.notEqual(state, "active", "nothing of the run outlives its unit");
  assert.equal(existsSync(f.started), false, "the held case never ran");
});
