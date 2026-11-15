import {gitArguments} from "../gate/git-arguments/main.ts";
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testEnvironment} from "../gate/test-environment.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  COMPARATORS,
  COLUMNS,
  POLICY,
  sealRun,
  parseRun,
  verdict,
  newestComplete,
  ownBest,
  results,
  renderFull,
  publishRun,
  readRuns,
  checkRecords,
  benchmarkRecordInputs,
  type Cell,
  type RunRecord,
} from "./run-record.ts";
import { newTestScratch } from "../gate/test-scratch.ts";

const pin = "a".repeat(40),
  digest = "b".repeat(64);
function ok(ns = 100): Cell {
  return {
    status: "OK",
    nanoseconds: ns,
    spread: 1,
    checksum: "4000000000000000",
    verified: true,
    reason: null,
    details: null,
  };
}
function fixture(label = "one", at = "2026-10-29T12:00:00.000Z"): RunRecord {
  const row = (name: string) => ({
    name,
    workloadIdentity: digest,
    eligibleForBest: true,
    conditions: { gateRan: false },
    cells: Object.fromEntries(COLUMNS.map((c) => [c, ok(c === "nts C" ? 80 : 100)])),
    verdicts: {},
  });
  return sealRun({
    schemaVersion: 1,
    id: "2026-10-29-" + pin + "-" + label,
    startedAt: at,
    finishedAt: at,
    complete: true,
    inventory: ["a", "b"],
    columns: [...COLUMNS],
    sourceCommit: pin,
    compiler: { commit: pin, sha256: digest },
    harness: {
      identity: digest,
      contract: "opaque-bit-input-v1",
      files: [{ path: "loop.ts", sha256: digest }],
    },
    machine: {
      identity: "host-core-4",
      conditions: { gateRan: true, load: [2, 3, 2], cpu: 4, sibling: 5 },
    },
    comparators: Object.fromEntries(
      COMPARATORS.map((c) => [c, { version: "1", commit: pin, sha256: digest, command: [c] }]),
    ),
    verdictPolicy: POLICY,
    provenance: { kind: "test" },
    rows: [row("a"), row("b")],
  });
}
function temp(): string {
  return newTestScratch("bench-record-test");
}

