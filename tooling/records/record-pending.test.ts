// record-pending.ts on a small tree of its own: which cases it finds pending,
// which recorders it runs, and what it lets them write. The recorders here are
// stand-ins that write rows through the same merge helpers the real ones use.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { mergeBenchmarkRecord, serializeBenchmarkRecord, type BenchmarkOutcome } from "../bench/outcomes.ts";
import { mergeTypeScriptRecord, serializeTypeScriptRecord, type TypeScriptObservation } from "../census/typescript-record.ts";
import { acceptedIn, applyCommand, applyDelta, auditRecord, findPending, KIND_STEPS, KINDS, oracleRefreshes, partOf, recordPending, sourceDigests, type BenchmarkDigests, type Kind, type Runner } from "./record-pending.ts";
import { appliedIn, DELTA_FILE, parseDelta, serializeDelta, type Delta } from "./delta.ts";
import { improvedLine, pendingLine, refusesDifferentlyLine } from "./pending.ts";
import { mergeTest262Record } from "../census/test262-record.ts";
import { STEPS } from "../gate/step-table.mjs";
import { written as dexRecord, type DexOutcome } from "../android/dex-record.ts";
import {oracleBudgetRevision,oracleUnplannedRevision} from "../differential/record-oracles.ts";
import {requestOracleImprovement,recordPath,oracleImprovementPath} from "../differential/oracle-records.ts";
import { testScratch } from "../gate/test-scratch.ts";
import { calibrationRecord, compileTimeModules, COMPILE_ARMS, COMPILE_WORK_PROFILE, COMPILE_WORK_SETTINGS, COUNTER_SCOPE, withCalibratedModule, type CompileArm } from "../gate/compile-counter.ts";

const BACKENDS = ["c", "llvm", "jvm"] as const;
const refused: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "NTS1001", where: "body" }] };
const compileRefused: BenchmarkOutcome = { kind: "refused", diagnostic: "NTS1001 unsupported shape" };
const node = "exit 0; Observed: x=1;";

