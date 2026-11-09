import assert from "node:assert/strict";
import {moduleClosure} from "../module-closure-fixture.ts";
import {oracleWorkspaceFixture} from "../../differential/oracle-workspace-fixture.ts";
import {test} from "node:test";
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {join, dirname} from "node:path";

import {fileURLToPath} from "node:url";
import {gateEnvironment, hostEnvironment} from "../canonical-environment.ts";
import {captureRunTemporary, finishRunTemporary, pruneRunTemporaries, removable} from "../run-temporary.ts";
import {instrumentPolicy} from "../step-result.ts";
import {spawnTest, waitFor} from "../test-wait.ts";
import {processActivity} from "../active-command.ts";
import {newTestScratch} from "../test-scratch.ts";
import {ownMemory} from "../test-memory.ts";

type Row = { name: string; verdict: string; reason?: string; started_at?: string;
  signal?: string | null; instrument?: { kind: string }; scope?: { slice: string; populated: number } };
type Summary = { steps: Row[]; identities?: { commit: string }; fail_fast: boolean; interrupted: string | null;
  temporary: { path: string; state: string; enclosing?: string } };
const FAIL_FAST_STOP = "NTS_GATE_FAIL_FAST: a step failed";
type Cancellation = { slice: string; signal: string; record: string; before: string; after: string; isolated: boolean };

// Use the real step scopes and drain proof. Change only this fixture's kill
// seam, after the failing trigger has been judged, to exercise SIGTERM with
// either an intact seal or a seal changed at that exact cancellation boundary.
function cancellationScope(gate: string, source: string, own: string, corrupt: boolean): void {
  const scopes = join(gate, "scopes"); mkdirSync(scopes);
  for (const name of readdirSync(join(source, "scopes"))) if (name !== "step-scope.ts") symlinkSync(join(source, "scopes", name), join(scopes, name));
  const actual = new URL("./step-scope.ts", import.meta.url).href;
  writeFileSync(join(scopes, "step-scope.ts"), `
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync, chmodSync, readFileSync, writeFileSync} from 'node:fs';
import {isAbsolute, relative, sep} from 'node:path';
import {GateScopes as ActualGateScopes} from ${JSON.stringify(actual)};
export * from ${JSON.stringify(actual)};
export class GateScopes extends ActualGateScopes {
  override step() {
    const scope=super.step(),kill=scope.kill.bind(scope),drain=scope.drain.bind(scope);
    let cancelled=false,draining=false;
    scope.drain=()=>{draining=true;return drain();};
    scope.kill=()=>{
      if(draining){
        appendFileSync(${JSON.stringify(join(own,"normal-drains.jsonl"))},JSON.stringify({slice:scope.slice})+'\\n');
        return kill();
      }
      if(cancelled)return; cancelled=true;
      const cap=JSON.parse(readFileSync(${JSON.stringify(join(own, "seal-handoff.json"))},'utf8'));
      assert.equal(cap.admission.kind,'gate');
      assert.equal(cap.admission.temporary.path,${JSON.stringify(join(own, "gate-run/tmp"))});
      const part=relative(cap.admission.temporary.path,cap.seal.record);
      assert.ok(part && !isAbsolute(part) && part!=='..' && !part.startsWith('..'+sep));
      const bytes=readFileSync(cap.seal.record),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
      const before=hash(bytes);assert.equal(before,cap.seal.readySha256);
      if(${JSON.stringify(corrupt)}){
        chmodSync(cap.seal.record,0o644);
        try{writeFileSync(cap.seal.record,Buffer.concat([bytes,Buffer.from('\\n')]));}
        finally{chmodSync(cap.seal.record,0o444);}
      }
      const after=hash(readFileSync(cap.seal.record));
      writeFileSync(${JSON.stringify(join(own, "cancellation.json"))},JSON.stringify({slice:scope.slice,signal:'SIGTERM',record:cap.seal.record,before,after,isolated:true})+'\\n');
      const result=spawnSync('systemctl',['--user','kill','--kill-whom=all','--signal=SIGTERM',scope.slice],{encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
    };
    return scope;
  }
}
`);
}

