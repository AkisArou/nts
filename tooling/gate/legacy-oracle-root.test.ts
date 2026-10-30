import assert from "node:assert/strict";
import { test } from "node:test";
import {spawnTest} from "./test-wait.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { comparisonOracleRoot, legacyOraclePin } from "../differential/legacy-oracle-root.ts";
import { GENERATOR, writeRecords, type OracleTable } from "../differential/oracle-records.ts";

function fixture(t: { after(fn: () => void): void }, oldUnrecorded = false) {
  const parent = join(homedir(), ".cache/nts-oracle-bridge-tests"); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "run-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "repo"), cache = join(directory, "cache"); mkdirSync(root);
  const put = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Bridge test", "-c", "user.email=bridge@example.invalid", ...args], { cwd: root, encoding: "utf8" }).trim();
  const source = "tests/programs/example/src/main.ts";
  put(source, "export function work(n: number): number { return 1; }\n");
  put("tests/programs/example/tsconfig.json", '{"files":["src/main.ts"]}');
  put("benchmarks/cases/.keep", "");
  put("tooling/lanes/inputs.sh", "#!/bin/sh\nexit 0\n");
  put(".gitignore", "/results/oracle-counts.json\n");
  if (oldUnrecorded) {
    put("tests/programs/unrecorded/tsconfig.json", '{"files":["src/main.ts"]}');
    put("tests/programs/unrecorded/src/main.ts", "export function work(n: number): number { return n; }\n");
  }
  git("init", "--quiet"); git("add", "."); git("commit", "--quiet", "-m", "before migration");
  const table: OracleTable = { version: 1, generator_version: 1, generator_digest: "a".repeat(32), seed: null,
    rows: [{ kind: "measured", source, signature: "b".repeat(64), keys: { c: "c".repeat(32) }, cases_sha256: "d".repeat(64), driver_sha256: "e".repeat(64), complete: true, count: 1 }] };
  put("results/oracle-counts.json", JSON.stringify(table)); git("add", "-f", "results/oracle-counts.json"); git("commit", "--quiet", "-m", "recorded before population");
  const before = git("rev-parse", "HEAD");
  git("rm", "--quiet", "results/oracle-counts.json");
  if (oldUnrecorded) table.rows.push({...table.rows[0]!, source: "tests/programs/unrecorded/src/main.ts"});
  writeRecords(root, table); git("add", "."); git("commit", "--quiet", "-m", "directory authority");
  const migration = git("rev-parse", "HEAD");
  function binary(name: string, sha: string) {
    const path = join(directory, name, "nts"); mkdirSync(dirname(path));
    const text = `#!/bin/sh\n# ${name}\nexit 0\n`; writeFileSync(path, text); chmodSync(path, 0o755);
    writeFileSync(join(dirname(path), "provenance.json"), JSON.stringify({ sha, clean: true, applied: null, binary_sha256: createHash("sha256").update(text).digest("hex") }));
    return path;
  }
  return { root, cache, table, source, put, git, migration, old: binary("old", before), current: binary("current", migration) };
}

test("the pin's commit turns the legacy bridge off at the migration", t => {
  const f = fixture(t);
  assert.equal(legacyOraclePin(f.root, f.old, f.migration), true);
  assert.equal(legacyOraclePin(f.root, f.current, f.migration), false);
  const current = comparisonOracleRoot(f.root, [f.current], f.cache);
  assert.equal(current.root, f.root); assert.equal(current.legacy, false); current.dispose();
  assert.equal(existsSync(f.cache), false, "a current pin must create no compatibility view");
  writeFileSync(f.old, "changed executable");
  assert.throws(() => comparisonOracleRoot(f.root, [f.old], f.cache), /verified pin bytes/);
});