function tree(t: { after(fn: () => void): void }): string {
  const root = testScratch(t, "record-pending-tree");
  const home=process.env.HOME;process.env.HOME=join(root,'home');
  t.after(()=>{if(home===undefined)delete process.env.HOME;else process.env.HOME=home;});
  const put = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  for (const name of ["recorded", "new"]) put(`tests/typescript/family/${name}.ts`, "/*---\nfeatures: []\n---*/\nassert.sameValue(1, 1);\n");
  for (const backend of BACKENDS) {
    put(`results/typescript/${backend}/cases.tsv`, serializeTypeScriptRecord({ metadata: { version: 3, backend, commit: "a".repeat(40),
      compiler: "b".repeat(16), harness: "c".repeat(16), under: "tests/typescript" }, cases: new Map([["tests/typescript/family/recorded.ts", refused]]) }));
    put(`results/benchmarks/${backend}/outcomes.tsv`, serializeBenchmarkRecord({ metadata: { version: 1, backend, commit: "a".repeat(40),
      compiler: "b".repeat(16), harness: "c".repeat(16), under: "benchmarks/cases", scopes: ["compile"] }, rows: [cell("recorded", compileRefused)] }));
  }
  for (const name of ["recorded", "new"]) put(`benchmarks/cases/${name}/case.ts`, "export function run(): number { return 1; }\n");
  for (const name of ["recorded", "new"]) put(`tests/outcomes/${name}/src/main.ts`, `observe("x", String(1));\ndone();\n`);
  put("tests/outcomes/recorded/outcome.json", stored("refused", "NTS1001 a shape"));
  for (const name of ["recorded", "new"]) {
    put(`tests/programs/${name}/tsconfig.json`, '{"files":["src/main.ts"]}\n');
    put(`tests/programs/${name}/src/main.ts`, "export function work(n: number): number { return n; }\n");
  }
  put("results/oracle-counts/_generator.json", JSON.stringify({ version: 1, generator_version: 1, generator_digest: "a".repeat(32), seed: null }) + "\n");
  for (const fixture of ["tests/programs/recorded", "benchmarks/cases/recorded"]) put(`results/oracle-counts/${fixture}.json`, `{"fixture":"${fixture}"}\n`);
  // The compile-time tripwire's modules: one recorded in both arms, one pending.
  put("runtime/node/recorded/tsconfig.json", "{}\n");
  put("tests/compile-time/new/tsconfig.json", "{}\n");
  put("tests/compile-time/new/src/main.ts", "export const value = 1;\n");
  for (const arm of ["nogc", "rc"] as const) {
    const published = calibrationRecord(compileSummary("runtime/node/recorded", 100, arm), ["runtime/node/recorded"]);
    put(COMPILE_ARMS[arm].table, published.text.replace(/^# compiler-sha256:.*$/m, `# compiler-provenance: per-module in ${COMPILE_ARMS[arm].calibration}`));
    put(COMPILE_ARMS[arm].calibration, `${JSON.stringify(published.record, null, 2)}\n`);
  }
  return root;
}
/** One module's five-repeat calibration on one arm, counting `base` G instructions, by the compiler `source` names. */
function compileSummary(module: string, base: number, arm: CompileArm, source = "a") {
  return { arm, work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, complete: true,
    nts_sha256: source.repeat(64), commit: source.repeat(40), raw_directory: `/raw/${source}`,
    modules: [{ module, runs: [1, 2, 3, 4, 5].map(repeat => ({ module, repeat, arm, work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS,
      counter_scope: COUNTER_SCOPE, status: 0, instructions: (base + repeat / 100) * 1e9, cpu_s: 10, listing_functions: 1, listing_definitions: 1,
      counter_file: `/raw/${source}/${repeat}.perf` })) }] };
}
/** The calibration tool's publication of one module's row and entry, as `--module <m> --record` writes them. */
function calibrate(root: string, arm: CompileArm, module: string, base: number) {
  const { table, calibration } = COMPILE_ARMS[arm];
  const published = withCalibratedModule(readFileSync(join(root, table), "utf8"), JSON.parse(readFileSync(join(root, calibration), "utf8")),
    compileSummary(module, base, arm, "b"), compileTimeModules(root), module);
  writeFileSync(join(root, calibration), `${JSON.stringify(published.record, null, 2)}\n`);
  writeFileSync(join(root, table), published.text);
}
function cell(name: string, outcome: BenchmarkOutcome) {
  return { path: `benchmarks/cases/${name}`, scope: "compile" as const, source: "1".repeat(64), driver: "2".repeat(64), outcome };
}
function stored(category: string, nts: string): string {
  return `${JSON.stringify({ run: "build", category, nts, ...(category === "refused" ? { ran: "exit 0" } : {}), node, measured_with: "d".repeat(16), source: "measured" }, null, 2)}\n`;
}
/** Every file under the tree, by path, for a byte-for-byte comparison. */
function files(root: string): Map<string, string> {
  return new Map(readdirSync(root, { withFileTypes: true, recursive: true }).filter(entry => entry.isFile())
    .map(entry => { const path = join(entry.parentPath, entry.name); return [path.slice(root.length + 1), readFileSync(path, "utf8")]; }));
}

/** Stand-ins for the four recorders: the pending rows, and one improvement each. */
function recorders(root: string, overrides: Partial<Record<string, () => void>> = {}): { run: Runner; ran: string[][] } {
  const ran: string[][] = [];
  const edit = (path: string, change: (text: string) => string) => writeFileSync(join(root, path), change(readFileSync(join(root, path), "utf8")));
  const run: Runner = (args) => {
    ran.push(args);
    const script = args[0]!, override = overrides[script];
    if (override) { override(); return 0; }
    if (script === "tooling/differential/record-oracles.ts") {
      for (const fixture of args.slice(1)) writeFileSync(join(root, `results/oracle-counts/${fixture}.json`), `{"fixture":"${fixture}","recorded":true}\n`);
    } else if (script === "tooling/census/conformance262.ts") {
      edit(args.at(-1)!, text => mergeTypeScriptRecord(text, new Map<string, TypeScriptObservation>([
        ["tests/typescript/family/new.ts", { kind: "pass" }], ["tests/typescript/family/recorded.ts", { kind: "pass" }]])));
    } else if (script === "tooling/bench/build-records.ts") {
      for (const backend of BACKENDS) edit(`results/benchmarks/${backend}/outcomes.tsv`, text => mergeBenchmarkRecord(text, [cell("new", { kind: "pass" }), cell("recorded", { kind: "pass" })]));
    } else if (script === "tooling/gate/compile-counter-calibrate.ts") {
      // A pending module counts 50 G; a re-recorded one, 80 G where it counted 100.
      const arm = args[args.indexOf("--arm") + 1] as CompileArm, module = args[args.indexOf("--module") + 1]!;
      calibrate(root, arm, module, module === "runtime/node/recorded" ? 80 : 50);
    } else if (script === "tooling/conformance/outcomes-check.ts") {
      writeFileSync(join(root, "tests/outcomes/new/outcome.json"), stored("agrees", node));
      writeFileSync(join(root, "tests/outcomes/recorded/outcome.json"), stored("agrees", node));
    }
    return 0;
  };
  return { run, ran };
}

test("it finds exactly the cases whose records have no row yet", t => {
  const root = tree(t);
  assert.deepEqual(findPending(root, "oracle-counts").map(one => [one.name, one.record]), [
    ["benchmarks/cases/new", "results/oracle-counts/benchmarks/cases/new.json"], ["tests/programs/new", "results/oracle-counts/tests/programs/new.json"]]);
  assert.deepEqual(findPending(root, "typescript").map(one => [one.name, one.record]),
    BACKENDS.map(backend => ["tests/typescript/family/new.ts", `results/typescript/${backend}/cases.tsv`]));
  assert.deepEqual(findPending(root, "benchmarks").map(one => [one.name, one.record]),
    BACKENDS.map(backend => ["benchmarks/cases/new", `results/benchmarks/${backend}/outcomes.tsv`]));
  assert.deepEqual(findPending(root, "outcomes").map(one => [one.name, one.record]), [["tests/outcomes/new", "tests/outcomes/new/outcome.json"]]);
});

test('a record fixture cannot observe an improvement hint in another HOME',t=>{
  const outside=testScratch(t,'record-pending-foreign-home'),fixture='benchmarks/cases/recorded',beforeHome=process.env.HOME;
  let hint:string;
  try{process.env.HOME=outside;hint=oracleImprovementPath(fixture);}
  finally{if(beforeHome===undefined)delete process.env.HOME;else process.env.HOME=beforeHome;}
  mkdirSync(dirname(hint),{recursive:true});writeFileSync(hint,'{"poisoned":true}');
  const root=tree(t),ownedHome=process.env.HOME;
  assert.deepEqual(oracleRefreshes(root),[],'the private fixture ignores foreign mutable state');
  try{process.env.HOME=outside;assert.throws(()=>oracleRefreshes(root),/invalid or misnamed fixture record/);}
  finally{process.env.HOME=ownedHome;}
  assert.equal(readFileSync(hint,'utf8'),' {"poisoned":true}'.trim(),'the foreign hint is retained');
});

test("it records the pending and improved rows, every other byte as it was, and then has nothing to do", t => {
  const root = tree(t), before = files(root), lines: string[] = [];
  const { run, ran } = recorders(root);
  assert.equal(recordPending(root, ["oracle-counts", "typescript", "benchmarks", "outcomes"], run, line => lines.push(line)), 0, lines.join("\n"));
  assert.deepEqual(ran.map(args => args.join(" ")), [
    "tooling/differential/record-oracles.ts benchmarks/cases/new", "tooling/differential/record-oracles.ts tests/programs/new",
    ...BACKENDS.map(backend => `tooling/census/conformance262.ts --suite typescript --backend ${backend} --record-pending results/typescript/${backend}/cases.tsv`),
    "tooling/bench/build-records.ts --record-pending", "tooling/conformance/outcomes-check.ts --record-pending"]);
  const recorded = lines.filter(line => line.startsWith("  recorded "));
  assert.equal(recorded.length, 2 + 3 * 2 + 3 * 2 + 2, recorded.join("\n"));
  assert.ok(recorded.includes('  recorded results/typescript/c/cases.tsv: tests/typescript/family/new.ts {"kind":"pass"} (pending)'), recorded.join("\n"));
  assert.ok(recorded.some(line => line.startsWith("  recorded results/typescript/c/cases.tsv: tests/typescript/family/recorded.ts {\"kind\":\"refused\"")
    && line.endsWith('-> {"kind":"pass"} (improved)')), recorded.join("\n"));
  assert.ok(recorded.includes("  recorded tests/outcomes/recorded/outcome.json: tests/outcomes/recorded refused -> agrees (improved)"));
  const after = files(root), touched = new Set([...BACKENDS.flatMap(backend => [`results/typescript/${backend}/cases.tsv`, `results/benchmarks/${backend}/outcomes.tsv`]),
    "results/oracle-counts/tests/programs/new.json", "results/oracle-counts/benchmarks/cases/new.json", "tests/outcomes/new/outcome.json", "tests/outcomes/recorded/outcome.json"]);
  for (const [path, text] of before) if (!touched.has(path)) assert.equal(after.get(path), text, `${path} is untouched`);
  for (const backend of BACKENDS) {
    const header = (path: string, files: Map<string, string>) => files.get(path)!.split("\n")[0];
    assert.equal(header(`results/typescript/${backend}/cases.tsv`, after), header(`results/typescript/${backend}/cases.tsv`, before), "a record's header is kept");
  }
  for (const kind of ["oracle-counts", "typescript", "benchmarks", "outcomes"] as const) assert.deepEqual(findPending(root, kind), [], `${kind}: nothing pending`);
  // Nothing pending and nothing improved: the recorders write nothing, and nothing changes.
  const quiet: string[] = [], idle = recorders(root, Object.fromEntries(["tooling/census/conformance262.ts", "tooling/bench/build-records.ts",
    "tooling/conformance/outcomes-check.ts"].map(script => [script, () => {}])));
  assert.equal(recordPending(root, ["oracle-counts", "typescript", "benchmarks", "outcomes"], idle.run, line => quiet.push(line)), 0, quiet.join("\n"));
  assert.deepEqual(idle.ran, [], "nothing pending and no accepted change listed: no recorder runs");
  assert.ok(quiet.includes("typescript: nothing pending and no accepted change listed; not run"), quiet.join("\n"));
  assert.deepEqual(files(root), after);
  assert.match(quiet.at(-1)!, /^record-pending: 0 row\(s\) recorded; nothing is committed$/);
});

test("a pending fixture that cannot be measured keeps no other pending fixture from its record", t => {
  const root = tree(t), lines: string[] = [];
  const { run: record } = recorders(root);
  const run: Runner = (args, at) => args[0] === "tooling/differential/record-oracles.ts" && args[1] === "benchmarks/cases/new" ? 1 : record(args, at);
  assert.equal(recordPending(root, ["oracle-counts"], run, line => lines.push(line)), 1, lines.join("\n"));
  assert.ok(lines.includes("  oracle-counts: the recorder exited 1"), lines.join("\n"));
  assert.ok(lines.includes("  recorded results/oracle-counts/tests/programs/new.json: tests/programs/new (pending)"), lines.join("\n"));
  assert.deepEqual(findPending(root, "oracle-counts").map(one => one.name), ["benchmarks/cases/new"], "only the fixture that could not be measured stays pending");
});

test("a recorder that rewrites a recorded row without improving it, or records a case that was not pending, is refused and put back", t => {
  const root = tree(t), before = files(root), lines: string[] = [];
  const edit = (path: string, change: (text: string) => string) => writeFileSync(join(root, path), change(readFileSync(join(root, path), "utf8")));
  const worse = { kind: "wrong" as const, errorClass: "Test262Error", failure: { exit: 1, signal: null, output: "uncaught Test262Error: 2" } };
  const { run } = recorders(root, {
    "tooling/census/conformance262.ts": () => edit("results/typescript/c/cases.tsv", text => mergeTypeScriptRecord(text, new Map([["tests/typescript/family/recorded.ts", worse]]))),
    "tooling/differential/record-oracles.ts": () => writeFileSync(join(root, "results/oracle-counts/tests/programs/recorded.json"), "{\"rewritten\":true}\n"),
    "tooling/conformance/outcomes-check.ts": () => writeFileSync(join(root, "tests/outcomes/recorded/outcome.json"), stored("wrong-answer", "exit 0; Observed: x=2;")),
  });
  assert.equal(recordPending(root, ["oracle-counts", "typescript", "outcomes"], run, line => lines.push(line)), 1);
  const refusals = lines.filter(line => line.startsWith("  REFUSED "));
  assert.equal(refusals.length, 3, lines.join("\n"));
  assert.ok(refusals.some(line => line.includes("results/typescript/c/cases.tsv: the row of tests/typescript/family/recorded.ts was rewritten, and the ratchet does not accept it")));
  assert.ok(refusals.some(line => line.includes("results/oracle-counts/tests/programs/recorded.json: a recorded population was rewritten")));
  assert.ok(refusals.some(line => line.includes("tests/outcomes/recorded/outcome.json was rewritten, and the ratchet does not accept it")));
  const after = files(root);
  for (const path of ["results/typescript/c/cases.tsv", "results/oracle-counts/tests/programs/recorded.json", "tests/outcomes/recorded/outcome.json"]) {
    assert.equal(after.get(path), before.get(path), `${path} is put back as it was`);
  }
});

test("a row refused as before for other reasons is accepted and labelled so, not as an improvement", t => {
  const root = tree(t), lines: string[] = [];
  const edit = (path: string, change: (text: string) => string) => writeFileSync(join(root, path), change(readFileSync(join(root, path), "utf8")));
  const later: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "NTS1003", where: "body" }, { code: "NTS1100", where: "body" }] };
  const { run } = recorders(root, {
    "tooling/census/conformance262.ts": () => edit("results/typescript/c/cases.tsv", text => mergeTypeScriptRecord(text, new Map([["tests/typescript/family/recorded.ts", later]]))),
  });
  assert.equal(recordPending(root, ["typescript"], run, line => lines.push(line)), 0, lines.join("\n"));
  assert.ok(lines.includes(`  recorded results/typescript/c/cases.tsv: tests/typescript/family/recorded.ts ${JSON.stringify(refused)} -> ${JSON.stringify(later)} (refuses differently)`), lines.join("\n"));
});