test('optional build details retain their CPU bases without changing historical records or verdicts',()=>{
  const old=fixture();assert.deepEqual(parseRun(JSON.parse(JSON.stringify(old))),old);
  assert.equal(Object.hasOwn(old.rows[0],'builds'),false);
  const recorded=structuredClone(old);
  recorded.rows[0].builds={version:1,stages:[
    {kind:'thread',column:'nts C',phase:'capture/prepare/emit',cpu_s:0.125,basis:'getrusage-RUSAGE_THREAD-v1; shared checker CPU excluded',complete:true},
    {kind:'external',column:'nts C',phase:'clang compile',receipt:{version:1,command:'clang',args:['-c','case.c'],status:0,reason:null,
      waited:{version:1,cpu_measure:'wait4-rusage-v1',pid:71,user_s:0.1,sys_s:0.02,wall_s:1,exit:0,signal:0,exec_errno:0},unavailable:null,sampledAtBound:null}},
    {kind:'external',column:'nts LLVM',phase:'ThinLTO link',receipt:{version:1,command:'clang++',args:['case.o'],status:125,reason:'own CPU reached 604.130 s',
      waited:null,unavailable:'observer killed before wait4 returned',sampledAtBound:{pid:72,cpu_s:604.13}}},
  ]};
  const parsed=parseRun(JSON.parse(JSON.stringify(recorded)));
  assert.deepEqual(parsed.rows[0].builds,recorded.rows[0].builds);
  assert.deepEqual(parsed.rows.map(row=>row.verdicts),old.rows.map(row=>row.verdicts));
  const page=renderFull([parsed]);
  assert.match(page,/RUSAGE_THREAD; shared checker CPU excluded/);assert.match(page,/wait4; user/);
  assert.match(page,/final waited CPU unavailable/);assert.match(page,/604\.130 CPU s sampled at bound/);
  const malformed=structuredClone(recorded);malformed.rows[0].builds!.version=2 as 1;
  assert.throws(()=>parseRun(malformed),/build details/);
});
function git(root: string, args: string[]): string {
  const r = spawnSync("git", gitArguments(args), {env:testEnvironment(), cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test("policy v1 reproduces every boundary and records the authority", () => {
  const row = fixture().rows[0];
  for (const [ns, kind] of [
    [80, "WON"],
    [80.001, "SHORT"],
    [100, "SHORT"],
    [100.001, "LOSS"],
  ] as const) {
    row.cells["nts C"] = ok(ns);
    row.cells["nts LLVM"] = ok(1000);
    row.cells["nts JVM"] = ok(1000);
    assert.equal(verdict(row, "nts C", "node").kind, kind);
    assert.equal(verdict(row, "nts C", "Bun JIT").kind, kind);
  }
  for (const [ns, kind] of [
    [94.999, "WON"],
    [95, "TIE"],
    [105, "TIE"],
    [105.001, "LOSS"],
  ] as const) {
    row.cells["nts C"] = ok(ns);
    assert.equal(verdict(row, "nts C", "Bun AOT").kind, kind);
    assert.equal(verdict(row, "nts C", "ScriptC").kind, kind);
  }
  row.cells["Bun AOT"].spread = 1.2;
  row.cells["nts C"] = ok(115);
  assert.equal(verdict(row, "nts C", "Bun AOT").kind, "TIE");
  assert.equal(POLICY.authority, "docs/README.md#the-bar");
});

test("missing/duplicate/orphan rows and columns, malformed cells and mutated verdicts fail closed", () => {
  const run = fixture();
  assert.deepEqual(parseRun(run), run);
  const mutations = [
    (r: any) => r.rows.pop(),
    (r: any) => r.rows.push(r.rows[0]),
    (r: any) => (r.rows[0].name = "orphan"),
    (r: any) => delete r.rows[0].cells.node,
    (r: any) => (r.rows[0].cells.node.status = "mystery"),
    (r: any) => (r.rows[0].cells.node.nanoseconds = -1),
    (r: any) => (r.rows[0].cells.node.checksum = "0000000000000000"),
    (r: any) => (r.rows[0].cells.node.checksum = null),
    (r: any) => (r.rows[0].verdicts["nts C"].node.kind = "LOSS"),
    (r: any) => (r.verdictPolicy.version = 2),
    (r: any) => (r.verdictPolicy.authority = "somewhere-else"),
    (r: any) => (r.surprise = true),
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(run);
    mutate(changed);
    assert.throws(() => parseRun(changed));
  }
});

test("newest complete does not borrow missing cells from a later partial run", () => {
  const old = fixture("complete"),
    partial = fixture("partial", "2026-10-29T13:00:00.000Z");
  partial.complete = false;
  partial.rows.pop();
  assert.deepEqual(parseRun(partial), partial);
  assert.equal(newestComplete([old, partial])?.id, old.id);
  const text = renderFull([old, partial]);
  assert.ok(text.includes(old.id));
  assert.ok(!text.includes(partial.id));
});

test("own best excludes invalid, unverified, different workload and different harness records", () => {
  const current = fixture("current", "2026-10-29T13:00:00.000Z"),
    good = fixture("good");
  good.rows[0].cells["nts LLVM"] = ok(40);
  const bad = fixture("invalid");
  bad.rows[0].cells["nts C"] = {
    status: "INVALID",
    nanoseconds: null,
    spread: null,
    checksum: null,
    verified: false,
    reason: "timing hoisted",
    details: null,
  };
  bad.rows[0].eligibleForBest = false;
  const foreign = fixture("foreign");
  foreign.rows[0].cells["nts C"] = ok(1);
  foreign.rows[0].workloadIdentity = "c".repeat(64);
  const incompatible = fixture("incompatible");
  incompatible.harness.contract = "old-unconsumed-loop";
  incompatible.rows[0].cells["nts C"] = ok(1);
  const legacy = fixture("legacy");
  legacy.rows[0].cells["nts C"] = { ...ok(1), verified: false, checksum: null, spread: null };
  legacy.rows[0].eligibleForBest = false;
  const best = ownBest(current, current.rows[0], "nts LLVM", "node", [
    good,
    bad,
    foreign,
    incompatible,
    legacy,
    current,
  ]);
  assert.equal(best?.backendNanoseconds, 40);
  assert.equal(best?.ratio, 0.4);
  assert.equal(best?.backend, "nts LLVM");
  assert.equal(best?.run, good.id);
  assert.equal(ownBest(current, current.rows[1], "nts C", "node", [good, current])?.backendNanoseconds, 80);
});

test("slower-than-best flag stays beside current timing and all best provenance", () => {
  const old = fixture("old"),
    current = fixture("current", "2026-10-29T13:00:00.000Z");
  old.rows[0].cells["nts C"] = ok(40);
  const rendered = renderFull([old, current]);
  assert.match(rendered, /SLOWER THAN BEST/);
  assert.match(rendered, /80\.0 ns/);
  assert.match(rendered, /node: 0\.800000×; best 0\.400000×; change 2\.00000×/);
  assert.ok(rendered.includes(old.id));
  assert.ok(rendered.includes(pin));
  assert.match(rendered, /Verdict policy v1/);
  assert.match(rendered, /node: 2 WON/);
});

test("full.md shows each declared group together with its standing, and the rest as ungrouped", () => {
  const rendered = renderFull([fixture()], [
    { name: "alpha", pages: ["docs/foundations/objects.md"], rows: ["b"] },
    { name: "absent", pages: ["docs/foundations/hashing.md"], rows: ["not-in-run"] },
  ]);
  const alphaAt = rendered.indexOf("## alpha"), ungroupedAt = rendered.indexOf("## Ungrouped");
  assert.ok(alphaAt >= 0 && ungroupedAt > alphaAt, rendered);
  assert.ok(!rendered.includes("## absent"), "a group with no row in the run is not rendered");
  assert.match(rendered, /## alpha\n\nDeclared by \[docs\/foundations\/objects\.md\]\(\.\.\/\.\.\/docs\/foundations\/objects\.md\)\./);
  const inAlpha = rendered.slice(alphaAt, ungroupedAt), inUngrouped = rendered.slice(ungroupedAt);
  assert.match(inAlpha, /^\|b\|/m);
  assert.ok(!/^\|a\|/m.test(inAlpha), inAlpha);
  assert.match(inAlpha, /- \*\*nts C\*\*: node: 1 WON;/);
  assert.match(inUngrouped, /No foundation page names these rows\./);
  assert.match(inUngrouped, /^\|a\|/m);
  assert.ok(!/^\|b\|/m.test(inUngrouped), inUngrouped);
});

test("immutable publication refuses overwrite and renders latest complete, including beside-gate conditions", () => {
  const root = temp();
  try {
    const run = fixture(),
      path = publishRun(root, run, false),
      original = readFileSync(path, "utf8");
    assert.equal(readRuns(root).length, 1);
    assert.equal(publishRun(root, run, false), path);
    assert.equal(readFileSync(path, "utf8"), original);
    const changed = fixture();
    changed.rows[0].cells["nts C"] = ok(70);
    const sealed = sealRun(changed);
    assert.throws(() => publishRun(root, sealed, false), /immutable run already exists/);
    assert.match(readFileSync(join(root, "results/benchmarks/full.md"), "utf8"), /gateRan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a results-only commit never sweeps unrelated index contents", () => {
  const root = temp();
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "Record control"]);
    git(root, ["config", "user.email", "control@example.invalid"]);
    writeFileSync(join(root, "source.ts"), "export const value=1;\n");
    git(root, ["add", "source.ts"]);
    git(root, ["commit", "-qm", "initial"]);
    const run = fixture();
    publishRun(root, run, true);
    assert.deepEqual(git(root, ["show", "--pretty=", "--name-only", "HEAD"]).split("\n").sort(), [
      "results/benchmarks/full.md",
      "results/benchmarks/runs/" + run.id + ".json",
    ]);
    writeFileSync(join(root, "source.ts"), "export const value=2;\n");
    git(root, ["add", "source.ts"]);
    assert.throws(() => publishRun(root, fixture("next"), true), /clean index/);
    assert.equal(git(root, ["diff", "--cached", "--name-only"]), "source.ts");
    assert.equal(readRuns(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two concurrent producers serialize publication and render the newest complete run", async () => {
  const root = temp();
  try {
    const inputs = [fixture("first"), fixture("second", "2026-10-29T14:00:00.000Z")];
    const script = fileURLToPath(new URL("./run-record.ts", import.meta.url));
    const children = inputs.map((run, index) => {
      const file = join(root, index + ".json");
      writeFileSync(file, JSON.stringify(run));
      const child = spawn(process.execPath, [script, "publish", root, file, "no-commit"], {env:testEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (b) => (stderr += b));
      return new Promise<void>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (status) => (status === 0 ? resolve() : reject(new Error(stderr))));
      });
    });
    await Promise.all(children);
    assert.equal(readRuns(root).length, 2);
    assert.match(readFileSync(join(root, "results/benchmarks/full.md"), "utf8"), /second/);
    assert.equal(
      readdirSync(join(root, "results/benchmarks/runs")).filter((f) => f.endsWith(".tmp")).length,
      0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Fixture members are checked before their values are used. */
function present<T>(value:T|undefined):T {assert.ok(value!==undefined);return value;}

test('uniform load changes no own-best ratio, while an nts-only slowdown names its row and comparator',()=>{
  const old=fixture('ratio-old'),current=fixture('ratio-current','2026-10-29T13:00:00.000Z');
  for(const row of current.rows)for(const cell of Object.values(row.cells))if(cell.nanoseconds!==null)cell.nanoseconds*=3;
  const uniform=results([old,sealRun(current)])!;
  assert.ok(uniform.rows.every(row=>Object.values(row.backends).every(backend=>!backend.slowerThanBest)));
  assert.ok(!renderFull([old,sealRun(current)]).includes('**SLOWER THAN BEST**'));
  present(present(current.rows[0]).cells['nts C']).nanoseconds!*=1.5;
  const changed=results([old,sealRun(current)])!,comparison=present(changed.rows[0]).backends['nts C'].ownBest.node!;
  assert.ok(Math.abs(comparison.relativeRatio-1.5)<1e-12);assert.equal(comparison.slowerThanBest,true);assert.equal(comparison.best.comparator,'node');
  assert.equal(present(changed.rows[0]).backends['nts LLVM'].slowerThanBest,false);assert.equal(present(changed.rows[1]).backends['nts C'].slowerThanBest,false);
  assert.match(renderFull([old,sealRun(current)]),/node: .*\*\*SLOWER THAN BEST\*\*/);
});

test('ratio uncertainty compounds all four named spreads from the two runs',()=>{
  const old=fixture('spread-old'),current=fixture('spread-current','2026-10-29T13:00:00.000Z');
  present(present(old.rows[0]).cells['nts C']).spread=1.03;present(present(current.rows[0]).cells['nts C']).spread=1.01;
  for(const comparator of COMPARATORS){present(present(old.rows[0]).cells[comparator]).spread=1.04;present(present(current.rows[0]).cells[comparator]).spread=1.02;}
  present(present(current.rows[0]).cells['nts C']).nanoseconds=80*1.08;
  const bounded=present(results([old,sealRun(current)])!.rows[0]).backends['nts C'].ownBest.node!;
  assert.deepEqual(bounded.spreads,{currentBackend:1.01,currentComparator:1.02,priorBackend:1.03,priorComparator:1.04});
  assert.equal(bounded.spreadProduct,1.01*1.02*1.03*1.04);assert.equal(bounded.tolerance,bounded.spreadProduct);assert.equal(bounded.slowerThanBest,false);
  present(present(current.rows[0]).cells['nts C']).nanoseconds=80*1.12;
  assert.equal(present(results([old,sealRun(current)])!.rows[0]).backends['nts C'].ownBest.node?.slowerThanBest,true);
  assert.ok(renderFull([old,sealRun(current)]).includes('noise 1.01000 · 1.02000 · 1.03000 · 1.04000'));
});

test('one comparator speeding up is visible but is not a backend regression',()=>{
  const old=fixture('node-old'),current=fixture('node-current','2026-10-29T13:00:00.000Z');
  present(present(current.rows[0]).cells.node).nanoseconds=50;
  const backend=present(results([old,sealRun(current)])!.rows[0]).backends['nts C'];
  assert.equal(backend.ownBest.node?.slowerThanBest,true);
  assert.equal(backend.ownBest['Bun JIT']?.slowerThanBest,false);
  assert.equal(backend.slowerThanBest,false);
});

test('a comparator without history does not vote against an established regression',()=>{
  const old=fixture('one-established-old'),current=fixture('one-established-current','2026-10-29T13:00:00.000Z');
  for(const comparator of COMPARATORS)if(comparator!=='node')present(old.rows[0]).cells[comparator]={status:'NOT_PROVIDED',nanoseconds:null,spread:null,checksum:null,verified:false,reason:'no prior timing',details:null};
  present(present(current.rows[0]).cells['nts C']).nanoseconds=120;
  const backend=present(results([sealRun(old),sealRun(current)])!.rows[0]).backends['nts C'];
  assert.equal(Object.values(backend.ownBest).filter(value=>value!==null).length,1);
  assert.equal(backend.slowerThanBest,true);
});

test('missing or unverified comparator timings never fall back to absolute time',()=>{
  const old=fixture('missing-old'),current=fixture('missing-current','2026-10-29T13:00:00.000Z');
  present(present(current.rows[0]).cells['nts C']).nanoseconds=8000;
  for(const comparator of COMPARATORS)present(current.rows[0]).cells[comparator]={status:'NOT_PROVIDED',nanoseconds:null,spread:null,checksum:null,verified:false,reason:'private missing comparator',details:null};
  const result=present(results([old,sealRun(current)])!.rows[0]).backends['nts C'];
  assert.ok(Object.values(result.ownBest).every(value=>value===null));assert.equal(result.slowerThanBest,false);
  present(current.rows[0]).cells.node=ok(100);present(old.rows[0]).cells.node={...ok(100),verified:false,checksum:null,spread:null};
  assert.equal(ownBest(current,present(current.rows[0]),'nts C','node',[old]),null);
});

test('each comparator keeps its own prior best and current or future runs cannot supply history',()=>{
  const old=fixture('prior'),other=fixture('prior-other','2026-10-29T12:30:00.000Z'),current=fixture('present','2026-10-29T13:00:00.000Z');
  present(old.rows[0]).cells.node=ok(200);present(other.rows[0]).cells['Bun JIT']=ok(400);
  const future=fixture('future','2026-10-29T14:00:00.000Z');present(future.rows[0]).cells['nts C']=ok(1);future.complete=false;
  const found=present(results([old,other,current,future])!.rows[0]).backends['nts C'].ownBest;
  assert.equal(found.node?.best.run,old.id);assert.equal(found['Bun JIT']?.best.run,other.id);
  assert.equal(ownBest(current,present(current.rows[0]),'nts C','node',[current,future]),null);
});

test("native verdicts and own-best never borrow the other backend's faster observation", () => {
  const old = fixture("old-native"),
    current = fixture("new-native", "2026-10-29T13:00:00.000Z");
  present(old.rows[0]).cells["nts C"] = ok(1);
  present(old.rows[0]).cells["nts LLVM"] = ok(110);
  present(current.rows[0]).cells["nts C"] = ok(70);
  present(current.rows[0]).cells["nts LLVM"] = ok(120);
  const sealed = sealRun(current);
  assert.equal(present(sealed.rows[0]).verdicts["nts C"].node.kind, "WON");
  assert.equal(present(sealed.rows[0]).verdicts["nts LLVM"].node.kind, "LOSS");
  assert.equal(ownBest(sealed, present(sealed.rows[0]), "nts LLVM", "node", [old, sealed])?.backendNanoseconds, 110);
  const output = renderFull([old, sealed]);
  assert.match(output, /LLVM TRAILS C/);
  assert.match(output, /\*\*nts C\*\*/);
  assert.match(output, /\*\*nts LLVM\*\*/);
});

test("record check catches corruption, edited rendering and a missing committed run", () => {
  const root = temp();
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.invalid"]);
    git(root, ["config", "user.name", "record control"]);
    writeFileSync(join(root, "README"), "fixture\n");
    git(root, ["add", "README"]);
    git(root, ["commit", "-qm", "fixture"]);
    const path = publishRun(root, fixture("gate"));
    assert.equal(checkRecords(root).runs, 1);
    const original = readFileSync(path, "utf8"),
      fullPath = join(root, "results/benchmarks/full.md"),
      full = readFileSync(fullPath, "utf8");
    const supplied = {...benchmarkRecordInputs(root), table: join(root, "private-table.md")};
    writeFileSync(supplied.table, full);
    writeFileSync(fullPath, "the caller selected a different table\n");
    assert.equal(checkRecords(root, supplied).runs, 1, "the reader consumes its caller's locations");
    assert.throws(() => checkRecords(root), /shared renderer/);
    writeFileSync(fullPath, full);
    const corrupted = JSON.parse(original);
    corrupted.rows[0].verdicts["nts C"].node.kind = "LOSS";
    writeFileSync(path, JSON.stringify(corrupted));
    assert.throws(() => checkRecords(root), /recorded verdict/);
    writeFileSync(path, original);
    writeFileSync(fullPath, full + "hand edit\n");
    assert.throws(() => checkRecords(root), /shared renderer/);
    writeFileSync(fullPath, full);
    rmSync(path);
    assert.throws(() => checkRecords(root), /missing immutable/);
    writeFileSync(path, original);
    // A valid re-sealing and matching regenerated page cannot rewrite committed evidence.
    corrupted.rows[0].cells["nts C"].nanoseconds = 70;
    const forged = sealRun(corrupted);
    writeFileSync(path, JSON.stringify(forged, null, 2) + "\n");
    writeFileSync(fullPath, renderFull([forged]));
    assert.throws(() => checkRecords(root), /immutable.*rewritten/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a caller's run store owns both its observations and immutable history", () => {
  const root = temp();
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.invalid"]);
    git(root, ["config", "user.name", "record control"]);
    writeFileSync(join(root, "README"), "fixture\n");
    git(root, ["add", "README"]);
    git(root, ["commit", "-qm", "fixture"]);
    const unrelated = publishRun(root, fixture("default-store"));
    const directory = "observations [private]/café runs";
    const inputs = {runs: join(root, directory), table: join(root, "private-table.md")};
    mkdirSync(inputs.runs, {recursive: true});
    const original = fixture("selected-store"), path = join(inputs.runs, original.id + ".json");
    const bytes = JSON.stringify(original, null, 2) + "\n";
    writeFileSync(path, bytes);
    writeFileSync(inputs.table, renderFull([original]));
    git(root, ["add", "--", directory, "private-table.md"]);
    git(root, ["commit", "-qm", "selected store"]);
    rmSync(unrelated);
    assert.equal(checkRecords(root, inputs).runs, 1, "unrelated default history does not decide this store");
    const changed = structuredClone(original);
    changed.rows[0]!.cells["nts C"]!.nanoseconds = 70;
    const rewritten = sealRun(changed);
    writeFileSync(path, JSON.stringify(rewritten, null, 2) + "\n");
    writeFileSync(inputs.table, renderFull([rewritten]));
    assert.throws(() => checkRecords(root, inputs), /immutable benchmark run was rewritten/);
    writeFileSync(path, bytes);
    writeFileSync(inputs.table, renderFull([original]));
    assert.equal(checkRecords(root, inputs).runs, 1);
    rmSync(path);
    assert.throws(() => checkRecords(root, inputs), /missing immutable benchmark run/);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test("the real check CLI detects a one-change renderer drift", () => {
  const root = temp();
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.invalid"]);
    git(root, ["config", "user.name", "record control"]);
    writeFileSync(join(root, "README"), "fixture\n");
    git(root, ["add", "README"]);
    git(root, ["commit", "-qm", "fixture"]);
    for(const input of ["docs/foundations","results/benchmarks/runs"])mkdirSync(join(root,input),{recursive:true});
    copyModuleClosure(["tooling/bench/run-record.ts"],root,{dataNamespaces:{"docs/foundations":"renderer drift control"}});
    writeFileSync(join(root,"docs/primitives.md"),"fixture\n");
    assert.deepEqual(readdirSync(join(root,"results/benchmarks/runs")),[]);
    publishRun(root, fixture("renderer"));
    const implementation = fileURLToPath(new URL("./run-record.ts", import.meta.url));
    const mutant=join(root,"tooling/bench/run-record.ts"),source=readFileSync(mutant,"utf8");
    assert.ok(source.includes("# Benchmark results"));
    writeFileSync(mutant, source.replaceAll("# Benchmark results", "# Drifted benchmark results"));
    const good = spawnSync(process.execPath, [implementation, "check", root], {env:testEnvironment(), encoding: "utf8" });
    assert.equal(good.status, 0, good.stderr);
    const bad = spawnSync(process.execPath, [mutant, "check", root], {env:testEnvironment(), encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /shared renderer/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