test("a private view preserves working inputs and is deleted after comparison", t => {
  const f = fixture(t);
  f.put(f.source, "export function work(n: number): number { return 2; }\n");
  f.put("tests/programs/example/src/new-input.ts", "export const current = 3;\n");
  const registry=f.git("worktree","list","--porcelain");
  const snapshot = comparisonOracleRoot(f.root, [f.old, f.current], f.cache);
  const view = join(snapshot.root, "results/oracle-counts.json");
  try {
    assert.equal(snapshot.legacy, true); assert.notEqual(snapshot.root, f.root);
    const viewCommon=execFileSync("git",["rev-parse","--path-format=absolute","--git-common-dir"],{cwd:snapshot.root,encoding:"utf8"}).trim();
    assert.notEqual(viewCommon,f.git("rev-parse","--path-format=absolute","--git-common-dir"),"the view must own Git metadata");
    assert.equal(f.git("worktree","list","--porcelain"),registry,"the source registry must stay unchanged");
    assert.deepEqual(JSON.parse(readFileSync(view, "utf8")), f.table);
    for (const path of [f.source, "tests/programs/example/src/new-input.ts"]) assert.deepEqual(readFileSync(join(snapshot.root, path)), readFileSync(join(f.root, path)));
    assert.equal(existsSync(join(f.root, "results/oracle-counts.json")), false);
  } finally { snapshot.dispose(); snapshot.dispose(); }
  assert.equal(existsSync(view), false); assert.equal(existsSync(snapshot.root), false);
  assert.equal(f.git("worktree", "list", "--porcelain").split("worktree ").length - 1, 1);
});

test("parallel comparisons never share or remove one another's derived view", t => {
  const f = fixture(t), first = comparisonOracleRoot(f.root, [f.old], f.cache);
  const second = comparisonOracleRoot(f.root, [f.old], f.cache);
  try {
    assert.notEqual(first.root, second.root); first.dispose();
    assert.equal(existsSync(join(second.root, "results/oracle-counts.json")), true);
  } finally { first.dispose(); second.dispose(); }
  assert.deepEqual(readdirSync(f.cache), []);
});

test("malformed records remove the private checkout without publishing any view", t => {
  const f = fixture(t);
  f.put(GENERATOR, "{}");
  assert.throws(() => comparisonOracleRoot(f.root, [f.old], f.cache), /generator/);
  assert.deepEqual(readdirSync(f.cache), []);
  assert.equal(f.git("worktree", "list", "--porcelain").split("worktree ").length - 1, 1);
  assert.equal(existsSync(join(f.root, "results/oracle-counts.json")), false);
});

test("a lane comparison prepares from the shared checkout's owned dependency store", t => {
  const f = fixture(t), lane = join(dirname(f.root), "lane");
  f.git("worktree", "add", "--quiet", "--detach", lane, f.migration);
  try {
    writeFileSync(join(lane, "tooling/lanes/inputs.sh"), '#!/bin/sh\nprintf "%s" "$2" > "$3/preparation-root"\n');
    const snapshot = comparisonOracleRoot(lane, [f.old], f.cache);
    try { assert.equal(readFileSync(join(snapshot.root, "preparation-root"), "utf8"), f.root); }
    finally { snapshot.dispose(); }
  } finally { f.git("worktree", "remove", "--force", lane); }
});

test("a changed existing population keeps the pin's historical key without waiving coverage", t => {
  const f = fixture(t), updated = structuredClone(f.table);
  updated.rows[0]!.keys.c = "f".repeat(32); updated.rows[0]!.count = 2;
  writeRecords(f.root, updated);
  const snapshot = comparisonOracleRoot(f.root, [f.old, f.current], f.cache);
  try {
    const view = JSON.parse(readFileSync(join(snapshot.forBinary(f.old), "results/oracle-counts.json"), "utf8"));
    assert.deepEqual(view, f.table, "historical counts and identities are never refreshed from the candidate");
    assert.throws(() => snapshot.forBinary("unregistered"), /unregistered comparison pin/);
    assert.equal(view.rows.some(row => row.keys.c === updated.rows[0]!.keys.c), false,
      "a new candidate-driven key cannot match a historical row by fixture name alone");
    assert.deepEqual(JSON.parse(readFileSync(join(snapshot.root, "results/oracle-counts/tests/programs/example.json"), "utf8")).rows, updated.rows,
      "the modern compiler still reads only the current directory authority");
  } finally { snapshot.dispose(); }
});