test("the dex record starts from its pending rows, takes an improvement, and refuses a regression or a row nobody lacked", () => {
  const file = "results/dex/outcomes.tsv", refused: DexOutcome = { kind: "build-failure", diagnostic: "Illegal class file: x" };
  const text = (rows: Record<string, DexOutcome>) => dexRecord(null, Object.entries(rows).map(([path, outcome]) => ({ path, value: { outcome } })));
  const first = text({ "tests/programs/a": { kind: "pass" }, "benchmarks/cases/b": refused });
  assert.deepEqual(auditRecord("dex", file, null, first, new Set(["tests/programs/a", "benchmarks/cases/b"])).length, 2);
  assert.throws(() => auditRecord("dex", file, null, first, new Set(["tests/programs/a"])), /a row was added for benchmarks\/cases\/b, which was not pending/);
  const fixed = text({ "tests/programs/a": { kind: "pass" }, "benchmarks/cases/b": { kind: "pass" } });
  assert.match(auditRecord("dex", file, first, fixed, new Set()).join("\n"), /^benchmarks\/cases\/b .* \(improved\)$/);
  assert.throws(() => auditRecord("dex", file, fixed, first, new Set()), /the row of benchmarks\/cases\/b was rewritten, and the ratchet does not accept it/);
});

test('budget refreshes need an improvement hint or changed identity, and only a measured count improves them',t=>{
  const root=tree(t),fixture='benchmarks/cases/recorded',source=fixture+'/case.ts',file=recordPath(fixture);
  const common={source,signature:'b'.repeat(64),keys:{c:'c'.repeat(32)},cases_sha256:'d'.repeat(64),driver_sha256:'e'.repeat(64)};
  const budget={kind:'budget',...common,source_digest:'a'.repeat(32),budget:{version:1,phase:'execute',outcome:'timeout',bound:60,signal:'SIGKILL',reason:'oracle timed out'},revision:oracleBudgetRevision(root,source)};
  const before=JSON.stringify({version:2,fixture,rows:[budget]});writeFileSync(join(root,file),before);
  assert.equal(findPending(root,'oracle-counts').some(one=>one.name===fixture),false);
  assert.deepEqual(oracleRefreshes(root),[],'an unchanged budget is not retried by every records pass');
  const sidecar=join(root,fixture,'case.domains.json');writeFileSync(sidecar,'{"version":1,"functions":{}}');
  assert.deepEqual(oracleRefreshes(root).map(one=>one.name),[fixture],'a changed declared population requests fresh measurement');
  rmSync(sidecar);
  requestOracleImprovement(root,join(root,source));
  assert.ok(oracleImprovementPath(fixture).startsWith(join(root,'home')+'/'),'the hint belongs to the fixture HOME');
  assert.ok(existsSync(oracleImprovementPath(fixture)),'the only hint was written inside the fixture');
  assert.deepEqual(oracleRefreshes(root).map(one=>one.name),[fixture],'a completed check schedules fresh recording, not a cached count');
  const measured={kind:'measured',...common,complete:true,count:4,node_cpu_s:[1,1]};
  const after=JSON.stringify({version:1,fixture,rows:[measured]});
  assert.deepEqual(auditRecord('oracle-counts',file,before,after,new Set()),[source+' budget -> measured']);
  assert.throws(()=>auditRecord('oracle-counts',file,after,before,new Set()),/recorded population was rewritten/);
  writeFileSync(join(root,file),after);assert.deepEqual(oracleRefreshes(root),[],'the stale hint cannot request an already measured population');
  writeFileSync(join(root,file),before);writeFileSync(join(root,source),'export function run(){return 2;}');
  assert.deepEqual(oracleRefreshes(root).map(one=>one.name),[fixture],'a changed case independently requests fresh measurement');
});

