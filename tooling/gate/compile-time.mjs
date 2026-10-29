import { FIXED_AMBIENT } from "./canonical-environment.ts";
// Did lowering a runtime module regress beyond its calibrated instruction budget?
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
// Compare launch-time user-space instructions for `nts hir --prepared` with
// compile-times.tsv. Inheritance includes every compiler thread from exec and
// any descendants; these 29 projects spawn no child processes. See cputime.mjs.
// CPU seconds come from perf's waited-command rusage and validate the count;
// missing or implausible readings fail closed, including for small modules.
// A changed counter scope requires a fresh five-repeat baseline.
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
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTER_SCOPE, counterProblem, instructionsWork, spawnCounted } from "./cputime.mjs";
import { COMPILE_ARMS, COMPILE_WORK_PROFILE, compileArm, compileCommand, readCounterTable } from "./compile-counter.ts";
import { withToken } from "./tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const ARM = compileArm(process.argv.slice(2));
const TABLE = join(HERE, COMPILE_ARMS[ARM].table);
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const JOBS = Number(process.env.NTS_GATE_JOBS ?? 4);
const RECORD = process.argv.includes("--record");
// Only NoGC has shared prepared listings. RC always measures its own pipeline.
let FROM = ARM === "nogc" ? process.env.NTS_COMPILE_TIMES_FROM : undefined;
if (RECORD) {
  await import("./compile-counter-calibrate.ts");
  process.exit(0);
}
const cache = join(homedir(), ".cache/nts-compile-counters");
mkdirSync(cache, { recursive: true });
const COUNTERS = join(process.env.NTS_GATE_RUN_DIR ?? mkdtempSync(join(cache, "run-")), "compile-time-counters", ARM);
console.log(`  preparation arm: ${ARM}; baseline ${COMPILE_ARMS[ARM].table}`);

const modules = [
  ...readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, "runtime/node", e.name, "tsconfig.json")))
    .map((e) => `runtime/node/${e.name}`),
  ...(existsSync(join(ROOT, "runtime/web-platform/tsconfig.json")) ? ["runtime/web-platform"] : []),
].sort();

// Config evaluation would add Node/JIT work to a compiler-only tripwire.
const configured = modules.filter(module => existsSync(join(ROOT, module, "nts.config.ts")));
if (configured.length) {
  console.log(`  NOT MEASURED: project config can spawn descendants: ${configured.join(", ")}; audit the counted command before recording`);
  process.exit(2);
}

if (!existsSync(NTS)) {
  console.log(`  NOT MEASURED: no compiler at ${NTS}; set NTS_BIN`);
  process.exit(2);
}
const cannot = instructionsWork();
if (cannot) {
  console.log(`  NOT MEASURED: cannot count instructions here: ${cannot}`);
  process.exit(2);
}
const mine = createHash("sha256").update(readFileSync(NTS)).digest("hex");

if (FROM && !existsSync(join(FROM, "meta.json"))) {
  console.log(`  no ${join(FROM, "meta.json")} -- integrity --runtime kept no listings, so lowering the modules here`);
  FROM = undefined;
}
if (FROM) {
  const meta = JSON.parse(readFileSync(join(FROM, "meta.json"), "utf8"));
  if (meta.counter_scope !== COUNTER_SCOPE) {
    console.log(`  NOT MEASURED: incompatible counter scope in ${FROM}; attached counts cannot be reused`);
    process.exit(2);
  }
  if (meta.work_profile !== COMPILE_WORK_PROFILE) {
    console.log(`  NOT MEASURED: incompatible compiler work profile in ${FROM}`);
    process.exit(2);
  }
  if (meta.arm !== ARM) {
    console.log(`  NOT MEASURED: incompatible preparation arm in ${FROM}; expected ${ARM}, found ${meta.arm ?? "unknown"}`);
    process.exit(2);
  }
  if (meta.sha256 !== mine) {
    console.log(`  NOT MEASURED: the times in ${FROM} were taken with ${meta.nts} (${meta.sha256?.slice(0, 12)}), not ${NTS} (${mine.slice(0, 12)})`);
    process.exit(2);
  }
  console.log(`  read from ${FROM}: the lowering integrity --runtime timed with this binary`);
}

