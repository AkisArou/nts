#!/usr/bin/env node
import {exitCommand,isCommandExit,registerCommandCloser} from '../differential/command-entry/main.ts';
// `cargo test --workspace --no-fail-fast`, with the test binaries run at once.
//
//   node tooling/gate/tests.mjs          (the gate's `tests` step)
//
// cargo builds every test binary in parallel and then runs them **one after
// another**: 173 of them in 315 s, of which the nts-cli unit binary alone is
// 120 s (one test in it, `apple_surface::the_platform_packages_typecheck`, was
// 135 s by itself; it is now one test per platform). Run side by side they
// take about as long as the slowest.
//
// **How each binary is run is cargo's, not this file's.** The first pass is
// cargo itself -- the same `cargo test --workspace --no-fail-fast` -- with
// `CARGO_TARGET_<host>_RUNNER` pointing at a recorder: cargo compiles
// everything, runs the doctests in its own first-pass lifetime, and for
// every test binary calls the recorder with the exact argv, working directory
// and environment it would have run it with. The recorder writes those down
// and exits 0. The second pass replays every recording, several at once. So the
// working directory (the package root), CARGO_MANIFEST_DIR, CARGO_PKG_*, the
// library path and every other variable a test can read are cargo's own, and a
// new one cargo adds next year comes along without anyone noticing.
//
// The verdict fails closed: the first pass must exit 0 (a compile error or a
// failing doctest fails it), at least one binary must have been recorded, and
// every replayed binary must exit 0. A binary that crashes or is killed fails.
// Only then are obsolete test executables pruned. test-profile.ts owns the
// incremental nts-dev build for this route and every other test route.

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { longestFirst, recordCosts } from "./costs.mjs";
import { pruneTestArtifacts } from "./test-artifacts.ts";
import { TestScratch } from "./test-scratch.ts";
import { exitAfterOutput } from "../differential/command-entry/main.ts";
import {assertTestLayout} from './test-layout.ts';
import {inputTraceArguments} from './rust-input-trace.ts';
import {publishInputTrace,readTestArtifactTargets} from './rust-test-inputs.ts';
import {testInvocation} from './test-profile.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const traceDirectory=process.env.NTS_RUST_INPUT_TRACE;
if(traceDirectory&&!isAbsolute(traceDirectory))throw Error('Rust test inputs: trace destination must be absolute');
if(traceDirectory)mkdirSync(traceDirectory,{recursive:true});
try {
  const layout=assertTestLayout(ROOT);
  console.log(`  Rust integration layout: ${layout.harnesses.length} checked harnesses`);
} catch(error) {if(isCommandExit(error))throw error;
  console.log(`  NOT MEASURED: Rust integration layout: ${String(error)}`);
  exitCommand(2);
}
const JOBS = Math.max(1, Number(process.env.NTS_TESTS_JOBS ?? process.env.NTS_GATE_JOBS ?? Math.min(8, cpus().length)));
const TEST_OWNER = fileURLToPath(new URL("./test-profile.ts", import.meta.url));
const profileDirectory=testInvocation('workspace',[],process.env,ROOT).profileDirectory;
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "nts-tests-"));
registerCommandCloser('scratch gate/tests.mjs',{close:()=>rmSync(work,{recursive:true,force:true})});

const host = /^host: (.+)$/m.exec(spawnSync("rustc", ["-vV"], { encoding: "utf8" }).stdout ?? "")?.[1];
if (!host) {
  console.log("  NOT MEASURED: `rustc -vV` names no host triple, so no runner can be set");
  exitCommand(2);
}
const runnerVar = `CARGO_TARGET_${host.toUpperCase().replace(/[-.]/g, "_")}_RUNNER`;
if (process.env[runnerVar]) {
  console.log(`  NOT MEASURED: ${runnerVar} is already set (${process.env[runnerVar]}); this step would replace it`);
  exitCommand(2);
}