test('a plan budget is refreshed as a budget is: planned on the backends it named, or its identity changed, never over a measured population',t=>{
  const root=tree(t),fixture='benchmarks/cases/recorded',source=fixture+'/case.ts',file=recordPath(fixture);
  const unplanned={source,backends:['c','llvm'],budget:{version:1,phase:'plan',outcome:'timeout',bound:600,signal:'SIGKILL',reason:'oracle planner timed out'},revision:oracleUnplannedRevision(root,fixture)};
  const record=(rows:object[],plan?:object)=>JSON.stringify({version:2,fixture,rows,...(plan?{unplanned:plan}:{})});
  const before=record([],unplanned);writeFileSync(join(root,file),before);
  assert.deepEqual(oracleRefreshes(root),[],'an unchanged plan budget is not retried by every records pass');
  writeFileSync(join(root,fixture,'helper.ts'),'export const two = 2;\n');
  assert.deepEqual(oracleRefreshes(root).map(one=>one.name),[fixture],'a change to any file of its fixture plans it again');
  rmSync(join(root,fixture,'helper.ts'));
  assert.deepEqual(oracleRefreshes(root),[]);
  requestOracleImprovement(root,join(root,source));
  assert.deepEqual(oracleRefreshes(root).map(one=>one.name),[fixture],'its entry planned in a check: fresh recording');
  const measured=(keys:Record<string,string>)=>({kind:'measured',source,signature:'b'.repeat(64),keys,cases_sha256:'d'.repeat(64),driver_sha256:'e'.repeat(64),complete:true,count:4});
  const narrowed=record([measured({c:'c'.repeat(32)})],{...unplanned,backends:['llvm']});
  assert.deepEqual(auditRecord('oracle-counts',file,before,narrowed,new Set()),[`${source} plan budget -> measured`,`${source} plan budget narrowed to llvm`]);
  const planned=record([measured({c:'c'.repeat(32),llvm:'f'.repeat(32)})]);
  assert.deepEqual(auditRecord('oracle-counts',file,narrowed,planned,new Set()),[`${source} planned on llvm`,`${source} plan budget gone: planned on every backend`]);
  const identity=record([],{...unplanned,revision:{...unplanned.revision,entry:'9'.repeat(64)}});
  assert.deepEqual(auditRecord('oracle-counts',file,before,identity,new Set()),[`${source} plan budget identity changed`]);
  for(const [was,now,refusal] of [
    [before,record([measured({jvm:'9'.repeat(32)})]),/population inventory/],
    [narrowed,record([measured({c:'c'.repeat(32)})],unplanned),/may only narrow, go or change its identity/],
    [narrowed,record([measured({c:'1'.repeat(32),llvm:'f'.repeat(32)})]),/only a budget -> measured improvement/],
    [planned,record([measured({c:'c'.repeat(32),llvm:'f'.repeat(32)})],unplanned),/a recorded population was rewritten; a count has no improvement/],
  ] as const)assert.throws(()=>auditRecord('oracle-counts',file,was,now,new Set()),refusal);
  // A budget row's entry past its plan bound: a plan budget beside it, never one over a measured population.
  const stopped={kind:'budget',source,signature:'b'.repeat(64),keys:{c:'c'.repeat(32)},cases_sha256:'d'.repeat(64),driver_sha256:'e'.repeat(64),source_digest:'a'.repeat(32),
    budget:{version:1,phase:'execute',outcome:'timeout',bound:60,signal:'SIGKILL',reason:'oracle timed out'},revision:oracleBudgetRevision(root,source)};
  assert.deepEqual(auditRecord('oracle-counts',file,record([stopped]),record([stopped],{...unplanned,backends:['c']}),new Set()),[`${source} budget -> plan budget`]);
  assert.throws(()=>auditRecord('oracle-counts',file,record([stopped,{...measured({llvm:'f'.repeat(32)}),signature:'a'.repeat(64)}]),
    record([stopped,{...measured({llvm:'f'.repeat(32)}),signature:'a'.repeat(64)}],{...unplanned,backends:['llvm']}),new Set()),/cannot replace a measured population/);
});

test("a kind with nothing pending runs only for an accepted change a check listed, and the census only on that backend", t => {
  const root = tree(t), logs = testScratch(t, "record-pending-run");
  assert.equal(recordPending(root, ["oracle-counts", "typescript", "benchmarks", "outcomes"], recorders(root).run, () => {}), 0);
  writeFileSync(join(logs, "typescript-c.log"), `  ${improvedLine("tests/typescript/family/recorded.ts", "results/typescript/llvm/cases.tsv", "refused", "pass")}\n`);
  const lines: string[] = [], { run, ran } = recorders(root, Object.fromEntries(["tooling/census/conformance262.ts", "tooling/conformance/outcomes-check.ts"].map(script => [script, () => {}])));
  assert.equal(recordPending(root, ["typescript", "outcomes"], run, line => lines.push(line), acceptedIn(root, logs).byKind), 0, lines.join("\n"));
  assert.deepEqual(ran, [["tooling/census/conformance262.ts", "--suite", "typescript", "--backend", "llvm", "--record-pending", "results/typescript/llvm/cases.tsv"]],
    "the TypeScript census runs on the one backend whose record has a change listed; outcomes is not run");
  assert.ok(lines.includes("outcomes: nothing pending and no accepted change listed; not run"), lines.join("\n"));
});

test("accepted changes go to the kind whose record they name, a refusal for other reasons among them", t => {
  const root = tree(t), logs = testScratch(t, "record-pending-logs");
  writeFileSync(join(logs, "outcomes.log"), `${refusesDifferentlyLine("tests/outcomes/recorded", "tests/outcomes/recorded/outcome.json", "refused", "refused")}\n`);
  writeFileSync(join(logs, "bench-agree.log"), `  ${improvedLine("benchmarks/cases/recorded", "results/benchmarks/jvm/runs.tsv", "aborted", "agrees")}\n`);
  writeFileSync(join(logs, "examples.log"), `${improvedLine("tests/programs/c", "results/elsewhere.tsv", "refused", "pass")}\n`);
  writeFileSync(join(logs, "typescript-llvm.log"), "pending: tests/typescript/x.ts is not recorded in results/typescript/llvm/cases.tsv yet\n");
  const accepted = acceptedIn(root, logs);
  assert.deepEqual([...accepted.byKind.keys()].sort(), ["benchmark-runs", "outcomes"]);
  assert.deepEqual(accepted.byKind.get("outcomes"), [{ kind: "outcomes", name: "tests/outcomes/recorded", record: "tests/outcomes/recorded/outcome.json" }]);
  assert.deepEqual(accepted.unowned, ["results/elsewhere.tsv"], "a record no kind writes is said, not guessed at");
});

test("each kind is recorded after the part that runs its checks, and names only steps the gate has", () => {
  assert.deepEqual(KINDS.filter(kind => partOf(kind) === "wide"), ["test262", "benchmark-runs", "dex", "compile-times"]);
  const steps = new Set(STEPS.map(step => step.name));
  for (const kind of KINDS) for (const step of KIND_STEPS[kind]) assert.ok(steps.has(step), `${kind}: ${step} is a gate step`);
});

const ARM_RECORDS = (arm: CompileArm) => [COMPILE_ARMS[arm].table, COMPILE_ARMS[arm].calibration];

test("a compile-time module with no row is pending in both records of each arm, and one calibration per arm records both", t => {
  const root = tree(t), before = files(root), lines: string[] = [];
  assert.deepEqual(findPending(root, "compile-times").map(one => [one.name, one.record]),
    (["nogc", "rc"] as const).flatMap(arm => ARM_RECORDS(arm).map(record => ["tests/compile-time/new", record])));
  const { run, ran } = recorders(root);
  assert.equal(recordPending(root, ["compile-times"], run, line => lines.push(line)), 0, lines.join("\n"));
  assert.deepEqual(ran.map(args => args.join(" ")), (["nogc", "rc"] as const).map(arm => `tooling/gate/compile-counter-calibrate.ts --arm ${arm} --module tests/compile-time/new --record`));
  assert.deepEqual(lines.filter(line => line.startsWith("  recorded ")),
    (["nogc", "rc"] as const).flatMap(arm => ARM_RECORDS(arm).map(record => `  recorded ${record}: tests/compile-time/new 50.030 G (pending)`)));
  const after = files(root), touched = new Set((["nogc", "rc"] as const).flatMap(ARM_RECORDS));
  for (const [path, text] of before) if (!touched.has(path)) assert.equal(after.get(path), text, `${path} is untouched`);
  assert.match(after.get(COMPILE_ARMS.nogc.table)!, /\nruntime\/node\/recorded\t100\.030\t10\.000\ntests\/compile-time\/new\t50\.030\t10\.000\n$/,
    "the recorded row as it was, the new row in its place");
  assert.deepEqual(findPending(root, "compile-times"), [], "nothing pending");
  // Nothing pending and nothing listed: no calibration runs, and nothing moves.
  const quiet: string[] = [], idle = recorders(root);
  assert.equal(recordPending(root, ["compile-times"], idle.run, line => quiet.push(line)), 0);
  assert.deepEqual(idle.ran, []);
  assert.ok(quiet.includes("compile-times: nothing pending and no accepted change listed; not run"), quiet.join("\n"));
  assert.deepEqual(files(root), after);
});