let baseline;
try { baseline = readCounterTable(readFileSync(TABLE, "utf8"), ARM); }
catch (error) {
  console.log(`  NOT MEASURED: ${error.message}`);
  process.exit(2);
}


const { rows: base, ratio: RATIO } = baseline;

function lower(module) {
  return withToken(async () => {
    const counted = spawnCounted(NTS, compileCommand(ARM, module), { cwd: ROOT, stdio: "ignore",
      env: { ...process.env, ...FIXED_AMBIENT }, counterFile: join(COUNTERS, `${module.replaceAll("/", "_")}.perf`) });
    return counted.measurement.then(row => ({ ...row, work_profile: COMPILE_WORK_PROFILE }));
  });
}

function kept(module) {
  const path = join(FROM, `${module.replaceAll("/", "_")}.json`);
  if (!existsSync(path)) return { error: `has no listing in ${FROM}` };
  try {
    const row = JSON.parse(readFileSync(path, "utf8"));
    return row.arm === ARM ? row : { error: `incompatible preparation arm in ${path}` };
  }
  catch (error) { return { error: `cannot read kept measurement: ${error.message}` }; }
}

const times = new Map();
const unmeasured = [];
let next = 0;
await Promise.all(Array.from({ length: FROM ? 1 : Math.min(JOBS, modules.length) }, async () => {
  while (next < modules.length) {
    const module = modules[next++];
    const r = FROM ? kept(module) : await lower(module);
    const problem = counterProblem(r) ?? (r.work_profile !== COMPILE_WORK_PROFILE ? "incompatible compiler work profile" : null) ?? (r.status !== 0 ? "missing successful command status" : null);
    if (problem) {
      unmeasured.push(`${module}: ${problem}`);
      continue;
    }
    times.set(module, { g: r.instructions / 1e9, cpu: r.cpu_s });
  }
}));


let failures = 0;
let sumNow = 0, sumWas = 0;
const lines = [];
for (const module of modules) {
  const t = times.get(module);
  const was = base.get(module);
  if (t === undefined) continue;
  // A module with no row is not checked against anything: red until recorded,
  // whatever it measured.
  if (was === undefined) {
    unmeasured.push(`${module}: ${t.g.toFixed(1)} G instructions and no row in ${COMPILE_ARMS[ARM].table} -- record it with --record --arm ${ARM}`);
    continue;
  }
  sumNow += t.g;
  sumWas += was;
  const ratio = t.g / was;
  if (ratio >= RATIO) {
    failures += 1;
    lines.push(`  SLOWER        ${module}: ${was.toFixed(1)} -> ${t.g.toFixed(1)} G instructions, ${ratio.toFixed(2)}x (${t.cpu?.toFixed(1) ?? "?"} s of CPU) -- profile it before anything else`);
  }
}
for (const module of base.keys()) {
  if (!modules.includes(module)) lines.push(`  gone          ${module}: in the table, not in the tree -- remove its row`);
}
const moved = [...times].filter(([m]) => base.has(m))
  .map(([m, t]) => [m, t.g / base.get(m)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
console.log(`  compiler ${NTS} (${mine.slice(0, 12)})`);
console.log(`  ${times.size} of ${modules.length} module(s) counted; ${sumNow.toFixed(0)} G instructions against ${sumWas.toFixed(0)} recorded (${sumWas ? (sumNow / sumWas).toFixed(2) : "?"}x); fails at ${RATIO}x of the fresh median`);
if (moved.length) console.log(`  most moved: ${moved.map(([m, r]) => `${m.replace("runtime/", "")} ${r.toFixed(2)}x`).join(", ")}`);
for (const l of lines) console.log(l);
for (const u of unmeasured) console.log(`  NOT MEASURED  ${u}`);
if (failures || unmeasured.length) {
  console.log(`  ${failures} module(s) at least ${RATIO}x slower, ${unmeasured.length} not measured`);
  process.exit(1);
}
