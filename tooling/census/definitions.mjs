// How many functions the compiler emits, per corpus module, held to a table.
//
//   node tooling/census/definitions.mjs            check against tooling/gate/definitions
//   node tooling/census/definitions.mjs --record   write the table from this binary
//   NTS_BIN=<a pinned copy> node tooling/census/definitions.mjs
//
// # Why
//
// The gate watches refusals -- `profile` counts NTS1001 roots against a
// ceiling -- and nothing watched how many functions come out. So a change can
// take refusals *and* definitions down together, which is reach going
// backwards, and read as a clear win: the compiler lane's raising change was
// -434 refusals and -369 definitions on 2026-09-26, found only because someone
// counted by hand (it was a pre-existing refusal, `fatalError`, published by a
// `catch` body that finally got lowered). A week earlier a commit moved 0
// refusals and +24 definitions, invisible to the same ceiling from the other
// side. This is the number the ceiling cannot see.
//
// # The rule, the same one `example-refusals` keeps
//
// A count that went **up** is somebody's progress: a note, and a pass -- edit
// the table. A count that went **down** fails, naming the module and the
// delta. A gate that goes red when you fix something teaches people to stop;
// one that stays green when code stops being emitted teaches nothing.
//
// # Counted from `hir --prepared`, never from `program.c`
//
// What a backend receives: `func NAME(`, `export func NAME(`, and the
// declaration shells `declare func` / `export declare func`, reconciled
// against the module's own "N function(s)" summary. An ad-hoc grep of the C
// (`^[A-Za-z_]*\(`) once reported "0 gone, 0 new" for a file that had lost 41
// functions: a C definition starts with its return type.
//
// # Not measured is a failure
//
// A module whose parsed count disagrees with its summary, whose command
// fails, or which emits **nothing**, fails -- a binary that cannot start tsgo
// produces exactly zero, and zero must never read as a module that shrank to
// nothing cleanly. So does a table row naming a module the tree no longer has,
// and a module the table has no row for.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const TABLE = join(ROOT, "tooling/gate/definitions");
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const env = { ...process.env, NTS_TSGO: process.env.NTS_TSGO ?? join(ROOT, "target/tsgo") };
// Each module is a full lowering -- `http` alone is about 95 s -- and memory,
// not cores, is what this box runs out of. Four at a time.
const WORKERS = Number(process.env.NTS_DEFINITIONS_JOBS ?? 4);
const recording = process.argv.includes("--record");

if (!existsSync(NTS)) {
  console.log(`  NOT MEASURED: no compiler at ${NTS}; set NTS_BIN`);
  process.exit(2);
}

const modules = [
  ...readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, "runtime/node", e.name, "tsconfig.json")))
    .map((e) => `runtime/node/${e.name}`),
  ...(existsSync(join(ROOT, "runtime/web-platform/tsconfig.json")) ? ["runtime/web-platform"] : []),
].sort();

/** The functions `hir --prepared` printed, and whether they reconcile. */
export function countDefinitions(text) {
  const lines = text.split("\n").filter((line) => /^(?:export )?(?:declare )?func .+?\(/.test(line)).length;
  const stated = /^(\d+) function\(s\)/m.exec(text);
  return { lines, stated: stated ? Number(stated[1]) : null };
}

const run = (args) =>
  new Promise((resolve) => {
    const child = spawn(NTS, args, { cwd: ROOT, env });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), 900_000);
    child.on("error", (error) => { clearTimeout(timer); resolve({ error, out }); });
    child.on("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal, out }); });
  });

const measured = new Map();
const unmeasured = [];
let next = 0;
const started = Date.now();
await Promise.all(
  Array.from({ length: Math.min(WORKERS, modules.length) }, async () => {
    while (next < modules.length) {
      const module = modules[next++];
      const done = await run(["hir", "--prepared", module]);
      if (done.error || done.signal) {
        unmeasured.push(`${module}: nts hir ${done.signal ?? done.error?.message}`);
        continue;
      }
      const { lines, stated } = countDefinitions(done.out);
      if (stated === null) unmeasured.push(`${module}: no "N function(s)" line (exit ${done.status}): ${done.out.trim().split("\n").pop()}`);
      else if (lines !== stated) unmeasured.push(`${module}: parsed ${lines} func line(s) where the summary states ${stated}`);
      else if (stated === 0) unmeasured.push(`${module}: emitted nothing -- a frontend that did not start looks exactly like this`);
      else measured.set(module, stated);
    }
  }),
);
const seconds = Math.round((Date.now() - started) / 1000);

console.log(`  compiler ${NTS}`);
console.log(`  ${measured.size} of ${modules.length} module(s) measured in ${seconds} s, ` +
  `${[...measured.values()].reduce((a, b) => a + b, 0)} definition(s)`);
for (const u of unmeasured.sort()) console.log(`  NOT MEASURED  ${u}`);

if (recording) {
  if (unmeasured.length > 0) {
    console.log("  not recorded: every module must be measured first");
    process.exit(1);
  }
  const rows = [...measured].sort(([a], [b]) => a.localeCompare(b)).map(([m, n]) => `${m} ${n}`);
  const header = readFileSync(TABLE, "utf8").split("\n").filter((l) => l.startsWith("#"));
  writeFileSync(TABLE, `${[...header, ...rows].join("\n")}\n`);
  console.log(`  recorded ${rows.length} module(s) to tooling/gate/definitions`);
  process.exit(0);
}

const table = new Map(
  readFileSync(TABLE, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.trim().split(/\s+/))
    .map(([m, n]) => [m, Number(n)]),
);
const failures = [];
const notes = [];
for (const [module, was] of table) {
  if (!modules.includes(module)) failures.push(`${module}: in the table, not in the tree -- remove the row`);
}
for (const [module, now] of measured) {
  const was = table.get(module);
  if (was === undefined) failures.push(`${module}: ${now} definition(s), and no row in the table -- add one`);
  else if (now < was) failures.push(`${module}: ${was} -> ${now} definition(s), ${now - was} -- code stopped being emitted`);
  else if (now > was) notes.push(`${module}: ${was} -> ${now}, +${now - was} -- raise its row in tooling/gate/definitions`);
}
for (const n of notes) console.log(`  up            ${n}`);
for (const f of failures) console.log(`  DOWN          ${f}`);
const ok = failures.length === 0 && unmeasured.length === 0 && measured.size > 0;
console.log(ok ? "  no module emits fewer functions than its row" : `  ${failures.length} failure(s), ${unmeasured.length} not measured`);
process.exit(ok ? 0 : 1);