// Without fail-fast the runner terminates without a timeout: records releases
// old-paths. With it, format's failure stops old-paths and never admits records.
function runFixture(t: { after: (fn: () => void | Promise<void>) => void }, failFast: boolean, hold: boolean, escape?: "double-fork" | "outlive-leader", missing?: "DBUS_SESSION_BUS_ADDRESS" | "XDG_RUNTIME_DIR", control: { launcherFailure?: boolean; repository?: boolean; oracleCancellation?: "clean" | "seal" } = {}) {
  const own = newTestScratch("runner-stop-run");
  // A closed run temporary is an evictable cache. This fixture owns its
  // registry, so no neighbour's prune decides whether its run's files exist.
  const home = join(own, "home"), neighbor = join(own, "neighbor-home");
  mkdirSync(home); mkdirSync(neighbor);
  let planned: ReturnType<typeof gateEnvironment> | undefined;
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
    if (control.oracleCancellation && planned && existsSync(planned.temporary.path)) {
      const cleanup = finishRunTemporary(planned.temporary, planned.env.HOME!, true);
      assert.equal(cleanup.state, "removed after green", JSON.stringify(cleanup));
    }
    removable(own);rmSync(own, { recursive: true, force: true });
  });
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), target = join(own, "target"), run = join(own, "gate-run");
  mkdirSync(gate, { recursive: true });
  mkdirSync(join(target, "gate-costs"), { recursive: true });
  const source = fileURLToPath(new URL("../", import.meta.url));
  for(const file of moduleClosure(["tooling/gate/run.mjs"])){
    if(control.oracleCancellation&&file.startsWith("tooling/gate/scopes/"))continue;
    const destination=join(root,file),original=join(source,"../..",file);
    mkdirSync(dirname(destination),{recursive:true});
    if(file==="tooling/gate/run.mjs")writeFileSync(destination,readFileSync(original));
    else copyFileSync(original,destination);
  }
  if (control.oracleCancellation) {oracleWorkspaceFixture(t,root);cancellationScope(gate, source, own, control.oracleCancellation === "seal");}
  writeFileSync(join(gate, "times.tsv"), "format\t3000\t3000\t1\nold-paths\t2000\t2000\t1\nrecords\t1000\t1000\t1\n");
  const listed = spawnTest("sh", [join(source, "all.sh"), "--list"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  writeFileSync(join(own, "descendant.mjs"), `
import {readFileSync, existsSync, writeFileSync, watch} from 'node:fs';
const own=${JSON.stringify(own)},stat=readFileSync('/proc/self/stat','utf8');
process.on('SIGTERM',()=>{});
writeFileSync(own+'/escape-ready',JSON.stringify({pid:process.pid,started:Number(stat.slice(stat.lastIndexOf(')')+2).split(/\\s+/)[19])}));
const finish=()=>{if(existsSync(own+'/escape-release'))process.exit(0);};
watch(own,finish);finish();
`);
  writeFileSync(join(own,"format-descendant.mjs"),`
import {watch, writeFileSync} from 'node:fs';
const own=${JSON.stringify(own)};
watch(own,()=>{});writeFileSync(own+'/format-descendant-ready','ready');
`);
  writeFileSync(join(gate, "payload.mjs"), `
import {existsSync, watch, writeFileSync} from "node:fs";
import {spawn} from "node:child_process";
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
  if (${JSON.stringify(Boolean(control.oracleCancellation))}) writeFileSync(own+'/seal-handoff.json',process.env.NTS_ORACLE_DEPENDENCIES);
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
  if (${JSON.stringify(Boolean(control.oracleCancellation))}) {
    const child=spawn(process.execPath,[own+'/format-descendant.mjs'],{detached:true,stdio:'ignore'});
    child.unref();await until(own+'/format-descendant-ready');
  }
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
  // The mutation must never reach a capability inherited from the outer test run.
  const launcher = control.oracleCancellation ? hostEnvironment(process.env) : { ...process.env };
  launcher.HOME = home;
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
  planned = gateEnvironment(launcher, { run, ...(control.oracleCancellation ? { oracleAdmissionContext: "gate" as const,oracleRoot:root } : {}), owned: {
    NTS_GATE_STEPS: "format old-paths records", NTS_GATE_SLOTS: "2",
    ...ownMemory(join(own, "memory")), CARGO_TARGET_DIR: target, ...(failFast ? { NTS_GATE_FAIL_FAST: "1" } : {}),
  } });
  const actual = spawnTest(process.execPath, [join(gate, "run.mjs")], { cwd: root, env: planned.env, encoding: "utf8" });
  assert.equal(actual.status, 1, actual.stdout + actual.stderr);
  assert.equal(actual.signal, null);
  const summary = JSON.parse(readFileSync(join(run, "summary.json"), "utf8")) as Summary;
  // An independent red run owns its registry entry; an enclosed run shares
  // its outer lifetime. A neighbour's prune can reach neither one.
  const registry = join(home, ".cache/nts-gate/closed-temporaries");
  const closed = existsSync(registry) ? readdirSync(registry).map(name => (JSON.parse(readFileSync(join(registry, name), "utf8")) as { owned: { path: string } }).owned.path) : [];
  assert.equal(summary.temporary.enclosing, planned.temporary.enclosing?.path);
  assert.deepEqual(closed, summary.temporary.state === "retained after red" && !summary.temporary.enclosing ? [planned.temporary.path] : [], JSON.stringify(summary.temporary));
  const retained = existsSync(planned.temporary.path), other = captureRunTemporary(join(neighbor, ".cache/run"));
  finishRunTemporary(other, neighbor, false, { minimumFreeBytes: 0, maxBytes: Number.MAX_SAFE_INTEGER, write: () => {} });
  assert.deepEqual(pruneRunTemporaries(neighbor, { minimumFreeBytes: 0, maxBytes: 0, write: () => {} }).removed, [other.path]);
  assert.equal(existsSync(planned.temporary.path), retained, "an independent registry prune cannot evict this run's temporary");
  return { summary,
    admitted: existsSync(join(own, "records-started")), descendantAlive: descendantAlive(), commit,
    normalDrains: control.oracleCancellation ? readFileSync(join(own,"normal-drains.jsonl"),"utf8").trim().split("\n").map(line=>(JSON.parse(line) as {slice:string}).slice) : [],
    cancellation: control.oracleCancellation ? JSON.parse(readFileSync(join(own, "cancellation.json"), "utf8")) as Cancellation : undefined };
}

for (const arm of ["clean", "seal"] as const) test(`a fail-fast SIGTERM with ${arm === "seal" ? "a changed" : "an unchanged"} seal preserves capture-integrity precedence`, t => {
  const { summary, admitted, cancellation, normalDrains } = runFixture(t, true, false, undefined, undefined, { oracleCancellation: arm });
  t.diagnostic(JSON.stringify({ arm, admitted, cancellation, steps:summary.steps, interrupted:summary.interrupted }));
  assert.equal(admitted, false);
  assert.equal(summary.interrupted, FAIL_FAST_STOP);
  const format=summary.steps.find(row => row.name === "format")!;
  assert.equal(format.verdict,"FAIL");assert.ok(format.scope);
  assert.ok(normalDrains.includes(format.scope.slice),'the persistent format descendant must take the normal drain path');
  const cancelled = summary.steps.find(row => row.name === "old-paths")!;
  assert.ok(cancelled.scope); assert.ok(cancellation);
  assert.equal(cancelled.signal, "SIGTERM");
  assert.equal(cancelled.scope?.populated, 0);
  assert.equal(cancellation?.slice, cancelled.scope.slice);
  assert.equal(cancellation?.signal, "SIGTERM");
  assert.equal(cancellation?.isolated, true);
  if (arm === "seal") {
    assert.notEqual(cancellation.before, cancellation.after);
    assert.equal(cancelled.verdict, "INSTRUMENT");
    assert.equal(cancelled.instrument?.kind, "tooling-setup");
    assert.equal(cancelled.reason, `oracle dependency seal changed: ${cancellation.record}`);
    assert.equal(instrumentPolicy(cancelled.instrument?.kind)?.disposition === "operator-hold", true);
  } else {
    assert.equal(cancellation.before, cancellation.after);
    assert.equal(cancelled.verdict, "NOT RUN");
    assert.equal(cancelled.reason, `stopped: ${FAIL_FAST_STOP}`);
    assert.equal(cancelled.instrument, undefined);
    assert.equal(instrumentPolicy(undefined)?.disposition === "operator-hold", false);
  }
  const pending = summary.steps.find(row => row.name === "records")!;
  assert.equal(pending.verdict, "NOT RUN"); assert.equal(pending.reason, FAIL_FAST_STOP);
});

test("a launcher exiting one before scope entry is an instrument, never a completed failure", t => {
  const observed = runFixture(t, true, false, undefined, undefined, { launcherFailure: true });
  assert.equal(observed.summary.interrupted, null, "an instrument stops nothing");
  assert.equal(observed.admitted, false);
  assert.ok(observed.summary.steps.every(row => row.verdict === "INSTRUMENT"), JSON.stringify(observed.summary));
  assert.ok(observed.summary.steps.every(row => /scope entry/.test(row.reason ?? "")));
});

test("normal command exit drains its still-populated descendant subtree", t => {
  const observed = runFixture(t, false, false, "outlive-leader");
  assert.equal(observed.descendantAlive, false);
  assert.deepEqual(observed.summary.steps.map(row => row.verdict), ["FAIL", "PASS", "PASS"]);
});

test("the runner publishes the full frozen commit for retained retries", t => {
  const observed = runFixture(t, false, false, undefined, undefined, { repository: true });
  assert.match(observed.commit!, /^[a-f0-9]{40}$/);
  assert.equal(observed.summary.identities?.commit, observed.commit);
});

test("fail-fast stops a live sibling and pending work after a failure", t => {
  const { summary, admitted } = runFixture(t, true, false);
  assert.equal(admitted, false, "a completed failure must stop admission under fail-fast");
  assert.equal(summary.steps.find(row => row.name === "format")?.verdict, "FAIL");
  assert.equal(summary.fail_fast, true);
  assert.equal(summary.interrupted, FAIL_FAST_STOP);
  assert.deepEqual(summary.steps.filter(row => row.name !== "format").map(row => [row.name, row.verdict, row.reason]).sort(),
    [["old-paths", "NOT RUN", `stopped: ${FAIL_FAST_STOP}`], ["records", "NOT RUN", FAIL_FAST_STOP]]);
});

test("without fail-fast every requested step is collected", t => {
  const { summary, admitted } = runFixture(t, false, false);
  assert.equal(admitted, true);
  assert.equal(summary.interrupted, null);
  assert.deepEqual(summary.steps.map(row => row.verdict), ["FAIL", "PASS", "PASS"]);
});

test("an instrument hold never starts fail-fast cancellation", t => {
  const { summary, admitted } = runFixture(t, true, true);
  assert.equal(admitted, true);
  assert.equal(summary.interrupted, null);
  assert.deepEqual(summary.steps.map(row => row.verdict), ["INSTRUMENT", "PASS", "PASS"]);
});

for (const escape of ["double-fork", "outlive-leader"] as const) test(`fail-fast cancellation drains a ${escape} descendant before publishing its summary`, t => {
  const observed = runFixture(t, true, false, escape);
  assert.equal(observed.admitted, false);
  assert.equal(observed.descendantAlive, false, "an exited group leader cannot prove every owned descendant drained");
  assert.equal(observed.summary.interrupted, FAIL_FAST_STOP);
});

for (const missing of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"] as const) test(`missing ${missing} holds before a step can run unscoped`, t => {
  const observed = runFixture(t, true, false, undefined, missing);
  assert.equal(observed.admitted, false);
  const first = observed.summary.steps.find(row => row.name === "format")!;
  assert.equal(first.verdict, "INSTRUMENT"); assert.match(first.reason!, new RegExp(missing));
  assert.ok(observed.summary.steps.every(row => row.started_at === undefined), "there is no unscoped fallback");
});
