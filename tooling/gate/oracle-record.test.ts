import { after, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { addRecord, canonicalDriver, completeRows, noOracleRecord, oracleUnplannedRevision, planAll, recordAll, runOracleArm, STDERR_TAIL_BYTES, validateSourcePlan } from "../differential/record-oracles.ts";
import { parseShard, readRecords } from "../differential/oracle-records.ts";
import { oracleExecutionLimits } from "../differential/oracle-execution.ts";
import { fileURLToPath } from "node:url";
import {testScratch} from './test-scratch.ts';
import {OracleCompileBudgetError} from '../differential/oracle-batch.ts';
import {CaseBudgetError} from './step-result.ts';
import {closeMemoryRun} from '../census/worker-memory.ts';
import {ORACLE_HEAP_FLAGS} from '../differential/oracle-execution.ts';
import {ORACLE_EXECUTION_POLICY} from '../differential/oracle-execution-policy.ts';
import {gateEnvironment,hostEnvironment} from './canonical-environment.ts';
import {ownMemory} from './test-memory.ts';
import {spawnTest} from './test-wait.ts';
import {toolingSlice,toolingSliceArgs} from './tooling-slice.ts';
after(closeMemoryRun);
const plan = { version: 1, backend: "c", source: "fixture.ts", entry: "/fixture.ts", source_digest: "source-digest", seed: null,
  generator_version: 1, generator_digest: "generator", case_key: "key", case_count: 2,
  cases: ["f 0 [0.0]", "f 1 [-0.0]"], signature: [], driver: "", resolver: "" };
test("only full protocol completion can be recorded", () => {
  assert.deepEqual(completeRows("one\ntwo\ndone 2\n", 2), ["one", "two"]);
  for (const text of ["one\n", "one\ndone 1\n", "one\ndone 2\n", "one\ntwo\n"]) {
    assert.throws(() => completeRows(text, 2), /not measured/);
  }
});
test("recording merges backend signatures and refuses reduced coverage or inadequate CPU margin", () => {
  const table = addRecord({ version: 1, rows: [] }, plan, [1, 2], 2);
  assert.equal(table.rows[0].count, 2);
  assert.throws(() => addRecord(table, plan, [1, 2], 1), /schema/);
  assert.equal(table.rows[0].cases_sha256, createHash("sha256").update(JSON.stringify(plan.cases)).digest("hex"));
  assert.throws(() => addRecord(table, { ...plan, case_key: "new", case_count: 1, cases: [plan.cases[0]] }, [1, 2], 1), /lower/);
  assert.throws(() => addRecord(table, plan, [7.6, 1], 2), /twice/);
  const next = addRecord(table, { ...plan, case_key: "new" }, [1, 2], 2);
  assert.equal(next.rows.length, 1);
  assert.equal(next.rows[0].keys.c, "new");
  const shared = addRecord(next, { ...plan, backend: "llvm", case_key: "llvm-key" }, [1, 2], 2);
  assert.equal(shared.rows.length, 1);
  assert.equal(shared.rows[0].keys.llvm, "llvm-key");
  assert.equal(addRecord(shared, { ...plan, signature: ["different"] }, [2, 2], 2).rows.length, 2);
});

test("checked-in fixture records promise complete measured identities", () => {
  const index = readRecords(fileURLToPath(new URL("../..", import.meta.url)));
  const jsx = index.rows.find((row: { source: string }) => row.source === "tests/programs/jsx/src/main.tsx");
  assert.ok(jsx);
  assert.equal(jsx.kind, "no-oracle");
  assert.equal(jsx.reason, "no generated cases; node cannot load .tsx directly");
  assert.equal(index.version, 1);
  assert.equal(index.generator_version, 1);
  assert.equal(index.seed, null);
  assert.match(index.generator_digest ?? "", /^[0-9a-f]{32}$/);
  const seen = new Set();
  let previous = "";
  for (const row of index.rows) {
    const identity = `${row.source}\0${row.signature}`;
    assert.ok(!seen.has(identity), identity); seen.add(identity);
    assert.ok(previous.localeCompare(identity, "en") <= 0); previous = identity;
    for (const field of [row.signature, row.cases_sha256, row.driver_sha256]) assert.match(field, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(row.keys).sort(), ["c", "jvm", "llvm"]);
    for (const key of Object.values(row.keys)) assert.match(key as string, /^[0-9a-f]{32}$/);
    if (row.kind === "no-oracle") {
      assert.equal("count" in row, false);
      assert.equal("complete" in row, false);
      assert.match(row.source_digest ?? "", /^[0-9a-f]{32}$/);
      assert.ok(typeof row.reason === "string" && row.reason.trim().length > 0);
      continue;
    }
    if (row.kind === "budget") {
      assert.equal(row.budget?.version, 1);
      assert.ok(row.budget && row.budget.bound > 0);
      assert.equal("count" in row, false);
      assert.equal("complete" in row, false);
      continue;
    }
    assert.equal(row.kind, "measured"); assert.equal(row.complete, true);
    assert.ok(typeof row.count === "number" && Number.isInteger(row.count) && row.count >= 0);
    // Legacy measured CPU provenance remains readable. New records keep it in
    // evidence instead, so authors on different machines publish equal bytes.
    if (row.node_cpu_s) {
      assert.equal(row.node_cpu_s.length, 2);
      assert.ok(row.node_cpu_s.every((n: number) => Number.isFinite(n) && n >= 0 && n * 2 <= 15));
    }
  }
});

test("a changed declared domain permits complete narrowing, not an unchanged domain's coverage loss", () => {
  const original = addRecord({ version: 1, rows: [] }, plan, [1, 2], 2);
  const domain = { identity: "a".repeat(32), declaration: { version: 1,
    functions: { f: { n: { max: 0, reason: "zero-sized workload" } } } } };
  const narrower = { ...plan, input_domain: domain, case_key: "bounded", case_count: 1, cases: ["f 0 [0.0]"] };
  assert.throws(() => addRecord(original, narrower, [1, 2], 0), /schema/);
  const measured = addRecord(original, narrower, [1, 2], 1);
  const row = measured.rows.find(row => row.count === 1)!;
  assert.deepEqual(row.input_domain, domain);
  assert.equal(row.complete, true);
  const baseline = addRecord({ version: 1, rows: [] }, { ...plan, input_domain: domain }, [1, 2], 2);
  assert.throws(() => addRecord(baseline, narrower, [1, 2], 1), /lower/);
  const reworded = { ...domain, declaration: { ...domain.declaration,
    functions: { f: { n: { max: 0, reason: "a clearer explanation of the same workload" } } } } };
  assert.throws(() => addRecord(baseline, { ...narrower, input_domain: reworded }, [1, 2], 1), /lower/);
  assert.throws(() => addRecord(original, { ...narrower, input_domain: { ...domain, declaration: { version: 1, functions: {} } } }, [1, 2], 1), /domain schema/);
});

test("a function's domain change cannot authorize another function's lost coverage", () => {
  const both = { ...plan, case_count: 4,
    cases: ["f 0 [0.0]", "f 1 [1.0]", "g 0 [0.0]", "g 1 [1.0]"] };
  const original = addRecord({ version: 1, rows: [] }, both, [1, 2], 4);
  const domain = { identity: "a".repeat(32), declaration: { version: 1,
    functions: { f: { n: { max: 0, reason: "zero-sized workload" } } } } };
  const changed = { ...both, input_domain: domain, case_key: "bounded" };
  assert.throws(() => addRecord(original,
    { ...changed, case_count: 1, cases: [both.cases[0]] }, [1, 2], 1), /coverage for g/);
  assert.throws(() => addRecord(original,
    { ...changed, case_count: 4, cases: ["f 0 [0.0]", "f 1 [0.5]", "f 2 [1.0]", "g 0 [0.0]"] }, [1, 2], 4), /coverage for g/);
  assert.doesNotThrow(() => addRecord(original,
    { ...changed, case_count: 3, cases: [both.cases[0], ...both.cases.slice(2)] }, [1, 2], 3));
  const legacy = { ...original, rows: original.rows.map(({ populations: _ignored, ...row }) => row) };
  assert.throws(() => addRecord(legacy,
    { ...changed, case_count: 3, cases: [both.cases[0], ...both.cases.slice(2)] }, [1, 2], 3), /lower legacy/);
});

test("author paths and CPU observations do not change a published promise", () => {
  const author = (repository_root: string) => ({ ...plan, repository_root,
    source: "tests/programs/example/src/main.ts", entry: `${repository_root}/tests/programs/example/src/main.ts`,
    driver: `import ${JSON.stringify(`file://${repository_root}/tests/programs/example/src/main.ts`)};`,
    resolver: `const root = ${JSON.stringify(repository_root + "/")};` });
  const left = author("/one/checkout"), right = author("/a/deeper/author/tree");
  assert.equal(canonicalDriver(left), canonicalDriver(right));
  const a = addRecord({version:1,rows:[]}, left, [0.1,0.2], 2);
  const b = addRecord({version:1,rows:[]}, right, [1.1,1.2], 2);
  assert.deepEqual(a, b);
  assert.equal("node_cpu_s" in a.rows[0], false);
});

test("a later shortfall publishes none of a recording's rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nts-recorder-atomic-"));
  const saved = process.env.NTS_BENCH_CPUS;
  try {
    process.env.NTS_BENCH_CPUS = "4";
    const output = join(dir, "counts.json"), original = '{"version":1,"rows":[]}\n';
    writeFileSync(output, original);
    writeFileSync(join(dir, "plans.json"), JSON.stringify({version:1,failures:[],plans:[plan,{...plan,source:"bad.ts",driver:"different"}]}));
    // Inject measurement results, so a unit test never uses the reserved core.
    await assert.rejects(recordAll(dir, output, async p => ({cpu:[0.1,0.2],count:p.source === "bad.ts" ? 1 : 2})), /recording incomplete/);
    assert.equal(readFileSync(output,"utf8"), original);
  } finally {
    if (saved === undefined) delete process.env.NTS_BENCH_CPUS; else process.env.NTS_BENCH_CPUS = saved;
    rmSync(dir,{recursive:true,force:true});
  }
});

