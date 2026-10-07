// Did lowering any runtime module get twice as slow?
//
//   node tooling/gate/compile-time.mjs            check against compile-times.tsv
//   node tooling/gate/compile-time.mjs --record   rewrite compile-times.tsv
//
// # Why
//
// On 2026-10-04 `Program::cycles` went quadratic and every step that lowers
// the runtime corpus got about 7x slower. Every verdict stayed green -- slow
// code is correct code -- and nobody noticed for two days; the gate's own
// wall time grew from 45 minutes to over two hours and read as load. The step
// times in times.tsv catch a regression that size in a whole step, but a 2x
// regression in one module is a few percent of any step that lowers it.
//
// So this step compares each module's lowering (`nts hir --prepared`: the
// instructions the compiler process itself retires in user space, counted by
// `perf stat -p` -- see cputime.mjs) with tooling/gate/compile-times.tsv, and
// **fails when one takes twice its recorded count and at least ABS billion
// more**. Instructions, not seconds: wall time moves with the slots and the
// load, and CPU time with which kind of core the process landed on -- one
// module read 2.2x its recorded CPU time under a gate's load with nothing
// changed, while its instruction count repeats within half a percent. Only
// the compiler process is counted (`--no-inherit`), not the frontend (tsgo) or
// anything else it starts, and with the snapshot cache off: a miss that
// stores the snapshot took runtime/node/assert from 291 G to 524 G. The floor
// keeps the smallest modules out of it. CPU seconds are printed beside, for
// the reader.
//
// # Where the times come from
//
// integrity --runtime lowers every module first thing and, when run.mjs runs
// both steps (NTS_COMPILE_TIMES_FROM), keeps the listing with its CPU time:
// one lowering for three steps (integrity-runtime, definitions, this). The
// directory must have been written by this binary (its sha256) and hold every
// module, or this is NOT MEASURED (exit 2). Run on its own, it lowers the
// modules itself, each holding one of the gate's tokens.
//
// # When it fails
//
// A slower module after a compiler change is the finding: profile it
// (`perf record nts hir --prepared <module>/tsconfig.json`) before anything
// else. If the work is meant to be slower (a new analysis), rerun with
// --record and say why in the commit.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { followCpu, followInstructions, instructionsWork } from "./cputime.mjs";
import { withToken } from "./tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const TABLE = join(HERE, "compile-times.tsv");
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const JOBS = Number(process.env.NTS_GATE_JOBS ?? 4);
const RATIO = 2;
const ABS = Number(process.env.NTS_COMPILE_TIME_ABS_G ?? 20); // billion instructions, about 2 s
const RECORD = process.argv.includes("--record");
const QUICK_S = 1; // CPU seconds below which a process may end before perf attaches
let FROM = process.env.NTS_COMPILE_TIMES_FROM;

const modules = [
  ...readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, "runtime/node", e.name, "tsconfig.json")))
    .map((e) => `runtime/node/${e.name}`),
  ...(existsSync(join(ROOT, "runtime/web-platform/tsconfig.json")) ? ["runtime/web-platform"] : []),
].sort();

if (!existsSync(NTS)) {
  console.log(`  NOT MEASURED: no compiler at ${NTS}; set NTS_BIN`);
  process.exit(2);
}
const cannot = instructionsWork();
if (cannot) {
  console.log(`SKIP: cannot count instructions here: ${cannot}`);
  process.exit(77);
}
const mine = createHash("sha256").update(readFileSync(NTS)).digest("hex");

if (FROM && !existsSync(join(FROM, "meta.json"))) {
  console.log(`  no ${join(FROM, "meta.json")} -- integrity --runtime kept no listings, so lowering the modules here`);
  FROM = undefined;
}
if (FROM) {
  const meta = JSON.parse(readFileSync(join(FROM, "meta.json"), "utf8"));
  if (meta.sha256 !== mine) {
    console.log(`  NOT MEASURED: the times in ${FROM} were taken with ${meta.nts} (${meta.sha256?.slice(0, 12)}), not ${NTS} (${mine.slice(0, 12)})`);
    process.exit(2);
  }
  console.log(`  read from ${FROM}: the lowering integrity --runtime timed with this binary`);
}

function lower(module) {
  return withToken(() => new Promise((resolve) => {
    // Snapshot cache off, as integrity's timed listing runs (see there).
    const child = spawn(NTS, ["hir", "--prepared", module], { cwd: ROOT, stdio: "ignore", env: { ...process.env, NTS_NO_SNAPSHOT_CACHE: "1" } });
    const cpu = Promise.all([followCpu(child), followInstructions(child)]);
    const timer = setTimeout(() => child.kill("SIGTERM"), 900_000);
    child.on("error", (e) => { clearTimeout(timer); resolve({ error: e.message }); });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      cpu.then(([cpu_s, instructions]) => resolve({ status, signal, cpu_s, instructions }));
    });
  }));
}

function kept(module) {
  const path = join(FROM, `${module.replaceAll("/", "_")}.json`);
  if (!existsSync(path)) return { error: `has no listing in ${FROM}` };
  return JSON.parse(readFileSync(path, "utf8"));
}