// The recorder: one JSON file per call, numbered in the order cargo made them.
const recorder = join(work, "record.sh");
const calls = join(work, "calls");
mkdirSync(calls);
const shellQuote=(/** @type {string} */ value)=>"'"+value.replaceAll("'","'\\''")+"'";
writeFileSync(recorder, `#!/bin/sh
profile=${shellQuote(profileDirectory)}
calls=${shellQuote(calls)}
# Cargo also gives rustdoc this runner. Its temporary executables disappear
# when rustdoc returns, so run those now; only profile-owned artifacts replay.
case "$1" in "$profile/"*) ;; *) exec "$@" ;; esac
n=$(mktemp "$calls/call-XXXXXXXX")
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1], JSON.stringify({at: process.hrtime.bigint().toString(), cwd: process.cwd(), argv: process.argv.slice(2), env: process.env}))' "$n" "$@"
`);
chmodSync(recorder, 0o755);

const started = Date.now();
const artifactFile=traceDirectory?join(traceDirectory,'artifacts.json'):undefined;
const ownerArgs=[...(artifactFile?['--artifacts',artifactFile]:[]),"workspace"];
const cargoTrace=traceDirectory?join(traceDirectory,'cargo.raw'):undefined;
const first = spawnSync(traceDirectory?'strace':process.execPath, cargoTrace?inputTraceArguments(cargoTrace,process.execPath,[TEST_OWNER,...ownerArgs]):[TEST_OWNER,...ownerArgs], {
  cwd: ROOT,
  env: {
    ...process.env,
    [runnerVar]: recorder,
  },
  encoding: "utf8",
  maxBuffer: 1 << 28,
});
const firstOut = `${first.stdout ?? ""}${first.stderr ?? ""}`;
if(cargoTrace){
  try{await publishInputTrace({raw:cargoTrace,output:join(dirname(cargoTrace),'cargo.json'),cwd:ROOT,root:ROOT});}
  catch(error){if(isCommandExit(error))throw error;console.error('NOT MEASURED: '+String(error));exitCommand(2);}
}
const recorded = readdirSync(calls)
  .map((f) => JSON.parse(readFileSync(join(calls, f), "utf8")))
  .sort((a, b) => (BigInt(a.at) < BigInt(b.at) ? -1 : 1));
for (const r of recorded) delete r.env[runnerVar];
const compiled = (Date.now() - started) / 1000;

if (first.status !== 0) {
  // A compile error, or a doctest that failed: cargo's own output says which.
  console.log(firstOut.split("\n").filter((l) => /^(error|warning: unused|test .* FAILED|failures:|---- )/.test(l)).slice(0, 60).join("\n"));
  console.log(`  test-profile workspace (building, doctests, recording) exited ${first.status ?? first.signal}`);
  exitCommand(1);
}
const doctests = (firstOut.match(/^\s+Doc-tests /gm) ?? []).length;
if (recorded.length === 0) {
  console.log(`  NOT MEASURED: cargo ran no test binary through ${runnerVar}, so nothing was tested`);
  exitCommand(1);
}
const artifactTargets=artifactFile?readTestArtifactTargets(artifactFile,ROOT):undefined;