test('an oracle compile timeout or memory cap records a budget failure without publishing a count',async t=>{
  const root=testScratch(t,'oracle-record-budget'),saved=process.env.NTS_BENCH_CPUS;
  t.after(()=>{if(saved===undefined)delete process.env.NTS_BENCH_CPUS;else process.env.NTS_BENCH_CPUS=saved;});
  process.env.NTS_BENCH_CPUS='4';
  t.mock.method(console,'log',()=>{});
  for(const outcome of ['timeout','memory-cap'] as const){
    const output=join(root,'counts.json'),original='{"version":1,"rows":[]}\n';writeFileSync(output,original);
    const source='tests/programs/budget/main.ts';mkdirSync(join(root,'tests/programs/budget'),{recursive:true});writeFileSync(join(root,source),'export const x=1;');
    const control='tests/programs/budget/control.ts';
    writeFileSync(join(root,'plans.json'),JSON.stringify({version:1,failures:[],plans:[
      {...plan,source,source_digest:'a'.repeat(32),repository_root:root,driver:'budget driver'},
      {...plan,source:control,source_digest:'b'.repeat(32),repository_root:root,driver:'control driver'},
    ]}));
    await recordAll(root,output,async p=>{if(p.source===control)return {cpu:[0.1,0.2],count:2};throw new OracleCompileBudgetError(outcome,'named compiler '+outcome);});
    const rows=JSON.parse(readFileSync(output,'utf8')).rows;
    const row=rows.find((value:{source:string})=>value.source===source);
    assert.equal(rows.find((value:{source:string})=>value.source===control)?.count,2,'a bounded case leaves measured populations recordable');
    assert.equal(row.kind,'budget');assert.equal(row.budget.outcome,outcome);assert.equal(row.budget.phase,'prepare');
    assert.equal(row.count,undefined,'a budget never invents a Node count');assert.equal(row.complete,undefined);
    const summary=JSON.parse(readFileSync(join(root,'measurement-summary.json'),'utf8'));
    assert.equal(summary.findings[0].outcome,outcome);
    assert.match(readFileSync(summary.findings[0].detail,'utf8'),new RegExp(outcome));
  }
});

