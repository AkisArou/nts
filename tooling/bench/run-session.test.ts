import {gitArguments} from "../gate/git-arguments/main.ts";
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testEnvironment,fixtureEnvironment} from "../gate/test-environment.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPARATORS, COLUMNS, POLICY, parseRun, publishRun, readRuns, renderFull, sealRun, sittingDirectory } from "./run-record.ts";
import { unsharedLaunches } from "../jvm/launcher-audit.ts";
import { newTestScratch, testScratch } from "../gate/test-scratch.ts";
import { readJournal } from "./run-journal.ts";
import {fromNts,type Metadata} from './run-producers.ts';
import {createRequire} from 'node:module';
import {SourceFacts} from '../gate/source-facts.ts';
import {inspectCommandForwarders,inspectGitInvocations} from '../gate/git-observations.ts';
const script = fileURLToPath(new URL("./run-session.ts", import.meta.url));
const pin = "a".repeat(40),
  sha = "b".repeat(64);
function fixture() {
  const measurement = { ns_per_op: 100, checksum: "4000000000000000", spread: 1 };
  const metadata:Metadata = {
    schemaVersion: 1,
    id: "2026-10-29-" + pin + "-console",
    startedAt: null,
    finishedAt: null,
    complete: false,
    inventory: ["control"],
    columns: [...COLUMNS],
    sourceCommit: pin,
    compiler: { commit: pin, sha256: sha },
    harness: { identity: sha, contract: null, files: [] },
    machine: { identity: null, conditions: null },
    comparators: Object.fromEntries(COMPARATORS.map((c) => [c, null])) as Metadata['comparators'],
    verdictPolicy: POLICY,
    provenance: null,
  };
  return {
    metadata,
    cases: ["control"],
    lanes: null,
    spoiled: [],
    failed: [],
    measured: [
      {
        shown: "control",
        workload: null,
        source_capture: null,
        results: [measurement, measurement, null, measurement, measurement, null],
        absences: { outcomes: {}, jvm: null, cpp: null },
        node: measurement,
        bun: measurement,
      },
    ],
  };
}

test("journal recovery accepts only a complete ordered prefix and never an interrupted row", t => {
  const root = testScratch(t, "bench-journal"), path = join(root, "run.jsonl"), raw = fixture();
  const header = JSON.stringify({ version: 1, metadata: raw.metadata, cases: ["control", "next"], requested: [], lanes: null }) + "\n";
  const frame = JSON.stringify({ name: "control", measured: raw.measured[0], failure: null, spoiled: false, failed: [], conditions: {} }) + "\n";
  writeFileSync(path, header + frame + '{"name":"next"');
  const saved = readJournal(path);
  assert.deepEqual(saved.unreached, ["next"]);
  assert.deepEqual(saved.raw.measured, raw.measured);
  writeFileSync(path, header + frame + frame);
  assert.throws(() => readJournal(path), /out-of-order/);
  writeFileSync(path, header + frame + "{bad}\n");
  assert.throws(() => readJournal(path), SyntaxError);
  writeFileSync(path, header.slice(0, -1));
  assert.throws(() => readJournal(path), /no committed header/);
});