// The replay.
const name = (r) => `${r.cwd.replace(`${ROOT}/`, "")} ${r.argv[0].split("/").pop()}`;
const keyed = new Map(recorded.map((r) => [name(r), r]));
const queue = longestFirst("tests", [...keyed.keys()], () => "/nonexistent");
const results = new Map();
const cost = {};
let next = 0;
let traceFailures=0;
const runOne = (key) =>
  new Promise((done) => {
    const r = keyed.get(key);
    const target=artifactTargets?.get(r.argv[0]);
    if(artifactTargets&&!target)throw Error('Rust test inputs: Cargo named no target for '+r.argv[0]);
    const began = Date.now();
    const scratch = new TestScratch(join(work, "scratch"), r.argv[0]);
    const trace=traceDirectory?join(traceDirectory,'binary-'+recorded.indexOf(r)+'.raw'):undefined;
    const child = spawn(trace?'strace':r.argv[0], trace?inputTraceArguments(trace,r.argv[0],r.argv.slice(1)):r.argv.slice(1), { cwd: r.cwd, env: scratch.environment(r.env), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("error", (e) => { out += `error: ${e.message}\n`; });
    child.on("close", async (status, signal) => {
      if(trace){
        try{await publishInputTrace({raw:trace,output:trace.replace(/\.raw$/,'.json'),cwd:r.cwd,root:ROOT,target});}
        catch(error){if(isCommandExit(error))throw error;traceFailures++;out+='NOT MEASURED: '+String(error)+'\n';status=2;}
      }
      cost[key] = (Date.now() - began) / 1000;
      const leftovers = scratch.finish();
      if (leftovers.length) out += `error: test scratch leaked by ${key} (removed):\n${leftovers.join(", ")}\n`;
      results.set(key, { status: leftovers.length ? 1 : status, signal, out, seconds: cost[key] });
      done();
    });
  });
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (next < queue.length) await runOne(queue[next++]);
}));
recordCosts("tests", cost);

let passed = 0, failed = 0, ignored = 0;
const bad = [];
for (const r of recorded) {
  const key = name(r);
  const res = results.get(key);
  for (const m of res.out.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/gm)) {
    passed += Number(m[1]); failed += Number(m[2]); ignored += Number(m[3]);
  }
  if (res.status !== 0) bad.push({ key, res });
}
for (const { key, res } of bad) {
  console.log(`  ---- ${key}: ${res.error ?? (res.signal ? `killed by ${res.signal}` : `exit ${res.status}`)}`);
  console.log(failureReport(res.out).map((l) => `    ${l}`).join("\n"));
}
/**
 * What a failed binary said about why: each failing test's whole block,
 * `---- name stdout ----` up to the next block or the summary, then any line
 * that names a failure outside one (a crash, `error:`), bounded.
 *
 * **Blocks, not a pattern for the panic line.** The filter this replaces kept
 * `thread '.*' panicked`, and Rust now prints `thread 'name' (3003478)
 * panicked at`, so the line never matched -- and the message, on the lines
 * after it, was never kept by any pattern. Every red test in the gate came
 * with its name and no reason (2026-10-21, twice in one afternoon).
 */
function failureReport(out) {
  const lines = out.split("\n");
  const kept = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^---- .* ----$/.test(line)) inBlock = true;
    else if (/^(failures:|test result:)/.test(line)) inBlock = false;
    if (inBlock || /^(test .* FAILED|error)/.test(line)) kept.push(line);
  }
  return kept.length <= 80 ? kept : [...kept.slice(0, 80), `... ${kept.length - 80} more line(s) in the step's log`];
}

const slowest = [...results].sort(([, a], [, b]) => (b.seconds ?? 0) - (a.seconds ?? 0)).slice(0, 3)
  .map(([k, v]) => `${k.split(" ").pop()} ${Math.round(v.seconds ?? 0)}s`).join(", ");
console.log(`  ${recorded.length} test binaries, ${doctests} doctest crate(s): ${passed} passed, ${failed} failed, ${ignored} ignored` +
  ` (build and doctests ${Math.round(compiled)} s, binaries ${Math.round((Date.now() - started) / 1000 - compiled)} s at ${JOBS} at once; slowest ${slowest})`);
if (bad.length === 0) {
  const pruned = pruneTestArtifacts(recorded.map((r) => r.argv[0]));
  console.log(`  test cache: removed ${pruned.binaries} obsolete executable(s), ${(pruned.bytes / 2 ** 30).toFixed(2)} GiB; current run kept`);
}
exitAfterOutput(traceFailures?2:bad.length === 0 ? 0 : 1);