test('a large producer dump is retained once and never echoed into the recording report',async t=>{
  const root=testScratch(t,'oracle-record-dump'),saved=process.env.NTS_BENCH_CPUS;
  t.after(()=>{if(saved===undefined)delete process.env.NTS_BENCH_CPUS;else process.env.NTS_BENCH_CPUS=saved;});
  process.env.NTS_BENCH_CPUS='4';
  const lines:string[]=[];t.mock.method(console,'log',(...args:unknown[])=>{lines.push(args.join(' '));});
  const dump='runtime: out of memory\n'+'goroutine dump detail\n'.repeat(100_000);
  const plans=['c','llvm','jvm'].map(backend=>({...plan,backend}));
  writeFileSync(join(root,'plans.json'),JSON.stringify({version:1,failures:[],plans}));
  let measured=0;
  await assert.rejects(recordAll(root,join(root,'counts.json'),async()=>{measured++;throw Error(dump);}),/recording incomplete/);
  assert.equal(measured,1,'backend signatures share the same failed driver');
  assert.ok(lines.join('\n').length<3000,'the console contains summaries and paths only');
  const summary=JSON.parse(readFileSync(join(root,'measurement-summary.json'),'utf8'));
  assert.equal(summary.findings.length,3);
  assert.equal(new Set(summary.findings.map((finding:{detail:string})=>finding.detail)).size,1);
  assert.equal(readFileSync(summary.findings[0].detail,'utf8'),dump+'\n');
  assert.equal(existsSync(join(root,'counts.json')),false);
});