test("an improved compile-time module the tripwire listed is re-recorded in its arm alone", t => {
  const root = tree(t), logs = testScratch(t, "record-pending-compile-logs"), lines: string[] = [];
  rmSync(join(root, "tests/compile-time/new"), { recursive: true });
  writeFileSync(join(logs, "compile-time.log"), `  ${improvedLine("runtime/node/recorded", COMPILE_ARMS.nogc.table, "100.030 G", "80.030 G")}\n`);
  const accepted = acceptedIn(root, logs).byKind;
  assert.deepEqual(accepted.get("compile-times"), [{ kind: "compile-times", name: "runtime/node/recorded", record: COMPILE_ARMS.nogc.table }]);
  const { run, ran } = recorders(root);
  assert.equal(recordPending(root, ["compile-times"], run, line => lines.push(line), accepted), 0, lines.join("\n"));
  assert.deepEqual(ran, [["tooling/gate/compile-counter-calibrate.ts", "--arm", "nogc", "--module", "runtime/node/recorded", "--record"]]);
  assert.deepEqual(lines.filter(line => line.startsWith("  recorded ")),
    ARM_RECORDS("nogc").map(record => `  recorded ${record}: runtime/node/recorded 100.030 G -> 80.030 G (improved)`));
  assert.match(readFileSync(join(root, COMPILE_ARMS.rc.table), "utf8"), /^runtime\/node\/recorded\t100\.030\t/m, "the arm nothing listed keeps its row");
});

test("a compile-time rewrite that is not lower, a row nobody lacked, or an arm whose two records disagree is refused and put back", t => {
  const cases: [string, (root: string) => void, RegExp][] = [
    ["higher", root => calibrate(root, "nogc", "runtime/node/recorded", 120), /the row of runtime\/node\/recorded was rewritten, and the ratchet does not accept it/],
    ["unpaired", root => rewrite(root, COMPILE_ARMS.nogc.table, text => `${text}tests/compile-time/new\t50.000\t10.000\n`), /do not list the same modules; both put back as they were/],
  ];
  for (const [name, write, refusal] of cases) {
    const root = tree(t), logs = testScratch(t, `record-pending-compile-${name}`), lines: string[] = [];
    writeFileSync(join(logs, "compile-time.log"), `  ${improvedLine("runtime/node/recorded", COMPILE_ARMS.nogc.table, "100.030 G", "90.000 G")}\n`);
    const before = files(root);
    const { run } = recorders(root, { "tooling/gate/compile-counter-calibrate.ts": () => write(root) });
    assert.equal(recordPending(root, ["compile-times"], run, line => lines.push(line), acceptedIn(root, logs).byKind), 1, `${name}: ${lines.join("\n")}`);
    assert.ok(lines.some(line => line.startsWith("  REFUSED ") && refusal.test(line)), `${name}: ${lines.join("\n")}`);
    for (const file of ARM_RECORDS("nogc")) assert.equal(readFileSync(join(root, file), "utf8"), before.get(file), `${name}: ${file} is put back`);
  }
  // A row may be added only where a module was pending, and the header and policy never move.
  const table = readFileSync(join(tree(t), COMPILE_ARMS.nogc.table), "utf8");
  assert.throws(() => auditRecord("compile-times", COMPILE_ARMS.nogc.table, table, `${table}runtime/node/ghost\t1.000\t1.000\n`, new Set(["tests/compile-time/new"])),
    /a row was added for runtime\/node\/ghost, which was not pending/);
  assert.throws(() => auditRecord("compile-times", COMPILE_ARMS.nogc.table, table, table.replace("# regression-ratio: 1.10", "# regression-ratio: 1.50"), new Set()), /the header changed/);
});

// The delta, and --apply: the rows a records run wrote, merged by case into a
// main that moved on while it ran.

const write = (root: string, path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const rewrite = (root: string, path: string, change: (text: string) => string) => writeFileSync(join(root, path), change(readFileSync(join(root, path), "utf8")));
const CORE: Kind[] = ["oracle-counts", "typescript", "benchmarks", "outcomes"];
/** The digests the stand-in compile rows carry (cell), as main computes them unless a test says otherwise. */
const asRecorded: BenchmarkDigests = async (_root, paths) => new Map(paths.map(path => [path, { source: "1".repeat(64), driver: "2".repeat(64) }]));

/** A tree recorded in with a delta, and main: a copy of it from before the records run, which then moves on its own. */
function recordedBeside(t: { after(fn: () => void): void }, kinds: Kind[] = CORE, overrides: Partial<Record<string, () => void>> = {}) {
  const root = tree(t), main = testScratch(t, "record-pending-main"), file = join(testScratch(t, "record-pending-run"), DELTA_FILE), lines: string[] = [];
  cpSync(root, main, { recursive: true });
  assert.equal(recordPending(root, kinds, recorders(root, overrides).run, line => lines.push(line), new Map(), file), 0, lines.join("\n"));
  return { root, main, lines, file, delta: parseDelta(readFileSync(file, "utf8")) };
}
async function applied(main: string, delta: Delta, benchmarks = asRecorded) {
  const lines: string[] = [];
  return { counts: await applyDelta(main, delta, { say: line => lines.push(line), benchmarks }), lines };
}

test("the recorder writes the delta of what it recorded: each case's row before and after, and a digest of its sources", t => {
  const { root, main, lines, file, delta } = recordedBeside(t);
  assert.ok(lines.includes(`record-pending: the delta of its 16 row(s) is ${file}`), lines.join("\n"));
  assert.equal(delta.commit, null, "a tree outside a checkout names no commit");
  assert.deepEqual(delta.rows.filter(row => row.record === "results/typescript/c/cases.tsv").map(row => [row.case, row.key, row.before === null]),
    [["tests/typescript/family/new.ts", "tests/typescript/family/new.ts", true], ["tests/typescript/family/recorded.ts", "tests/typescript/family/recorded.ts", false]]);
  const improved = delta.rows.find(row => row.record === "results/typescript/c/cases.tsv" && row.before !== null)!;
  assert.deepEqual([improved.before, improved.after], [`tests/typescript/family/recorded.ts\t${JSON.stringify(refused)}`, `tests/typescript/family/recorded.ts\t{"kind":"pass"}`]);
  assert.deepEqual(delta.rows.filter(row => row.record === "results/benchmarks/llvm/outcomes.tsv").map(row => row.key),
    ["benchmarks/cases/new\0compile", "benchmarks/cases/recorded\0compile"], "a compile row's key is its benchmark and scope");
  const shard = delta.rows.find(row => row.record === "results/oracle-counts/tests/programs/new.json")!;
  assert.deepEqual([shard.kind, shard.case, shard.key, shard.before, shard.after], ["oracle-counts", "tests/programs/new", "tests/programs/new", null, readFileSync(join(root, shard.record), "utf8")]);
  assert.equal(delta.headers["results/typescript/jvm/cases.tsv"], readFileSync(join(root, "results/typescript/jvm/cases.tsv"), "utf8").split("\n")[0]);
  assert.deepEqual(Object.keys(delta.headers).sort(), [...BACKENDS.map(backend => `results/benchmarks/${backend}/outcomes.tsv`), ...BACKENDS.map(backend => `results/typescript/${backend}/cases.tsv`)].sort(),
    "a header for each line record, none for a file-per-case one");
  for (const row of delta.rows) assert.match(row.sources, /^[0-9a-f]{64}$/, `${row.case}'s sources`);
  // An outcomes fixture's digest is of its program, not of its record: the one rewritten here is the one main has.
  const outcome = delta.rows.find(row => row.case === "tests/outcomes/recorded")!;
  assert.equal(sourceDigests(main, [{ kind: "outcomes", name: "tests/outcomes/recorded" }]).get("outcomes\0tests/outcomes/recorded"), outcome.sources);
});

test("a delta applies by case over a main that moved on in the same records, its rows landing beside main's own", async t => {
  const { root, main, delta } = recordedBeside(t);
  // While the records ran, main landed a case of its own in each record, its rows
  // beside the ones the records run adds, and an unrelated change elsewhere.
  write(main, "tests/typescript/family/later.ts", "/*---\nfeatures: []\n---*/\nassert.sameValue(2, 2);\n");
  write(main, "benchmarks/cases/aaa/case.ts", "export function run(): number { return 2; }\n");
  for (const backend of BACKENDS) {
    rewrite(main, `results/typescript/${backend}/cases.tsv`, text => mergeTypeScriptRecord(text, new Map([["tests/typescript/family/later.ts", refused]])));
    rewrite(main, `results/benchmarks/${backend}/outcomes.tsv`, text => mergeBenchmarkRecord(text, [cell("aaa", { kind: "pass" })]));
  }
  write(main, "results/oracle-counts/benchmarks/cases/aaa.json", `{"fixture":"benchmarks/cases/aaa"}\n`);
  write(main, "docs/elsewhere.md", "main moved\n");
  const { counts, lines } = await applied(main, delta);
  assert.deepEqual(counts, { applied: 16, already: 0, skipped: 0 }, lines.join("\n"));
  assert.deepEqual(appliedIn(lines.join("\n")), counts, "it ends with the line the full check reads back");
  for (const backend of BACKENDS) {
    assert.deepEqual(readFileSync(join(main, `results/typescript/${backend}/cases.tsv`), "utf8").split("\n").slice(1), [
      `tests/typescript/family/later.ts\t${JSON.stringify(refused)}`, `tests/typescript/family/new.ts\t{"kind":"pass"}`, `tests/typescript/family/recorded.ts\t{"kind":"pass"}`, ""],
      "main's row, the delta's pending row and its improvement, in the record's own order");
    assert.match(readFileSync(join(main, `results/benchmarks/${backend}/outcomes.tsv`), "utf8"), /^benchmarks\/cases\/aaa\t.*\nbenchmarks\/cases\/new\t.*\nbenchmarks\/cases\/recorded\t.*"kind":"pass"/m);
  }
  for (const kind of CORE) assert.deepEqual(findPending(main, kind).map(one => one.name).filter(name => !name.endsWith("/aaa") && !name.endsWith("later.ts")), [], `${kind}: the delta's cases are recorded`);
  for (const row of delta.rows.filter(row => row.kind === "oracle-counts" || row.kind === "outcomes")) assert.equal(readFileSync(join(main, row.record), "utf8"), row.after, `${row.record} is the recorded file`);
  assert.equal(existsSync(join(root, "docs/elsewhere.md")), false, "the tree recorded in is not main");
});

test("a case whose row main changed, or whose row main no longer has, is skipped and said; the rest of its record applies", async t => {
  const { main, delta } = recordedBeside(t);
  const otherwise: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "NTS1003", where: "body" }] };
  rewrite(main, "results/typescript/c/cases.tsv", text => mergeTypeScriptRecord(text, new Map([["tests/typescript/family/new.ts", otherwise]])));
  rewrite(main, "results/typescript/llvm/cases.tsv", text => mergeTypeScriptRecord(text, new Map([["tests/typescript/family/recorded.ts", otherwise]])));
  rmSync(join(main, "tests/outcomes/recorded/outcome.json"));
  const before = readFileSync(join(main, "results/typescript/c/cases.tsv"), "utf8");
  const { counts, lines } = await applied(main, delta);
  assert.deepEqual(counts, { applied: 13, already: 0, skipped: 3 }, lines.join("\n"));
  const skipped = lines.filter(line => line.startsWith("  skipped "));
  assert.deepEqual(skipped, [
    "  skipped results/typescript/c/cases.tsv: tests/typescript/family/new.ts: a row of another measurement was recorded for it; the next records run takes it up",
    "  skipped results/typescript/llvm/cases.tsv: tests/typescript/family/recorded.ts: its row changed; the next records run takes it up",
    "  skipped tests/outcomes/recorded/outcome.json: tests/outcomes/recorded: its row is gone; the next records run takes it up",
  ]);
  assert.equal(readFileSync(join(main, "results/typescript/c/cases.tsv"), "utf8"), mergeTypeScriptRecord(before, new Map([["tests/typescript/family/recorded.ts", { kind: "pass" }]])),
    "main's own row stays, and the record's other row applies");
  assert.equal(existsSync(join(main, "tests/outcomes/recorded/outcome.json")), false, "a row main deleted stays deleted: its case is pending again");
});