const times = new Map();
const unmeasured = [];
let next = 0;
await Promise.all(Array.from({ length: FROM ? 1 : Math.min(JOBS, modules.length) }, async () => {
  while (next < modules.length) {
    const module = modules[next++];
    const r = FROM ? kept(module) : await lower(module);
    // Its exit status is other steps' business (a module that does not
    // typecheck exits non-zero after lowering what it can); a signal or no
    // reading is not a time.
    if (r.error || r.signal) {
      unmeasured.push(`${module}: ${r.error ?? r.signal}`);
      continue;
    }
    // null: it ended before perf attached -- well under a second of work.
    times.set(module, { g: typeof r.instructions === "number" ? r.instructions / 1e9 : null, cpu: r.cpu_s });
  }
}));

function readTable() {
  const rows = new Map();
  if (!existsSync(TABLE)) return rows;
  for (const line of readFileSync(TABLE, "utf8").split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const [module, g] = line.split("\t");
    rows.set(module, Number(g));
  }
  return rows;
}

if (RECORD) {
  // A null count is recorded as 0 only for a module too quick for perf to
  // attach to; one with more than a second of CPU was missed, not small.
  for (const [m, t] of times) if (t.g === null && (t.cpu ?? 0) > QUICK_S) unmeasured.push(`${m}: no instruction count, with ${t.cpu.toFixed(1)} s of CPU`);
  if (unmeasured.length) {
    console.log("  not recorded: a table with modules missing would stop checking them");
    for (const u of unmeasured) console.log(`    ${u}`);
    process.exit(2);
  }
  const head = readFileSync(TABLE, "utf8").split("\n").filter((l) => l.startsWith("#")).join("\n");
  writeFileSync(TABLE, `${head}\n${[...times].sort().map(([m, t]) => `${m}\t${(t.g ?? 0).toFixed(1)}\t${t.cpu?.toFixed(1) ?? ""}`).join("\n")}\n`);
  console.log(`  recorded ${times.size} module(s) with ${mine.slice(0, 12)} in ${TABLE}`);
  process.exit(0);
}

const base = readTable();
let failures = 0;
let sumNow = 0, sumWas = 0, early = 0;
const lines = [];
for (const module of modules) {
  const t = times.get(module);
  const was = base.get(module);
  if (t === undefined) continue;
  // A module with no row is not checked against anything: red until recorded,
  // whatever it measured.
  if (was === undefined) {
    unmeasured.push(`${module}: ${t.g === null ? "no instruction count" : `${t.g.toFixed(1)} G instructions`} and no row in compile-times.tsv -- record it with --record`);
    continue;
  }
  // No count: the process ended before perf attached. With at most a second
  // of CPU that is one of the smallest modules, and its row is a few G at
  // most, under the floor a regression must clear anyway; it is counted as
  // "with no count" above. Above a second, perf missed work it should have
  // counted, and a module that grew from 5 G to 30 G would pass unseen.
  if (t.g === null) {
    early += 1;
    if (was >= ABS || (t.cpu ?? 0) > QUICK_S) unmeasured.push(`${module}: no instruction count, with ${t.cpu?.toFixed(1) ?? "?"} s of CPU`);
    continue;
  }
  sumNow += t.g;
  sumWas += was;
  const ratio = t.g / Math.max(was, 0.1);
  if (ratio >= RATIO && t.g - was >= ABS) {
    failures += 1;
    lines.push(`  SLOWER        ${module}: ${was.toFixed(1)} -> ${t.g.toFixed(1)} G instructions, ${ratio.toFixed(1)}x (${t.cpu?.toFixed(1) ?? "?"} s of CPU) -- profile it before anything else`);
  }
}
for (const module of base.keys()) {
  if (!modules.includes(module)) lines.push(`  gone          ${module}: in the table, not in the tree -- remove its row`);
}
const moved = [...times].filter(([m, t]) => t.g !== null && (base.get(m) ?? 0) >= ABS)
  .map(([m, t]) => [m, t.g / base.get(m)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
console.log(`  compiler ${NTS} (${mine.slice(0, 12)})`);
console.log(`  ${times.size} of ${modules.length} module(s) counted${early ? ` (${early} with no count)` : ""}; ${sumNow.toFixed(0)} G instructions against ${sumWas.toFixed(0)} recorded (${sumWas ? (sumNow / sumWas).toFixed(2) : "?"}x); fails at ${RATIO}x and ${ABS} G more`);
if (moved.length) console.log(`  most moved: ${moved.map(([m, r]) => `${m.replace("runtime/", "")} ${r.toFixed(2)}x`).join(", ")}`);
for (const l of lines) console.log(l);
for (const u of unmeasured) console.log(`  NOT MEASURED  ${u}`);
if (failures || unmeasured.length) {
  console.log(`  ${failures} module(s) at least ${RATIO}x slower, ${unmeasured.length} not measured`);
  process.exit(1);
}