// An arm runs here as the recorder's do, but on the test's own CPUs, not the
// measurement core, and in a resident scope its test chooses.
function recordingArm(t:{after(fn:()=>void):void},name:string,driver:string){
  const root=testScratch(t,name),saved=process.env.NTS_BENCH_CPUS;
  t.after(()=>{if(saved===undefined)delete process.env.NTS_BENCH_CPUS;else process.env.NTS_BENCH_CPUS=saved;});
  process.env.NTS_BENCH_CPUS='4';
  const source='tests/programs/arm/main.ts';mkdirSync(join(root,'tests/programs/arm'),{recursive:true});writeFileSync(join(root,source),'export const x=1;');
  writeFileSync(join(root,'plans.json'),JSON.stringify({version:1,failures:[],plans:[{...plan,source,source_digest:'a'.repeat(32),repository_root:root,driver}]}));
  return {root,source,output:join(root,'counts.json'),
    summary:()=>JSON.parse(readFileSync(join(root,'measurement-summary.json'),'utf8')) as {findings:{outcome:string;detail:string}[]}};
}
test("an oracle stopped at V8's heap limit is a memory-cap budget at that limit, and its failure file keeps V8's words",async t=>{
  t.mock.method(console,'log',()=>{});
  const arm=recordingArm(t,'oracle-record-heap','heap driver');
  // In the policy's own scope, whatever NODE_OPTIONS the shell has: the heap flags decide the limit.
  await recordAll(arm.root,arm.output,async(p,evidence,identity)=>{
    const dir=join(evidence,identity);mkdirSync(dir,{recursive:true});
    await runOracleArm(dir,0,process.execPath,[...ORACLE_HEAP_FLAGS,'-e','const held=[];for(;;)held.push(new Array(1<<17).fill(1.5));'],{source:p.source,env:process.env});
    return assert.fail('a run past its heap limit was measured');
  });
  const [row]=JSON.parse(readFileSync(arm.output,'utf8')).rows;
  assert.equal(row.kind,'budget');assert.equal(row.count,undefined);
  const {reason,...budget}=row.budget;
  assert.deepEqual(budget,{version:1,phase:'execute',outcome:'memory-cap',bound:ORACLE_EXECUTION_POLICY.heapBytes,signal:'SIGABRT'},'the row names the policy\'s heap, not the resident bound the run never reached');
  assert.match(reason,new RegExp(`^oracle memory-cap: ${arm.source} stopped at V8's ${ORACLE_EXECUTION_POLICY.heapBytes} byte JavaScript heap limit, the oracle execution policy's: FATAL ERROR: `));
  const [finding]=arm.summary().findings;
  assert.equal(finding!.outcome,'memory-cap');
  const failure=readFileSync(finding!.detail,'utf8');
  assert.ok(failure.startsWith(reason+"\n\nThe end of the child's stderr:\n"),failure);
  assert.match(failure,/\n<--- Last few GCs --->\n[\s\S]*\nFATAL ERROR: [^\n]*heap limit[^\n]* - JavaScript heap out of memory\n/);
});
test('an oracle run that measured nothing keeps the end of its stderr, in whole lines, in its failure file',async t=>{
  t.mock.method(console,'log',()=>{});
  const arm=recordingArm(t,'oracle-record-stderr','failing driver');
  // More than a failure file keeps: its first lines are cut, its last kept whole.
  const said=Array.from({length:400},(_,line)=>`line ${line} of what the child said`).join('\n')+'\n';
  await assert.rejects(recordAll(arm.root,arm.output,async(p,evidence,identity)=>{
    const dir=join(evidence,identity);mkdirSync(dir,{recursive:true});
    await runOracleArm(dir,0,process.execPath,[...ORACLE_HEAP_FLAGS,'-e',`process.stderr.write(${JSON.stringify(said)});process.exitCode=3;`],{source:p.source,env:process.env});
    return assert.fail('a failed run was measured');
  }),/recording incomplete/);
  const [finding]=arm.summary().findings;
  assert.equal(finding!.outcome,'not-measured');
  const [message,tail]=readFileSync(finding!.detail,'utf8').split("\n\nThe end of the child's stderr:\n");
  assert.equal(message,`oracle not measured: ${arm.source}: 3`);
  assert.ok(tail!.length<=STDERR_TAIL_BYTES&&said.length>tail!.length,'the end only: '+tail!.length);
  assert.ok(said.endsWith(tail!)&&said.split('\n').includes(tail!.split('\n')[0]!),'whole lines, the last one last');
});

test('a plan of no cases is never measured: it names the no-oracle row or cases it needs, and its no-oracle row records it',async t=>{
  const root=testScratch(t,'oracle-record-empty'),saved=process.env.NTS_BENCH_CPUS;
  t.after(()=>{if(saved===undefined)delete process.env.NTS_BENCH_CPUS;else process.env.NTS_BENCH_CPUS=saved;});
  process.env.NTS_BENCH_CPUS='4';
  const lines:string[]=[];t.mock.method(console,'log',(...args:unknown[])=>{lines.push(args.join(' '));});
  const source='tests/programs/empty/main.ts';mkdirSync(join(root,'tests/programs/empty'),{recursive:true});writeFileSync(join(root,source),'export const x=1;');
  const empty={...plan,source,source_digest:'a'.repeat(32),repository_root:root,case_count:0,cases:[],driver:'empty driver'};
  writeFileSync(join(root,'plans.json'),JSON.stringify({version:1,failures:[],plans:[empty]}));
  const output=join(root,'counts.json'),never=async()=>assert.fail('a population of no cases was measured');
  await assert.rejects(recordAll(root,output,never),/recording incomplete/);
  const [finding]=JSON.parse(readFileSync(join(root,'measurement-summary.json'),'utf8')).findings;
  assert.equal(finding.outcome,'not-measured');
  assert.equal(finding.error,`oracle not measured: ${source} plans no cases; record why with \`record-oracles.ts no-oracle\`, or give it cases`);
  assert.equal(readFileSync(finding.detail,'utf8'),finding.error+'\n');
  assert.equal(existsSync(output),false,'nothing is published');
  // The control differs in one thing: the table holds the plan's no-oracle row.
  writeFileSync(output,JSON.stringify({version:1,rows:[noOracleRecord(empty,'exports no callable function')]})+'\n');
  await recordAll(root,output,never);
  assert.ok(lines.includes(`no-oracle ${source} exports no callable function`),lines.join('\n'));
  assert.deepEqual(JSON.parse(readFileSync(join(root,'measurement-summary.json'),'utf8')).findings,[]);
});

test("no-oracle records carry no numeric count and require an empty source identity", () => {
  assert.throws(() => noOracleRecord(plan, "reason"), /empty/);
  const row = noOracleRecord({ ...plan, case_count: 0, cases: [] }, "reason");
  assert.equal(row.source_digest, "source-digest");
  assert.equal("count" in row, false);
  assert.equal("node_cpu_s" in row, false);
});