test("a case main deleted, or whose sources main changed, is skipped: a row applies only to the case it was measured from", async t => {
  const { main, delta } = recordedBeside(t);
  rmSync(join(main, "benchmarks/cases/new"), { recursive: true });
  rewrite(main, "tests/typescript/family/new.ts", text => text.replace("assert.sameValue(1, 1)", "assert.sameValue(1, 2)"));
  rewrite(main, "tests/programs/new/src/main.ts", text => `${text}export const changed = true;\n`);
  const { counts, lines } = await applied(main, delta);
  assert.deepEqual(counts, { applied: 8, already: 0, skipped: 8 }, lines.join("\n"));
  const why = (record: string) => lines.find(line => line.startsWith(`  skipped ${record}: `))?.split(": ").slice(2).join(": ");
  for (const backend of BACKENDS) {
    assert.equal(why(`results/benchmarks/${backend}/outcomes.tsv`), "it is not a pending case here; the next records run takes it up");
    assert.equal(why(`results/typescript/${backend}/cases.tsv`), "its sources changed; the next records run takes it up");
  }
  assert.equal(why("results/oracle-counts/tests/programs/new.json"), "its sources changed; the next records run takes it up");
  assert.ok(lines.includes("  skipped results/oracle-counts/benchmarks/cases/new.json: benchmarks/cases/new: it is not a pending case here; the next records run takes it up"), lines.join("\n"));
  assert.equal(findPending(main, "typescript").length, 3, "the edited case stays pending on every backend");
});

test("a compile row is held to main's own source and driver digests: computed otherwise there, it is another case's row", async t => {
  // ff64edcbb changed how a benchmark's source identity is computed while a
  // records run held rows digested the old way; the text rebase then refused all 73.
  const { main, delta } = recordedBeside(t);
  const changed: BenchmarkDigests = async (_root, paths) => new Map(paths.map(path => [path, { source: (path.endsWith("/new") ? "3" : "1").repeat(64), driver: "2".repeat(64) }]));
  const { counts, lines } = await applied(main, delta, changed);
  assert.deepEqual(counts, { applied: 13, already: 0, skipped: 3 }, lines.join("\n"));
  for (const backend of BACKENDS) {
    assert.ok(lines.includes(`  skipped results/benchmarks/${backend}/outcomes.tsv: benchmarks/cases/new: its source digest is 333333333333 here, not the recorded 111111111111; the next records run takes it up`), lines.join("\n"));
  }
  const unknown: BenchmarkDigests = async () => { throw new Error("typescript/sync is not installed"); };
  const again = await applied(recordedBeside(t).main, delta, unknown);
  assert.equal(again.counts.skipped, 6, again.lines.join("\n"));
  assert.ok(again.lines.some(line => line.endsWith("its source digest cannot be computed here: typescript/sync is not installed; the next records run takes it up")), again.lines.join("\n"));
});

test("a compile row is held to its own digests, not to its directory's: a population declaration main added skips only the oracle count", async t => {
  const { main, delta } = recordedBeside(t);
  write(main, "benchmarks/cases/new/case.domains.json", '{"version":1,"functions":{}}\n');
  const { counts, lines } = await applied(main, delta);
  assert.deepEqual(counts, { applied: 15, already: 0, skipped: 1 }, lines.join("\n"));
  assert.deepEqual(lines.filter(line => line.startsWith("  skipped ")),
    ["  skipped results/oracle-counts/benchmarks/cases/new.json: benchmarks/cases/new: its sources changed; the next records run takes it up"]);
  for (const backend of BACKENDS) assert.ok(lines.includes(`  applied results/benchmarks/${backend}/outcomes.tsv: benchmarks/cases/new (pending)`), lines.join("\n"));
});

test("a row main has already is said, and a delta applied twice changes nothing the second time", async t => {
  const { main, delta } = recordedBeside(t);
  await applied(main, delta);
  const once = new Map([...files(main)]);
  const { counts, lines } = await applied(main, delta);
  assert.deepEqual(counts, { applied: 0, already: 16, skipped: 0 }, lines.join("\n"));
  assert.ok(lines.includes("  already recorded results/typescript/c/cases.tsv: tests/typescript/family/new.ts"), lines.join("\n"));
  assert.deepEqual(files(main), once);
});