test("an old unrecorded fixture is never admitted as a newly measured directory", t => {
  const f = fixture(t, true), snapshot = comparisonOracleRoot(f.root, [f.old], f.cache);
  try {
    const view = JSON.parse(readFileSync(join(snapshot.root, "results/oracle-counts.json"), "utf8")) as OracleTable;
    assert.equal(view.rows.some(row => row.source.includes("unrecorded")), false,
      "an existing directory without a historical measurement must keep holding on the old compiler");
    assert.equal(f.table.rows.some(row => row.source.includes("unrecorded")), true,
      "the modern authority retains its current measurement");
  } finally { snapshot.dispose(); }
});

test("concurrent comparison clones own their metadata and never change the source registry", t => {
  const f = fixture(t), worker = join(dirname(f.root), "bridge-worker.mjs");
  const module = new URL("../differential/legacy-oracle-root.ts", import.meta.url).href;
  const registry = f.git("worktree", "list", "--porcelain"), head = f.git("rev-parse", "HEAD");
  const common = f.git("rev-parse", "--path-format=absolute", "--git-common-dir");
  writeFileSync(worker, `import {parentPort,workerData} from 'node:worker_threads';import {execFileSync} from 'node:child_process';import {comparisonOracleRoot} from ${JSON.stringify(module)};
const view=comparisonOracleRoot(workerData.root,[workerData.binary],workerData.cache);
const git=(...args)=>execFileSync('git',args,{cwd:view.root,encoding:'utf8'}).trim();
parentPort.on('message',()=>{view.dispose();parentPort.close();});
parentPort.postMessage({root:view.root,common:git('rev-parse','--path-format=absolute','--git-common-dir'),head:git('rev-parse','HEAD')});`);
  const code = `import assert from 'node:assert/strict';import {Worker} from 'node:worker_threads';import {join} from 'node:path';import {execFileSync} from 'node:child_process';import {existsSync,readFileSync} from 'node:fs';
const workers=Array.from({length:2},()=>new Worker(${JSON.stringify(worker)},{execArgv:[],workerData:${JSON.stringify({root:f.root,binary:f.old,cache:f.cache})}}));
const registry=()=>execFileSync('git',['worktree','list','--porcelain'],{cwd:${JSON.stringify(f.root)},encoding:'utf8'}).trim();
try{
 const views=await Promise.all(workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);}))); 
 assert.equal(new Set(views.map(view=>view.common)).size,2);
 assert.equal(registry(),${JSON.stringify(registry)});
 for(const view of views){assert.equal(view.common,join(view.root,'.git'));assert.notEqual(view.common,${JSON.stringify(common)});assert.equal(view.head,${JSON.stringify(head)});assert.equal(readFileSync(join(view.common,'objects/info/alternates'),'utf8').trim(),join(${JSON.stringify(common)},'objects'));}
 const exits=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('exit',status=>status===0?resolve():reject(new Error('worker exit '+status)));worker.once('error',reject);}));
 workers[0].postMessage('dispose');await exits[0];assert.equal(existsSync(views[0].root),false);assert.equal(existsSync(views[1].common),true);assert.equal(registry(),${JSON.stringify(registry)});
 workers[1].postMessage('dispose');await exits[1];assert.equal(existsSync(views[1].root),false);assert.equal(registry(),${JSON.stringify(registry)});
 console.log('independent concurrent metadata and owned cleanup');
}finally{await Promise.all(workers.map(worker=>worker.terminate()));}`;
  const result = spawnTest(process.execPath, ["--input-type=module", "-e", code], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /independent concurrent metadata and owned cleanup/);
  assert.deepEqual(readdirSync(f.cache), []);
});
