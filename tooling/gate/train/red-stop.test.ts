import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateEnvironment } from "../canonical-environment.ts";
import { spawnTest, waitFor } from "../test-wait.ts";
import { processActivity } from "../active-command.ts";
import { newTestScratch } from "../test-scratch.ts";

type Row = { name: string; verdict: string; cancelled_by?: string; reason?: string; started_at?: string };
type Summary = { steps: Row[]; identities?: { commit: string }; train_red_stop?: { trigger: string; cancelled: string[] } };

// The old runner terminates without a timeout: records releases old-paths.
// A red-stopping runner cancels old-paths and never admits records.
function runFixture(t: { after: (fn: () => void | Promise<void>) => void }, members: number, hold: boolean, escape?: "double-fork" | "outlive-leader", missing?: "DBUS_SESSION_BUS_ADDRESS" | "XDG_RUNTIME_DIR", control: { launcherFailure?: boolean; repository?: boolean } = {}) {
  const own = newTestScratch("train-red-stop-run");
  const escaped = join(own, "escape-ready");
  const descendantAlive = () => {
    if (!existsSync(escaped)) return false;
    const row = JSON.parse(readFileSync(escaped, "utf8")) as { pid: number; started: number };
    try {
      const stat = readFileSync(`/proc/${row.pid}/stat`, "utf8"), state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
      return state !== "Z" && processActivity(stat).started === row.started;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  t.after(async () => {
    writeFileSync(join(own, "escape-release"), "finish the owned control");
    await waitFor("the escaped fixture descendant to exit", () => !descendantAlive());
    rmSync(own, { recursive: true, force: true });
  });
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), target = join(own, "target"), run = join(own, "gate-run");
  mkdirSync(gate, { recursive: true });
  mkdirSync(join(target, "gate-costs"), { recursive: true });
  const source = fileURLToPath(new URL("../", import.meta.url));
  for (const name of readdirSync(source)) {
    if (name === "run.mjs") writeFileSync(join(gate, name), readFileSync(join(source, name)));
    else if (!["all.sh", "times.tsv"].includes(name)) symlinkSync(join(source, name), join(gate, name));
  }
  writeFileSync(join(gate, "times.tsv"), "format\t3000\t3000\t1\nold-paths\t2000\t2000\t1\nrecords\t1000\t1000\t1\n");
  const listed = spawnTest("sh", [join(source, "all.sh"), "--list"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  writeFileSync(join(own, "descendant.mjs"), `
import { readFileSync, existsSync, writeFileSync, watch } from 'node:fs';
const own=${JSON.stringify(own)},stat=readFileSync('/proc/self/stat','utf8');
process.on('SIGTERM',()=>{});
writeFileSync(own+'/escape-ready',JSON.stringify({pid:process.pid,started:Number(stat.slice(stat.lastIndexOf(')')+2).split(/\\s+/)[19])}));
const finish=()=>{if(existsSync(own+'/escape-release'))process.exit(0);};
watch(own,finish);finish();
`);
  writeFileSync(join(gate, "payload.mjs"), `
import { existsSync, watch, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { publishToolingFailure, ToolingInstrumentError } from ${JSON.stringify(new URL("../step-result.ts", import.meta.url).href)};
const own = ${JSON.stringify(own)};
const ready = own + "/ready", release = own + "/release";
function until(path) {
  if (existsSync(path)) return Promise.resolve();
  return new Promise(resolve => {
    const watcher = watch(own, () => { if (existsSync(path)) { watcher.close(); resolve(); } });
    if (existsSync(path)) { watcher.close(); resolve(); }
  });
}
if (process.env.NTS_GATE_STEP === "old-paths") {
  const escape=${JSON.stringify(escape)};
  if(escape){
    const path=own+'/descendant.mjs';
    const child=escape==='double-fork'
      ?spawn(process.execPath,['--input-type=module','-e','import {spawn} from "node:child_process";spawn(process.execPath,[process.argv[1]],{detached:true,stdio:"ignore"}).unref();',path],{detached:true,stdio:'ignore'})
      :spawn(process.execPath,[path],{stdio:'ignore'});
    child.unref();await until(own+'/escape-ready');
  }
  writeFileSync(ready, "ready"); await until(release);
} else if (process.env.NTS_GATE_STEP === "format") {
  await until(ready);
  if (${JSON.stringify(hold)}) publishToolingFailure(new ToolingInstrumentError("tooling-setup", "controlled instrument hold"));
  process.exitCode = 1;
} else {
  writeFileSync(own + "/records-started", "admitted"); writeFileSync(release, "released");
}
`);
  writeFileSync(join(gate, "all.sh"), `#!/bin/sh
if [ "$1" = --list ]; then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
  exec node "$(dirname "$0")/payload.mjs"
fi
`);
  const meminfo = join(own, "meminfo"); writeFileSync(meminfo, "MemAvailable: 64000000 kB\n");
  const launcher = { ...process.env };
  if (missing) delete launcher[missing];
  if (control.launcherFailure) {
    const bin = join(own, "bin"); mkdirSync(bin);
    writeFileSync(join(bin, "systemd-run"), `#!${process.execPath}
const {spawnSync}=require('node:child_process'),args=process.argv.slice(2);
if(args.some(arg=>arg.startsWith('--unit=')&&arg.endsWith('-step.scope')))process.exit(1);
const r=spawnSync('/usr/bin/systemd-run',args,{stdio:'inherit'});process.exit(r.status??1);
`, { mode: 0o755 });
    launcher.PATH = `${bin}:${launcher.PATH}`;
  }
  let commit: string | undefined;
  if (control.repository) {
    for (const args of [["init", "-q", "-b", "main"], ["add", "tooling/gate/times.tsv"],
      ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture identity"]]) {
      const result = spawnTest("git", args, { cwd: root, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
    }
    commit = spawnTest("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  }
  const planned = gateEnvironment(launcher, { run, owned: {
    NTS_GATE_STEPS: "format old-paths records", NTS_GATE_SLOTS: "2", NTS_GATE_MEM_GB: "20",
    NTS_MEMINFO: meminfo, CARGO_TARGET_DIR: target, NTS_GATE_TRAIN_MEMBERS: String(members),
  } });
  const actual = spawnTest(process.execPath, [join(gate, "run.mjs")], { cwd: root, env: planned.env, encoding: "utf8" });
  assert.equal(actual.status, 1, actual.stdout + actual.stderr);
  assert.equal(actual.signal, null);
  return { summary: JSON.parse(readFileSync(join(run, "summary.json"), "utf8")) as Summary,
    admitted: existsSync(join(own, "records-started")), descendantAlive: descendantAlive(), commit };
}

test("a launcher exiting one before scope entry is an instrument, never a completed failure", t => {
  const observed = runFixture(t, 2, false, undefined, undefined, { launcherFailure: true });
  assert.equal(observed.summary.train_red_stop, undefined);
  assert.equal(observed.admitted, false);
  assert.ok(observed.summary.steps.every(row => row.verdict === "INSTRUMENT"), JSON.stringify(observed.summary));
  assert.ok(observed.summary.steps.every(row => /scope entry/.test(row.reason ?? "")));
});

test("normal command exit drains its still-populated descendant subtree", t => {
  const observed = runFixture(t, 1, false, "outlive-leader");
  assert.equal(observed.descendantAlive, false);
  assert.deepEqual(observed.summary.steps.map(row => row.verdict), ["FAIL", "PASS", "PASS"]);
});

test("the runner publishes the full frozen commit for retained retries", t => {
  const observed = runFixture(t, 1, false, undefined, undefined, { repository: true });
  assert.match(observed.commit!, /^[a-f0-9]{40}$/);
  assert.equal(observed.summary.identities?.commit, observed.commit);
});

test("a multi-member train cancels its live sibling and pending work after a definite failure", t => {
  const { summary, admitted } = runFixture(t, 2, false);
  assert.equal(admitted, false, "a completed failure must stop admission in a multi-member train");
  assert.equal(summary.steps.find(row => row.name === "format")?.verdict, "FAIL");
  assert.equal(summary.train_red_stop?.trigger, "format");
  assert.deepEqual(summary.train_red_stop?.cancelled, ["old-paths", "records"]);
  for (const name of ["old-paths", "records"]) {
    const row = summary.steps.find(row => row.name === name);
    assert.equal(row?.verdict, "NOT RUN"); assert.equal(row?.cancelled_by, "format");
  }
});

test("a single-member landing still collects every requested step", t => {
  const { summary, admitted } = runFixture(t, 1, false);
  assert.equal(admitted, true);
  assert.equal(summary.train_red_stop, undefined);
  assert.deepEqual(summary.steps.map(row => row.verdict), ["FAIL", "PASS", "PASS"]);
});

test("an instrument hold never starts red cancellation", t => {
  const { summary, admitted } = runFixture(t, 2, true);
  assert.equal(admitted, true);
  assert.equal(summary.train_red_stop, undefined);
  assert.deepEqual(summary.steps.map(row => row.verdict), ["INSTRUMENT", "PASS", "PASS"]);
});

for (const escape of ["double-fork", "outlive-leader"] as const) test(`red cancellation drains a ${escape} descendant before publishing its proof`, t => {
  const observed = runFixture(t, 2, false, escape);
  assert.equal(observed.admitted, false);
  assert.equal(observed.descendantAlive, false, "an exited group leader cannot prove every owned descendant drained");
  assert.equal(observed.summary.train_red_stop?.trigger, "format");
});

for (const missing of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"] as const) test(`missing ${missing} holds before a step can run unscoped`, t => {
  const observed = runFixture(t, 2, false, undefined, missing);
  assert.equal(observed.admitted, false);
  assert.equal(observed.summary.train_red_stop, undefined);
  const first = observed.summary.steps.find(row => row.name === "format")!;
  assert.equal(first.verdict, "INSTRUMENT"); assert.match(first.reason!, new RegExp(missing));
  assert.ok(observed.summary.steps.every(row => row.started_at === undefined), "there is no unscoped fallback");
});
