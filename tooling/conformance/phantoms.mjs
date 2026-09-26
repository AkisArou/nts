// Refusals that are not: a name `nts refusals` says was refused, which the
// prepared program nevertheless contains. A phantom.
//
//   node tooling/conformance/phantoms.mjs [project-dir ...]   (default: examples/*)
//   NTS_BIN=<a pinned copy> node tooling/conformance/phantoms.mjs
//
// # Why
//
// `Program::uncompiled` is what a reader asking "why is this export missing?"
// is answered from, and `nts refusals` prints it. An entry naming a function
// the backend *does* receive is a lie in the one place people look for the
// truth: the compiler lane found `tag` in `program.c` on 2026-09-26 while
// `uncompiled` claimed it refused, and fixed three member kinds (7ac18e8a5).
// It left a fourth deliberately unfixed for want of a witness: a refused
// *raising copy* records `emit@raises` and also the original's bare `emit`, so
// if the plain body compiled, the bare entry is a phantom. This check firing on
// one is that witness.
//
// # What is compared
//
// The first column of `nts refusals <project>` (`name<TAB>reason`) against the
// `func NAME(` / `export func NAME(` lines of `nts hir --prepared <project>` --
// what a backend receives. Not `program.c`: a C definition starts with its
// return type, and an ad-hoc grep of it reported "0 gone, 0 new" for a file
// that had lost 41 functions.
//
// # Why it cannot pass by parsing nothing
//
// A detector that parses no functions finds no phantoms, and that reads as a
// clean corpus. So every project's parsed `func` count must equal the
// `N function(s)` its own summary line states; a project where they differ, or
// where either command fails, is NOT MEASURED and fails the run. And the run
// fails if it measured no project at all.
//
// Exit 0: every project measured, no phantom. Exit 1: a phantom, or a project
// not measured. The report names each.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const env = { ...process.env, NTS_TSGO: process.env.NTS_TSGO ?? join(ROOT, "target/tsgo") };

if (!existsSync(NTS)) {
  console.log(`  NOT MEASURED: no compiler at ${NTS}; set NTS_BIN`);
  process.exit(2);
}

const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const projects = named.length > 0
  ? named
  : readdirSync(join(ROOT, "examples"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, "examples", e.name, "tsconfig.json")))
    .map((e) => join("examples", e.name))
    .sort();

const run = (args) => spawnSync(NTS, args, { cwd: ROOT, env, encoding: "utf8", timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });

/** The names a prepared program contains, and whether the count reconciles. */
export function compiledNames(text) {
  const names = new Set();
  let lines = 0;
  for (const line of text.split("\n")) {
    // The name is everything before the parameter list: an accessor prints as
    // `func Counter.get value(`, with a space, and a first version stopping at
    // whitespace left 21 projects' counts short of their summaries -- which the
    // reconciliation below reported as NOT MEASURED rather than as clean.
    const m = /^(?:export )?func (.+?)\(/.exec(line);
    if (m) {
      names.add(m[1]);
      lines += 1;
      continue;
    }
    // A declaration shell -- an interface member with no body anywhere, which
    // `declare_interface_methods` emits with a single `unreachable` block so
    // dispatch has something to name. The summary counts it, so it counts
    // toward reconciling; it is not compiled, so it is never a phantom. Its
    // refusal ("a method without a body") is honest. Printed as `declare func`
    // by the compiler lane's change; before that it read as a function, and
    // the first scan reported two of them as phantoms.
    // `export declare func` for an exported one: `declare` sits after `export`.
    if (/^(?:export )?declare func .+?\(/.test(line)) lines += 1;
  }
  const stated = /^(\d+) function\(s\)/m.exec(text);
  return { names, lines, stated: stated ? Number(stated[1]) : null };
}

/** The names `nts refusals` lists, first column. */
export function refusedNames(text) {
  return text
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 2 && cols[0] !== "")
    .map(([name, reason]) => ({ name, reason }));
}

/**
 * One project's verdict from the two outputs: `{ phantoms, unmeasured, stated, entries }`.
 * The scan and the self-test both go through this, so the self-test proves the
 * path the scan takes rather than a copy of it.
 */
export function judge(project, hirText, refusalsText) {
  const { names, lines, stated } = compiledNames(hirText);
  if (stated === null) return { unmeasured: `${project}: nts hir printed no "N function(s)" line` };
  if (lines !== stated) return { unmeasured: `${project}: parsed ${lines} func line(s) where the summary states ${stated}` };
  const entries = refusedNames(refusalsText);
  const found = entries.filter(({ name }) => names.has(name)).map(({ name, reason }) => ({ project, name, reason }));
  return { phantoms: found, stated, entries: entries.length };
}

// **Seen to fire before it is trusted.** The compiler cannot be made to
// produce a phantom on demand, so the comparison is driven with synthetic
// outputs in the shapes the two commands print: a refusal naming a compiled
// function must be caught, a genuine one must not, and a listing that lost a
// function must be NOT MEASURED rather than clean.
function selfTest() {
  const hir = "func a(x: f64) -> f64 {\n}\nexport func b#m(this: managed<obj#1>) -> void {\n}\nfunc C.get v() -> f64 {\n}\ndeclare func I#shell(this: managed<obj#2>) -> void {\n}\nexport declare func J#shell(this: managed<obj#3>) -> f64 {\n}\n\n5 function(s), nothing refused\n";
  const caught = judge("self", hir, "b#m\ta refusal that is a lie\nC.get v\tan accessor's\nc\ta genuine refusal\n");
  if (caught.phantoms?.length !== 2 || caught.phantoms[0].name !== "b#m" || caught.phantoms[1].name !== "C.get v") return `a planted phantom was not caught: ${JSON.stringify(caught)}`;
  const clean = judge("self", hir, "c\ta genuine refusal\nI#shell\ta method without a body\n");
  if (clean.phantoms?.length !== 0) return `a genuine refusal was called a phantom: ${JSON.stringify(clean)}`;
  const lost = judge("self", "func a(x: f64) -> f64 {\n}\n\n2 function(s), nothing refused\n", "");
  if (!lost.unmeasured) return `a listing missing a function was measured: ${JSON.stringify(lost)}`;
  return null;
}
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (process.argv.includes("--self-test")) {
  console.log("  self-test: planted phantoms caught (an accessor's included), a declaration shell not one, a genuine refusal passed, a truncated listing not measured");
  process.exit(0);
}

/**
 * Projects that have no prepared program by design, each with its reason. A
 * named skip, never a silent one: if such a project ever typechecks, that is
 * reported, because the reason has expired.
 */
const DOES_NOT_TYPECHECK = new Map([
  ["examples/invalid", "does not typecheck on purpose: the fixture that the frontend refuses a program with type errors"],
]);
const skipped = [];

const phantoms = [];
const unmeasured = [];
let measured = 0;
let withRefusals = 0;
let refusalEntries = 0;
let functions = 0;

for (const project of projects) {
  const hir = run(["hir", "--prepared", project]);
  const said = `${hir.stdout ?? ""}${hir.stderr ?? ""}`;
  if (hir.error || hir.signal) {
    unmeasured.push(`${project}: nts hir ${hir.signal ?? hir.error?.message}`);
    continue;
  }
  const refusals = run(["refusals", project]);
  if (refusals.error || refusals.signal) {
    unmeasured.push(`${project}: nts refusals ${refusals.signal ?? refusals.error?.message}`);
    continue;
  }
  if (DOES_NOT_TYPECHECK.has(project)) {
    if (/does not typecheck/.test(said)) {
      skipped.push(`${project}: ${DOES_NOT_TYPECHECK.get(project)}`);
    } else {
      unmeasured.push(`${project}: listed as not typechecking, and now it does -- the reason has expired`);
    }
    continue;
  }
  const verdict = judge(project, said, refusals.stdout ?? "");
  if (verdict.unmeasured) {
    unmeasured.push(verdict.unmeasured);
    continue;
  }
  measured += 1;
  functions += verdict.stated;
  refusalEntries += verdict.entries;
  if (verdict.entries > 0) withRefusals += 1;
  phantoms.push(...verdict.phantoms);
}

console.log(`  compiler ${NTS}`);
console.log(
  `  ${measured} of ${projects.length} project(s) measured: ${functions} compiled function(s), ` +
    `${refusalEntries} refusal entr(ies) in ${withRefusals} project(s)`,
);
for (const p of phantoms) console.log(`  PHANTOM       ${p.project}: \`${p.name}\` is refused -- "${p.reason}" -- and compiled`);
for (const u of unmeasured) console.log(`  NOT MEASURED  ${u}`);
for (const k of skipped) console.log(`  skipped       ${k}`);
if (measured === 0) console.log("  NOT MEASURED: no project was measured, which is not a clean corpus");
console.log(
  phantoms.length === 0 && unmeasured.length === 0 && measured > 0
    ? "  no phantom refusals"
    : `  ${phantoms.length} phantom(s), ${unmeasured.length} project(s) not measured`,
);
process.exit(phantoms.length === 0 && unmeasured.length === 0 && measured > 0 ? 0 : 1);