test("one row main's rule refuses keeps no other from its record", async t => {
  const { main, delta } = recordedBeside(t);
  // main improved the case itself, and a delta row would take it back down.
  rewrite(main, "results/typescript/jvm/cases.tsv", text => mergeTypeScriptRecord(text, new Map([["tests/typescript/family/recorded.ts", { kind: "pass" }]])));
  const worse = delta.rows.map(row => row.record === "results/typescript/jvm/cases.tsv" && row.before !== null
    ? { ...row, before: `tests/typescript/family/recorded.ts\t{"kind":"pass"}`, after: `tests/typescript/family/recorded.ts\t${JSON.stringify(refused)}` } : row);
  const { counts, lines } = await applied(main, { ...delta, rows: worse });
  assert.deepEqual(counts, { applied: 15, already: 0, skipped: 1 }, lines.join("\n"));
  assert.ok(lines.some(line => line.startsWith("  skipped results/typescript/jvm/cases.tsv: tests/typescript/family/recorded.ts: its record refuses it here: ")
    && line.includes("the ratchet does not accept it")), lines.join("\n"));
  assert.match(readFileSync(join(main, "results/typescript/jvm/cases.tsv"), "utf8"), /^tests\/typescript\/family\/new\.ts\t\{"kind":"pass"\}\ntests\/typescript\/family\/recorded\.ts\t\{"kind":"pass"\}$/m);
});

test("a line record main does not have yet starts from the header its recorder wrote", async t => {
  const dex = (root: string) => () => write(root, "results/dex/outcomes.tsv", dexRecord(null, ["benchmarks/cases/new", "benchmarks/cases/recorded", "tests/programs/new", "tests/programs/recorded"]
    .map(path => ({ path, value: { outcome: { kind: "pass" as const } } }))));
  const root = tree(t), main = testScratch(t, "record-pending-main"), file = join(testScratch(t, "record-pending-run"), DELTA_FILE);
  cpSync(root, main, { recursive: true });
  assert.equal(recordPending(root, ["dex"], recorders(root, { "tooling/android/dex-record.ts": dex(root) }).run, () => {}, new Map(), file), 0);
  const delta = parseDelta(readFileSync(file, "utf8"));
  assert.equal(delta.headers["results/dex/outcomes.tsv"], "# nts-dex-outcomes {\"version\":1}");
  const { counts, lines } = await applied(main, delta);
  assert.deepEqual(counts, { applied: 4, already: 0, skipped: 0 }, lines.join("\n"));
  assert.equal(readFileSync(join(main, "results/dex/outcomes.tsv"), "utf8"), readFileSync(join(root, "results/dex/outcomes.tsv"), "utf8"));
  // A TypeScript record is written whole by a full --record, never started from a
  // delta: without it, main's pending TypeScript cases cannot even be listed.
  const fresh = recordedBeside(t);
  rmSync(join(fresh.main, "results/typescript/c/cases.tsv"));
  const missing = await applied(fresh.main, fresh.delta);
  assert.ok(missing.lines.includes("  skipped results/typescript/c/cases.tsv: tests/typescript/family/new.ts: the pending typescript cases cannot be listed here: "
    + `ENOENT: no such file or directory, open '${join(fresh.main, "results/typescript/c/cases.tsv")}'; the next records run takes it up`), missing.lines.join("\n"));
  assert.equal(existsSync(join(fresh.main, "results/typescript/c/cases.tsv")), false);
});

test("a compile-time delta carries each module's table line and evidence entry, and --apply takes both or neither", async t => {
  const { root, main, delta } = recordedBeside(t, ["compile-times"]);
  assert.deepEqual(delta.rows.map(row => [row.record, row.case, row.before]).sort(),
    (["nogc", "rc"] as const).flatMap(arm => ARM_RECORDS(arm).map(record => [record, "tests/compile-time/new", null])).sort());
  assert.deepEqual(Object.keys(delta.headers), [], "a compile-time record is never started from a delta");
  const { counts, lines } = await applied(main, delta);
  assert.deepEqual(counts, { applied: 4, already: 0, skipped: 0 }, lines.join("\n"));
  for (const file of (["nogc", "rc"] as const).flatMap(ARM_RECORDS)) {
    assert.equal(readFileSync(join(main, file), "utf8"), readFileSync(join(root, file), "utf8"), `${file} holds what the recorder wrote`);
  }
  assert.deepEqual(findPending(main, "compile-times"), []);
  // A main whose evidence took another entry for the module in one arm applies neither of that arm's rows.
  const moved = recordedBeside(t, ["compile-times"]);
  rewrite(moved.main, COMPILE_ARMS.nogc.calibration, text => {
    const record = JSON.parse(text), entry = { ...structuredClone(record.modules[0]), module: "tests/compile-time/new" };
    return `${JSON.stringify({ ...record, modules: [...record.modules, entry] }, null, 2)}\n`;
  });
  const partial = await applied(moved.main, moved.delta);
  assert.deepEqual(partial.counts, { applied: 2, already: 0, skipped: 2 }, partial.lines.join("\n"));
  assert.ok(partial.lines.includes(`  skipped ${COMPILE_ARMS.nogc.table}: tests/compile-time/new: its row in ${COMPILE_ARMS.nogc.calibration} does not apply here; the next records run takes it up`),
    partial.lines.join("\n"));
  assert.doesNotMatch(readFileSync(join(moved.main, COMPILE_ARMS.nogc.table), "utf8"), /tests\/compile-time\/new/, "no table row lands without its proof");
  assert.match(readFileSync(join(moved.main, COMPILE_ARMS.rc.table), "utf8"), /^tests\/compile-time\/new\t50\.030\t/m);
  // A delta with one of the two rows cannot be applied at all.
  const half = join(testScratch(t, "record-pending-half"), "delta.json");
  writeFileSync(half, serializeDelta({ ...delta, rows: delta.rows.filter(row => row.record === COMPILE_ARMS.nogc.table) }));
  const errors: string[] = [], original = console.error;
  console.error = (line: string) => { errors.push(line); };
  try { assert.equal(await applyCommand(main, [half], () => {}), 1); } finally { console.error = original; }
  assert.ok(errors.some(line => line.includes(`it comes without its row in ${COMPILE_ARMS.nogc.calibration}`)), errors.join("\n"));
});

test("--apply refuses a delta it cannot read, or one that names a record no recorder writes, before writing anything", async t => {
  const root = tree(t), before = files(root), scratch = testScratch(t, "record-pending-apply");
  const file = (name: string, text: string) => { const path = join(scratch, name); writeFileSync(path, text); return path; };
  const errors: string[] = [], said: string[] = [];
  const original = console.error;
  console.error = (line: string) => { errors.push(line); };
  t.after(() => { console.error = original; });
  const row = { kind: "typescript", record: "results/typescript/c/cases.tsv", case: "tests/typescript/family/new.ts", key: "tests/typescript/family/new.ts",
    before: null, after: `tests/typescript/family/new.ts\t{"kind":"pass"}`, sources: "a".repeat(64) };
  const elsewhere: Delta = { version: 1, commit: null, headers: {}, rows: [row, { ...row, kind: "outcomes", record: "tooling/gate/all.sh", case: "tests/outcomes/x", key: "tests/outcomes/x" }] };
  assert.equal(await applyCommand(root, [file("unreadable.json", "{")], line => said.push(line)), 1);
  assert.equal(await applyCommand(root, [file("version.json", JSON.stringify({ version: 2, commit: null, headers: {}, rows: [] }))]), 1);
  assert.equal(await applyCommand(root, [file("elsewhere.json", serializeDelta(elsewhere))], line => said.push(line)), 1);
  assert.equal(await applyCommand(root, [join(scratch, "missing.json")]), 1);
  assert.equal(await applyCommand(root, []), 2);
  assert.match(errors.join("\n"), /tooling\/gate\/all\.sh: tests\/outcomes\/x: no outcomes recorder writes that record/);
  assert.equal(said.length, 0, "nothing is applied from a malformed delta, the well-formed rows of it included");
  assert.deepEqual(files(root), before);
  const empty = file("empty.json", serializeDelta({ version: 1, commit: null, headers: {}, rows: [] }));
  assert.equal(await applyCommand(root, [empty], line => said.push(line)), 0);
  assert.deepEqual(appliedIn(said.join("\n")), { applied: 0, already: 0, skipped: 0 });
});

