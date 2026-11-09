// record-pending.ts on a small tree of its own: which cases it finds pending,
// which recorders it runs, and what it lets them write. The recorders here are
// stand-ins that write rows through the same merge helpers the real ones use.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { mergeBenchmarkRecord, serializeBenchmarkRecord, type BenchmarkOutcome } from "../bench/outcomes.ts";
import { mergeTypeScriptRecord, serializeTypeScriptRecord, type TypeScriptObservation } from "../census/typescript-record.ts";
import { auditRecord, findPending, oracleRefreshes, recordPending, type Runner } from "./record-pending.ts";
import { written as dexRecord, type DexOutcome } from "../android/dex-record.ts";
import {oracleBudgetRevision} from "../differential/record-oracles.ts";
import {requestOracleImprovement,recordPath,oracleImprovementPath} from "../differential/oracle-records.ts";
import { testScratch } from "../gate/test-scratch.ts";

const BACKENDS = ["c", "llvm", "jvm"] as const;
const refused: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "NTS1001", where: "body" }] };
const compileRefused: BenchmarkOutcome = { kind: "refused", diagnostic: "NTS1001 unsupported shape" };
const node = "exit 0; Observed: x=1;";

function tree(t: { after(fn: () => void): void }): string {
  const root = testScratch(t, "record-pending-tree");
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
  return root;
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
  assert.equal(idle.ran.some(args => args[0] === "tooling/differential/record-oracles.ts"), false, "no oracle fixture to record, so no recorder");
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
  const saved=process.env.HOME;process.env.HOME=join(root,'home');t.after(()=>{if(saved===undefined)delete process.env.HOME;else process.env.HOME=saved;});
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