test("a source plan cannot drop a refused export or record its empty population", () => {
  const sourcePlan = { ...plan, version: 2, source_exports: ["f", "g"], cases: ["f 0 [0.0]", "g 0 [0.0]"] };
  assert.equal(addRecord({ version: 1, rows: [] }, sourcePlan, [0.1, 0.2], 2).rows[0].count, 2);
  const dropped = { ...sourcePlan, cases: ["f 0 [0.0]"], case_count: 1 };
  assert.throws(() => addRecord({ version: 1, rows: [] }, dropped, [0.1, 0.2], 1), /lost or emptied source export g/);
  const empty = { ...sourcePlan, cases: [], case_count: 0 };
  assert.throws(() => addRecord({ version: 1, rows: [] }, empty, [0.1, 0.2], 0), /lost or emptied/);
  assert.throws(() => noOracleRecord(empty, "compiled nothing"), /lost or emptied/);
});

test("source-plan inventories are mandatory, unique and closed over their cases", () => {
  assert.throws(() => validateSourcePlan({ ...plan, version: 2 }), /source export inventory/);
  assert.throws(() => validateSourcePlan({ ...plan, version: 2, source_exports: ["f", "f"] }), /source export inventory/);
  assert.throws(() => validateSourcePlan({ ...plan, version: 2, source_exports: ["g"] }), /undeclared export f/);
});

test('a budget cannot replace a measured promise, and a count improves a budget',async t=>{
  const {addBudgetRecord}=await import('../differential/record-oracles.ts');
  const root=testScratch(t,'oracle-budget-ratchet'),source='tests/programs/budget/main.ts';
  mkdirSync(join(root,'tests/programs/budget'),{recursive:true});writeFileSync(join(root,source),'export const x=1;');
  const subject={...plan,source,source_digest:'a'.repeat(32),repository_root:root};
  const budget={phase:'execute' as const,outcome:'timeout' as const,bound:15,signal:'SIGKILL',reason:'oracle timed out'};
  const limited=addBudgetRecord({version:1,rows:[]},subject,budget);
  const otherBackend=addBudgetRecord(limited,{...subject,backend:'llvm',case_key:'llvm-key'},budget);
  assert.deepEqual(otherBackend.rows[0].keys,{c:subject.case_key,llvm:'llvm-key'},'one bounded driver retains every backend population');
  assert.deepEqual(otherBackend.rows[0].budget,limited.rows[0].budget,'adding a backend keeps the first observed stop');
  const measured=addRecord(limited,subject,[0.1,0.2],2);
  assert.equal(measured.rows[0]!.kind,'measured');assert.equal(measured.rows[0]!.budget,undefined);
  assert.throws(()=>addBudgetRecord(measured,subject,budget),CaseBudgetError);
});

test("inside an unsealed canonical run, the fixture planner's build gets a temporary of its own registered in its context",t=>{
  const dir=testScratch(t,"oracle-plan-build"),home=join(dir,"home"),bin=join(dir,"bin"),log=join(dir,"cargo.log"),check=join(dir,"context-check.mjs");
  mkdirSync(bin,{recursive:true});mkdirSync(home,{recursive:true});
  // A cargo that makes the check a child that captures oracle dependencies makes, logs it, and fails the build.
  writeFileSync(check,`import {appendFileSync} from "node:fs";
import {ownedCacheEnvironment} from ${JSON.stringify(new URL("./canonical-environment.ts",import.meta.url).href)};
try{ownedCacheEnvironment(process.env,{temporary:process.env.TMPDIR});appendFileSync(${JSON.stringify(log)},"held\\n");}
catch(error){appendFileSync(${JSON.stringify(log)},"refused: "+error.message+"\\n");}
process.exit(1);
`);
  writeFileSync(join(bin,"cargo"),`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(check)}\n`);chmodSync(join(bin,"cargo"),0o755);
  // The context the full check's records unit runs in: canonical, its oracle dependencies unsealed.
  const planned=gateEnvironment({PATH:`${bin}:${process.env.PATH}`,HOME:home},{run:join(home,".cache/gate-run"),owned:ownMemory(join(dir,"memory"))});
  const repository=fileURLToPath(new URL("../../",import.meta.url));
  const fixture=readdirSync(join(repository,"tests/programs")).sort().find(name=>existsSync(join(repository,"tests/programs",name,"tsconfig.json")))!;
  const result=spawnTest(process.execPath,[join(repository,"tooling/differential/record-oracles.ts"),`tests/programs/${fixture}`],{cwd:repository,env:planned.env,encoding:"utf8"});
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.match(result.stderr,/building the fixture planner failed/);
  assert.equal(readFileSync(log,"utf8"),"held\n");
});