test('journal recovery preserves completed build CPU on a failed row and omits an unfinished row',t=>{
  const root=testScratch(t,'bench-build-journal'),path=join(root,'run.jsonl'),raw=fixture();
  const builds={version:1,stages:[{kind:'external',column:'nts C',phase:'clang compile',receipt:{version:1,command:'clang',args:['case.c'],status:125,
    waited:null,unavailable:'observer killed',sampledAtBound:{pid:71,cpu_s:604.13},reason:'used its 600 s CPU bound'}}]};
  const header={version:1,metadata:{...raw.metadata,inventory:['control','next']},cases:['control','next'],requested:[],lanes:null};
  const frame={name:'control',measured:null,failure:{kind:'build_failed',reason:'clang timed out'},spoiled:false,failed:['clang timed out'],conditions:{},builds};
  writeFileSync(path,JSON.stringify(header)+'\n'+JSON.stringify(frame)+'\n'+JSON.stringify({name:'next',builds}));
  const saved=readJournal(path);
  assert.deepEqual(saved.raw.builds,{control:builds});assert.deepEqual(saved.unreached,['next']);
  const record=fromNts(header.metadata,saved.raw);
  const first=record.rows[0],second=record.rows[1];assert.ok(first);assert.ok(second);assert.ok(first.cells['nts C']);
  assert.deepEqual(first.builds,builds);assert.equal(first.cells['nts C'].status,'BUILD_FAILED');
  assert.equal(second.builds,undefined);
});
test("actual session CLI renders a header and a typed row, and rejects the old missing-import bridge", () => {
  const root = newTestScratch("bench-session-cli");
  try {
    const input = join(root, "raw.json");
    writeFileSync(input, JSON.stringify(fixture()));
    const header = spawnSync(process.execPath, [script, "header", root], {env:testEnvironment(), encoding: "utf8" });
    assert.equal(header.status, 0, header.stderr);
    assert.ok(header.stdout.includes("nts C/node") && header.stdout.includes("nts LLVM/ScriptC"));
    const row = spawnSync(process.execPath, [script, "row", root, input], {env:testEnvironment(), encoding: "utf8" });
    assert.equal(row.status, 0, row.stderr);
    assert.match(row.stdout, /control\t/);
    assert.match(row.stdout, /1\.000× SHORT/);
    copyModuleClosure(["tooling/bench/run-session.ts"],root);
    const mutant = join(root, "tooling/bench/run-session.ts");
    const source = readFileSync(mutant, "utf8"),
      changed = source.replace(/\bconsoleHeader,\s*/g, "").replace(/\bconsoleRow,\s*/g, "");
    assert.notEqual(changed, source);
    writeFileSync(mutant, changed);
    const old = spawnSync(process.execPath, [mutant, "header", root], {env:testEnvironment(), encoding: "utf8" });
    assert.equal(old.status, 1);
    assert.match(old.stderr, /consoleHeader is not defined/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("session toolchain discovery rejects the old bare JVM launch", () => {
  const source = readFileSync(script, "utf8");
  assert.deepEqual(unsharedLaunches("tooling/bench/run-session.ts", source), []);
  const mutant = source.replace('...vmToolFlags("java"), "-version"', '"-version"');
  assert.notEqual(mutant, source);
  const findings = unsharedLaunches("tooling/bench/run-session.ts", mutant);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.tool, "java");
  assert.match(findings[0]!.code, /-version/);
});

test('session Git commands are visible to the command-first audit and use its argument owner',()=>{
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync'),api=new API();
  const source=readFileSync(script,'utf8');
  const inspect=(text:string)=>{
    const lease=api.createSourceFile(script,text);
    try{const facts=new SourceFacts('tooling/bench/run-session.ts',text,lease.sourceFile);
      return {forwarders:inspectCommandForwarders(facts),git:inspectGitInvocations(facts)};
    }finally{lease.dispose();}
  };
  try{
    const current=inspect(source);assert.deepEqual(current.forwarders,[]);
    assert.equal(current.git.length,3);assert.ok(current.git.every(row=>row.protected));
    const changed=source.replace('gitArguments(["diff", "HEAD", "--name-only"])','["diff", "HEAD", "--name-only"]')
      .replace('gitArguments(["rev-parse", "HEAD"])','["rev-parse", "HEAD"]');
    assert.notEqual(changed,source);assert.equal(inspect(changed).git.filter(row=>!row.protected).length,2);
  }finally{api.close();}
});

test("session conditions have no dependency on the old landing lock probe", t => {
  const root = testScratch(t, "bench-session-conditions"), bin = join(root, "bin"), invoked = join(root, "invoked");
  mkdirSync(bin);
  writeFileSync(join(bin, "flock"), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(invoked)}, 'invoked');process.exit(99);\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [script, "conditions", root], {
    encoding: "utf8", env: { ...fixtureEnvironment(t), PATH: `${bin}:${process.env.PATH ?? ""}` },
  });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(typeof observed.load, "string");
  assert.ok(observed.memoryAvailableBytes > 0);
  assert.equal(Object.hasOwn(observed, "landingLockHeld"), false);
  assert.equal(existsSync(invoked), false);
});

function git(root: string, args: string[]): string {
  const result = spawnSync("git", gitArguments(args), { cwd: root, env: testEnvironment(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("session sitting seals and renders its partial row without changing Git or published results", t => {
  const scratch = testScratch(t, "bench-sitting"), root = join(scratch, "tree"), destination = join(scratch, "sitting");
  mkdirSync(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Sitting control"]);
  git(root, ["config", "user.email", "control@example.invalid"]);
  writeFileSync(join(root, ".gitignore"), "target/\n");
  writeFileSync(join(root, "source.ts"), "export const value=1;\n");
  git(root, ["add", "source.ts", ".gitignore"]);
  git(root, ["commit", "-qm", "initial"]);
  const prior = sealRun({ ...fromNts(fixture().metadata, fixture()), complete: true });
  publishRun(root, prior);
  const head = git(root, ["rev-parse", "HEAD"]), index = git(root, ["ls-files", "--stage"]);
  const priorJSON = readFileSync(join(root, "results/benchmarks/runs", prior.id + ".json"), "utf8");
  const priorPage = readFileSync(join(root, "results/benchmarks/full.md"), "utf8");
  const raw = { ...fixture(), requested: ["control"] };
  raw.metadata.machine.conditions = {};
  const input = join(scratch, "raw.json"); writeFileSync(input, JSON.stringify(raw));
  const result = spawnSync(process.execPath, [script, "finish", root, input, destination], { env: testEnvironment(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Benchmark sitting retained at/);
  const files = readdirSync(destination).sort();
  assert.deepEqual(files, [prior.id + "-sitting.json", "full.md"]);
  const record = parseRun(JSON.parse(readFileSync(join(destination, files[0]!), "utf8")));
  assert.equal(record.purpose, "sitting"); assert.equal(record.complete, false);
  assert.deepEqual(parseRun(JSON.parse(JSON.stringify(record))), record);
  assert.deepEqual(record.rows, fromNts(raw.metadata, raw).rows);
  const page = readFileSync(join(destination, "full.md"), "utf8");
  assert.equal(page, renderFull(readRuns(root), [], record));
  assert.match(page, /^# Benchmark sitting/); assert.match(page, /\|control\|/);
  assert.ok(page.includes(`](${record.id}.json)`));
  // Both the public API and locked command refuse before any publication side effect.
  for (const commit of [true, false]) assert.throws(() => publishRun(root, record, commit), /cannot publish a benchmark sitting/);
  const recordScript = fileURLToPath(new URL("./run-record.ts", import.meta.url));
  for (const command of ["publish", "_publish-locked"]) {
    const refused = spawnSync(process.execPath, [recordScript, command, root, join(destination, files[0]!), "no-commit"], { env: testEnvironment(), encoding: "utf8" });
    assert.equal(refused.status, 1); assert.match(refused.stderr, /cannot publish a benchmark sitting/);
  }
  assert.equal(git(root, ["rev-parse", "HEAD"]), head);
  assert.equal(git(root, ["ls-files", "--stage"]), index);
  assert.equal(git(root, ["status", "--porcelain"]), "");
  assert.deepEqual(readdirSync(join(root, "results/benchmarks/runs")), [prior.id + ".json"]);
  assert.equal(readFileSync(join(root, "results/benchmarks/runs", prior.id + ".json"), "utf8"), priorJSON);
  assert.equal(readFileSync(join(root, "results/benchmarks/full.md"), "utf8"), priorPage);
  assert.throws(() => sittingDirectory(root, destination), /must be fresh/);
  assert.throws(() => sittingDirectory(root, join(root, "results", "sitting")), /outside the repository/);
  symlinkSync(root, join(scratch, "alias"));
  assert.throws(() => sittingDirectory(root, join(scratch, "alias", "missing", "sitting")), /outside the repository/);
  // Copying the scratch record directly into the store cannot import it either.
  writeFileSync(join(root, "results/benchmarks/runs", record.id + ".json"), JSON.stringify(record));
  assert.throws(() => readRuns(root), /cannot publish a benchmark sitting/);
});

test("sitting identity cannot lose its purpose or be assigned an unknown purpose", () => {
  const record = fromNts(fixture().metadata, fixture());
  assert.throws(() => sealRun({ ...record, purpose: "sitting" }), /identity and purpose disagree/);
  assert.throws(() => sealRun({ ...record, id: record.id + "-sitting" }), /identity and purpose disagree/);
  assert.throws(() => sealRun({ ...record, purpose: "other" }), /unknown run purpose/);
});

test("failed sitting observations remain sealed in scratch and keep the ordinary failure status", t => {
  const scratch = testScratch(t, "bench-failed-sitting"), root = join(scratch, "tree"), destination = join(scratch, "sitting");
  mkdirSync(root);
  git(root, ["init", "-q"]); git(root, ["config", "user.name", "Sitting control"]);
  git(root, ["config", "user.email", "control@example.invalid"]);
  git(root, ["commit", "--allow-empty", "-qm", "initial"]);
  const raw = { ...fixture(), requested: ["control"], measured: [], row_failures: { control: { kind: "build_failed", reason: "control build failed" } } };
  raw.metadata.machine.conditions = {};
  const input = join(scratch, "raw.json"); writeFileSync(input, JSON.stringify(raw));
  const result = spawnSync(process.execPath, [script, "finish", root, input, destination], { env: testEnvironment(), encoding: "utf8" });
  assert.equal(result.status, 1); assert.match(result.stderr, /observations retained.*control build failed/);
  const json = readdirSync(destination).find(file => file.endsWith(".json"))!;
  const record = parseRun(JSON.parse(readFileSync(join(destination, json), "utf8")));
  assert.equal(record.rows[0]!.cells["nts C"]!.status, "BUILD_FAILED");
  assert.equal(existsSync(join(root, "results")), false);
  assert.equal(git(root, ["status", "--porcelain"]), "");
});

test("sitting directory command refuses missing, empty and extra paths by name", t => {
  const root = testScratch(t, "bench-sitting-directory-cli");
  for (const args of [[], [""], ["first", "second"]]) {
    const result = spawnSync(process.execPath, [script, "sitting-directory", root, ...args], { env: testEnvironment(), encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /sitting-directory requires exactly one non-empty path/);
  }
});