// test262: its record holds the cases that ran, so its census lists the cases
// that run now, and the writer records exactly those.

const T262 = "results/test262/c/harness.tsv";
const T262_HEADER = "# Test262 test/harness cases that ran, and what each did. Written by\n# tooling/census/conformance262.ts --record; compared by --check.\n"
  + `# compiler ${"a".repeat(16)}, commit ${"a".repeat(40)}, backend c, harness ${"b".repeat(16)}; machine at start: 30 GB available; 2 worker(s)\n`;
/** A tree with one test262 record (a recorded fail, a recorded pass) and its census's cases in the test262 checkout. */
function test262Tree(t: { after(fn: () => void): void }): string {
  const root = tree(t);
  write(root, T262, `${T262_HEADER}test/harness/fails.js\tfail\tuncaught Test262Error: #1\ntest/harness/passes.js\tpass\t\n`);
  for (const name of ["fails", "passes", "new-fail", "new-pass", "other"]) write(root, `third_party/test262/test/harness/${name}.js`, `// ${name}\n`);
  return root;
}
/** The census step's log: two cases that run now, and a recorded fail that passes. */
function censusLog(t: { after(fn: () => void): void }): string {
  const logs = testScratch(t, "record-pending-census");
  writeFileSync(join(logs, "test262-census-c.log"), [
    `              ${pendingLine("test/harness/new-pass.js", T262)}: pass`,
    `              ${pendingLine("test/harness/new-fail.js", T262)}: fail: uncaught Test262Error: #2`,
    `              ${improvedLine("test/harness/fails.js", T262, "fail", "pass")}`,
  ].join("\n") + "\n");
  return logs;
}
type T262Row = [string, "pass" | "fail", string];
/** The writer's stand-in: the rows its repeats agreed on, merged as the real one merges them. */
const writes = (root: string, rows: T262Row[]) => () =>
  rewrite(root, T262, text => mergeTest262Record(text, new Map(rows.map(([path, outcome, detail]) => [path, { outcome, detail }]))));
const AGREED: T262Row[] = [["test/harness/new-pass.js", "pass", ""], ["test/harness/new-fail.js", "fail", "uncaught Test262Error: #2"], ["test/harness/fails.js", "pass", ""]];

test("test262's pending cases are the ones its census listed, and one writer per record measures exactly them", t => {
  const root = test262Tree(t), before = files(root), lines: string[] = [];
  assert.deepEqual(findPending(root, "test262"), [], "a case with no row is usually refused, so the tree lists none");
  const listed = acceptedIn(root, censusLog(t));
  assert.deepEqual(listed.pendingByKind.get("test262")?.map(one => [one.name, one.record]), [["test/harness/new-fail.js", T262], ["test/harness/new-pass.js", T262]]);
  assert.deepEqual(listed.byKind.get("test262")?.map(one => one.name), ["test/harness/fails.js"]);
  const { run, ran } = recorders(root, { "tooling/census/conformance262.ts": writes(root, AGREED) });
  assert.equal(recordPending(root, ["test262"], run, line => lines.push(line), listed.byKind, undefined, listed.pendingByKind), 0, lines.join("\n"));
  assert.deepEqual(ran, [["tooling/census/conformance262.ts", "--suite", "test262", "--backend", "c", "--under", "test/harness", "--record-pending", T262, "--repeats", "3",
    "--case", "test/harness/fails.js", "--case", "test/harness/new-fail.js", "--case", "test/harness/new-pass.js"]]);
  assert.deepEqual(lines.filter(line => line.startsWith("  recorded ")), [
    `  recorded ${T262}: test/harness/fails.js fail -> pass (improved)`,
    `  recorded ${T262}: test/harness/new-fail.js fail (pending)`,
    `  recorded ${T262}: test/harness/new-pass.js pass (pending)`,
  ]);
  const after = files(root);
  for (const [path, text] of before) if (path !== T262) assert.equal(after.get(path), text, `${path} is untouched`);
  // With nothing listed, the census's writer does not run.
  const idle = recorders(root);
  assert.equal(recordPending(root, ["test262"], idle.run, () => {}), 0);
  assert.deepEqual(idle.ran, []);
});

test("a test262 row is added only for a listed case and rewritten only from fail to pass, under its own header", t => {
  const cases: [string, (text: string) => string, RegExp][] = [
    ["unlisted", text => mergeTest262Record(text, new Map([["test/harness/other.js", { outcome: "pass", detail: "" }]])), /a row was added for test\/harness\/other\.js, which was not pending/],
    ["worse", text => mergeTest262Record(text, new Map([["test/harness/passes.js", { outcome: "fail", detail: "uncaught Test262Error: #3" }]])), /the row of test\/harness\/passes\.js was rewritten, and the ratchet does not accept it/],
    ["header", text => text.replace("2 worker(s)", "8 worker(s)"), /the header changed/],
  ];
  for (const [name, change, refusal] of cases) {
    const root = test262Tree(t), was = readFileSync(join(root, T262), "utf8"), lines: string[] = [];
    const listed = acceptedIn(root, censusLog(t));
    const { run } = recorders(root, { "tooling/census/conformance262.ts": () => rewrite(root, T262, change) });
    assert.equal(recordPending(root, ["test262"], run, line => lines.push(line), listed.byKind, undefined, listed.pendingByKind), 1, `${name}: ${lines.join("\n")}`);
    assert.ok(lines.some(line => line.startsWith("  REFUSED ") && refusal.test(line)), `${name}: ${lines.join("\n")}`);
    assert.equal(readFileSync(join(root, T262), "utf8"), was, `${name}: the record is put back`);
  }
});

test("a test262 delta applies where main has no row for its case, and a case main recorded meanwhile is skipped", async t => {
  const root = test262Tree(t), main = testScratch(t, "record-pending-main"), file = join(testScratch(t, "record-pending-run"), DELTA_FILE), lines: string[] = [];
  cpSync(root, main, { recursive: true });
  const listed = acceptedIn(root, censusLog(t));
  const { run } = recorders(root, { "tooling/census/conformance262.ts": writes(root, AGREED) });
  assert.equal(recordPending(root, ["test262"], run, line => lines.push(line), listed.byKind, file, listed.pendingByKind), 0, lines.join("\n"));
  const delta = parseDelta(readFileSync(file, "utf8"));
  assert.deepEqual(delta.rows.map(row => [row.case, row.before === null]), [["test/harness/fails.js", false], ["test/harness/new-fail.js", true], ["test/harness/new-pass.js", true]]);
  const clean = await applied(main, delta);
  assert.deepEqual(clean.counts, { applied: 3, already: 0, skipped: 0 }, clean.lines.join("\n"));
  assert.equal(readFileSync(join(main, T262), "utf8"), readFileSync(join(root, T262), "utf8"), "main holds what the writer wrote");
  // A main that recorded one of the cases itself keeps its row; the other two apply.
  const moved = test262Tree(t);
  rewrite(moved, T262, text => mergeTest262Record(text, new Map([["test/harness/new-fail.js", { outcome: "fail", detail: "uncaught Test262Error: another" }]])));
  const partial = await applied(moved, delta);
  assert.deepEqual(partial.counts, { applied: 2, already: 0, skipped: 1 }, partial.lines.join("\n"));
  assert.ok(partial.lines.includes(`  skipped ${T262}: test/harness/new-fail.js: a row of another measurement was recorded for it; the next records run takes it up`), partial.lines.join("\n"));
  // A case whose file a later test262 pin changed is another case: skipped.
  const repinned = test262Tree(t);
  write(repinned, "third_party/test262/test/harness/new-pass.js", "// new-pass, as a later test262 pin wrote it\n");
  const later = await applied(repinned, delta);
  assert.ok(later.lines.includes(`  skipped ${T262}: test/harness/new-pass.js: its sources changed; the next records run takes it up`), later.lines.join("\n"));
});