test("runs past half their CPU bound are a margin row naming what each used, with no count; just under half is measured",async t=>{
  const root=testScratch(t,'oracle-record-margin'),saved=process.env.NTS_BENCH_CPUS;
  t.after(()=>{if(saved===undefined)delete process.env.NTS_BENCH_CPUS;else process.env.NTS_BENCH_CPUS=saved;});
  process.env.NTS_BENCH_CPUS='4';
  const lines:string[]=[];t.mock.method(console,'log',(...args:unknown[])=>{lines.push(args.join(' '));});
  // A test program's oracle has 15 CPU seconds, so a count needs each run within 7.5.
  const near='tests/programs/margin/near.ts',under='tests/programs/margin/under.ts';
  assert.equal(oracleExecutionLimits(near).cpuSeconds,15);
  mkdirSync(join(root,'tests/programs/margin'),{recursive:true});
  for(const source of [near,under])writeFileSync(join(root,source),'export const x=1;');
  writeFileSync(join(root,'plans.json'),JSON.stringify({version:1,failures:[],plans:[
    {...plan,source:near,source_digest:'a'.repeat(32),repository_root:root,driver:'near driver'},
    {...plan,source:under,source_digest:'b'.repeat(32),repository_root:root,driver:'under driver'},
  ]}));
  const output=join(root,'counts.json');writeFileSync(output,'{"version":1,"rows":[]}\n');
  await recordAll(root,output,async p=>({cpu:p.source===near?[7.6,7.6]:[7.4,7.4],count:2}));
  const rows=JSON.parse(readFileSync(output,'utf8')).rows,row=(source:string)=>rows.find((value:{source:string})=>value.source===source);
  assert.deepEqual([row(near).kind,row(near).count,row(near).complete],['budget',undefined,undefined],'a margin never claims a count');
  assert.deepEqual(row(near).budget,{version:1,phase:'execute',outcome:'margin',bound:15,signal:null,cpu_s:[7.6,7.6],
    reason:'node used 7.6 and 7.6 s of its 15 s CPU bound; a count needs both runs within half of it (7.5 s)'});
  assert.deepEqual([row(under).kind,row(under).count],['measured',2],'just under half, it is measured');
  const summary=JSON.parse(readFileSync(join(root,'measurement-summary.json'),'utf8'));
  assert.deepEqual(summary.findings.map((finding:{source:string;outcome:string})=>[finding.source,finding.outcome]),[[near,'margin']],'a finding, never not measured');
  assert.ok(lines.some(line=>line.startsWith(`MARGIN c ${near} node used 7.6 and 7.6 s of its 15 s CPU bound`)),lines.join('\n'));
  // It reads back as written; a margin with no run past half, with no CPU, or a stop that names CPU, does not.
  // With the recorded identity's digests in place of this file's short test values.
  const shard=(budget:object)=>({version:2,fixture:'tests/programs/margin',rows:[{...row(near),keys:{c:'c'.repeat(32)},signature:'d'.repeat(64),cases_sha256:'e'.repeat(64),driver_sha256:'f'.repeat(64),budget}]});
  assert.deepEqual(parseShard(shard(row(near).budget),'tests/programs/margin').rows[0]!.budget,row(near).budget);
  for(const [budget,refusal] of [
    [{...row(near).budget,cpu_s:[7.4,7.4]},/invalid oracle margin/],
    [{...row(near).budget,cpu_s:undefined},/invalid oracle margin/],
    [{...row(near).budget,cpu_s:[16,1]},/invalid oracle margin/],
    [{...row(near).budget,outcome:'timeout',signal:'SIGKILL'},/only a margin names the CPU/],
  ] as const)assert.throws(()=>parseShard(shard(JSON.parse(JSON.stringify(budget))),'tests/programs/margin'),refusal);
  // A population measured before, past half now, is refused as a regression.
  await assert.rejects(recordAll(root,output,async p=>({cpu:[7.6,7.6],count:2})),/REGRESSED oracle population: tests\/programs\/margin\/under\.ts measured -> margin/);
});

/** Program fixtures under `root`, each a tsconfig and its src/main.ts entry. */
function programs(root:string,names:readonly string[]){
  for(const name of names){
    mkdirSync(join(root,'tests/programs',name,'src'),{recursive:true});
    writeFileSync(join(root,'tests/programs',name,'tsconfig.json'),'{"include":["src"]}\n');
    writeFileSync(join(root,'tests/programs',name,'src/main.ts'),'export function work(n: number): number { return n; }\n');
  }
}
test("the records pass holds each planner as a worker does: past its bound after naming its entry, that entry's plan budget; naming none, silent or failing, a failure saying so",async t=>{
  const unit=`nts-oracle-plan-control-${randomUUID()}`;
  let sliceReceipt:string|undefined;
  t.after(()=>{
    spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});
    if(sliceReceipt&&existsSync(sliceReceipt))spawnTest('systemctl',['--user','stop',readFileSync(sliceReceipt,'utf8')],{encoding:'utf8'});
  });
  const root=testScratch(t,'oracle-plan-bound'),evidence=join(root,'evidence'),planner=join(root,'oracle-plan');
  // The test's own step frame: the hold a silent planner publishes reaches no gate step.
  const frame={NTS_GATE_STEP_RESULT:join(root,'step-result.json'),NTS_GATE_STEP:'oracle-plan-control',NTS_GATE_STEP_ATTEMPT:'control'};
  programs(root,['slow','fine','early','quiet','broken']);
  const named=(name:string)=>JSON.stringify({entry:join(root,'tests/programs',name,'src/main.ts'),source:`tests/programs/${name}/src/main.ts`})+'\n';
  writeFileSync(join(root,'slow.entry'),named('slow'));writeFileSync(join(root,'fine.entry'),named('fine'));
  for(const backend of ['c','llvm','jvm'])writeFileSync(join(root,`fine-${backend}.plan`),JSON.stringify({...plan,backend,source:'tests/programs/fine/src/main.ts',entry:join(root,'tests/programs/fine/src/main.ts'),driver:'fine driver'})+'\n');
  // slow names its entry, then plans past its bound; early never gets as far; quiet goes silent; broken fails.
  writeFileSync(planner,`#!/bin/sh
case "$1" in
  */slow/*) cat ${JSON.stringify(join(root,'slow.entry'))}; while :; do :; done ;;
  */fine/*) cat ${JSON.stringify(join(root,'fine.entry'))} ${JSON.stringify(root)}/fine-$NTS_BACKEND.plan ;;
  */early/*) while :; do :; done ;;
  */quiet/*) exec tail -f /dev/null ;;
  *) echo "the program does not typecheck" >&2; exit 3 ;;
esac
`,{mode:0o755});
  // Enter one real bounded worker before applying the deliberately small
  // planner inactivity allowance. Unit startup is not a quiet planner.
  sliceReceipt=join(root,'resident-slice');
  const control=join(root,'plan-control.mjs');
  writeFileSync(control,`
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {planAll} from ${JSON.stringify(new URL('../differential/record-oracles.ts',import.meta.url).href)};
import {ORACLE_PLANNER_LIMITS} from ${JSON.stringify(new URL('../differential/oracle-execution.ts',import.meta.url).href)};
import {serialRun,inResidentWorker,memoryRun,closeMemoryRun} from ${JSON.stringify(new URL('../census/worker-memory.ts',import.meta.url).href)};
if(!inResidentWorker())writeFileSync(${JSON.stringify(sliceReceipt)},memoryRun().slice);
serialRun({});
try{
  const collected={version:1,plans:[],unplanned:[],failures:[]};
  for(const name of ['slow','fine','early','quiet','broken']){
    const directory=join(${JSON.stringify(evidence)},name);
    // Only the control that tests a bound receives that bound. Successful
    // and failing exits are awaited with normal production supervision.
    const limits={...ORACLE_PLANNER_LIMITS,...(name==='quiet'?{idleMs:300}:name==='slow'||name==='early'?{cpuSeconds:0.5}:{})};
    await planAll(${JSON.stringify(planner)},${JSON.stringify(root)},directory,false,undefined,['tests/programs/'+name],limits);
    const outcome=JSON.parse(readFileSync(join(directory,'plans.json'),'utf8'));
    for(const key of ['plans','unplanned','failures'])collected[key].push(...(outcome[key]??[]));
  }
  mkdirSync(${JSON.stringify(evidence)},{recursive:true});
  writeFileSync(join(${JSON.stringify(evidence)},'plans.json'),JSON.stringify(collected));
}
finally{closeMemoryRun();}
`);
  const inherited=toolingSlice();
  const planned=gateEnvironment(hostEnvironment(process.env),{run:join(root,'run'),owned:{...frame,...ownMemory(join(root,'memory')),
    ...(inherited?{NTS_TOOLING_SLICE:inherited}:{}),
  }});
  const actual=spawnTest('systemd-run',['--user',...toolingSliceArgs(),`--unit=${unit}`,'--collect','--quiet','--wait','--pipe',
    '-p','LimitCORE=0','-p','Nice=19','-p','CPUAffinity=0-3 6-31','-p','RuntimeMaxSec=180s','-p','TimeoutStopSec=5s',
    ...Object.entries(planned.env).filter((pair):pair is [string,string]=>pair[1]!==undefined).map(([key,value])=>'--setenv='+key+'='+value),
    process.execPath,control],{encoding:'utf8'});
  assert.equal(actual.status,0,actual.stdout+actual.stderr);
  const lines=actual.stdout.split('\n');
  const manifest=JSON.parse(readFileSync(join(evidence,'plans.json'),'utf8'));
  assert.deepEqual(manifest.plans.map((one:{backend:string;source:string})=>[one.backend,one.source]),['c','llvm','jvm'].map(backend=>[backend,'tests/programs/fine/src/main.ts']),JSON.stringify(manifest.failures));
  assert.deepEqual(manifest.unplanned.map(({budget:{reason,...budget},...one}:{budget:{reason:string}})=>({...one,budget,reason:/^oracle planner timed out: .* used its 0\.5 s CPU bound/.test(reason)})),
    ['c','llvm','jvm'].map(backend=>({config:join(root,'tests/programs/slow/tsconfig.json'),source:'tests/programs/slow/src/main.ts',backend,
      budget:{phase:'plan',outcome:'timeout',bound:0.5,signal:'SIGKILL'},repository_root:root,reason:true})),'one plan budget per backend, for the entry it named');
  const failures=(name:string)=>manifest.failures.filter((one:{config:string})=>one.config.includes(`/${name}/`)).map((one:{backend:string;error:string})=>[one.backend,one.error]);
  for(const [name,said] of [['early',/^oracle planner passed its CPU bound before it named its entry: oracle planner timed out/],
    ['quiet',/^CommandNotMeasuredError: command NOT RUN \(hung\): .*; no output/s],['broken',/^ToolingInstrumentError: oracle planner held: exit 3\n.*does not typecheck/s]] as const){
    assert.deepEqual(failures(name).map(([backend]:string[])=>backend),['c','llvm','jvm'],name);
    for(const [,error] of failures(name))assert.match(error,said,name);
  }
  assert.ok(lines.includes(`plan budget c tests/programs/slow/src/main.ts ${manifest.unplanned[0].budget.reason}`),lines.join('\n'));
  assert.ok(lines.some(line=>line.startsWith(`plan unavailable c ${join(root,'tests/programs/early/tsconfig.json')} oracle planner passed its CPU bound before it named its entry`)),lines.join('\n'));
  assert.equal(JSON.parse(readFileSync(frame.NTS_GATE_STEP_RESULT,'utf8')).kind,'hung','a silent planner is the step hold');
});

test("a plan budget is one record for its entry: planned backends leave it, a measured population is never replaced by it, and rows stay as they were",async t=>{
  const root=testScratch(t,'oracle-record-unplanned'),saved=process.env.NTS_BENCH_CPUS;
  t.after(()=>{if(saved===undefined)delete process.env.NTS_BENCH_CPUS;else process.env.NTS_BENCH_CPUS=saved;});
  process.env.NTS_BENCH_CPUS='4';
  const lines:string[]=[];t.mock.method(console,'log',(...args:unknown[])=>{lines.push(args.join(' '));});
  programs(root,['slow','fine']);
  const slow='tests/programs/slow/src/main.ts',fine='tests/programs/fine/src/main.ts';
  const budget={phase:'plan' as const,outcome:'timeout' as const,bound:600,signal:'SIGKILL',reason:'oracle planner timed out: 600 s'};
  const planned=(source:string,backend:string,digit:string)=>({...plan,backend,source,source_digest:digit.repeat(32),repository_root:root,driver:source+' driver',case_key:digit.repeat(32)});
  const pass=(plans:object[],unplanned:string[])=>writeFileSync(join(root,'plans.json'),JSON.stringify({version:1,failures:[],plans,
    unplanned:unplanned.map(backend=>({config:join(root,'tests/programs/slow/tsconfig.json'),source:slow,backend,budget,repository_root:root}))}));
  const output=join(root,'counts.json');writeFileSync(output,'{"version":1,"rows":[]}\n');
  const measure=async (one:{case_count:number})=>({cpu:[0.1,0.2],count:one.case_count});
  const fineRow=()=>JSON.parse(readFileSync(output,'utf8')).rows.find((row:{source:string})=>row.source===fine);
  pass([planned(fine,'c','1')],['c','llvm']);
  await recordAll(root,output,measure);
  const first=JSON.parse(readFileSync(output,'utf8')),revision=oracleUnplannedRevision(root,'tests/programs/slow');
  assert.deepEqual(first.unplanned,[{source:slow,backends:['c','llvm'],budget:{version:1,...budget},revision}],'one record names both backends');
  assert.equal(first.rows.some((row:{source:string})=>row.source===slow),false,'no population, so no row');
  assert.ok(lines.includes(`PLAN BUDGET c ${slow} ${budget.reason}`),lines.join('\n'));
  assert.equal(JSON.parse(lines.at(-1)!).plan_budgets,2);
  const recorded=fineRow();
  // The next pass plans slow on c: its population is measured, and the plan budget names only llvm, with its provenance.
  pass([planned(fine,'c','1'),planned(slow,'c','2')],['llvm']);
  await recordAll(root,output,measure);
  const second=JSON.parse(readFileSync(output,'utf8'));
  assert.deepEqual(second.unplanned,[{source:slow,backends:['llvm'],budget:{version:1,...budget},revision}]);
  assert.equal(second.rows.find((row:{source:string})=>row.source===slow).kind,'measured');
  assert.deepEqual(fineRow(),recorded,'a row the plan budget does not answer is unchanged');
  // Planned on llvm too: the plan budget goes.
  pass([planned(slow,'c','2'),planned(slow,'llvm','3')],[]);
  await recordAll(root,output,measure);
  assert.equal('unplanned' in JSON.parse(readFileSync(output,'utf8')),false);
  // A planner past its bound where a population was measured is a regression, never a plan budget.
  pass([],['c']);
  await assert.rejects(recordAll(root,output,measure),(error:Error)=>error instanceof CaseBudgetError&&/REGRESSED oracle population: tests\/programs\/slow\/src\/main\.ts \(c\) measured -> plan timeout/.test(error.message));
  // It reads back as written, beside the rows a record may have none of.
  const shard={version:2,fixture:'tests/programs/slow',rows:[],unplanned:first.unplanned[0]};
  assert.deepEqual(parseShard(shard,'tests/programs/slow').unplanned,first.unplanned[0]);
  assert.throws(()=>parseShard({...shard,unplanned:{...shard.unplanned,driver_sha256:'f'.repeat(64)}},'tests/programs/slow'),/unknown field driver_sha256/,'a plan budget names no driver');
});
