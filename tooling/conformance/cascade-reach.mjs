// Which single refusal, if fixed, unblocks the most functions.
//
//   node tooling/conformance/cascade-reach.mjs <module>
//   NTS_COMPILER=<a pinned copy> node tooling/conformance/cascade-reach.mjs os
//
// `blocker-reach.mjs` counts refusal *shapes* by how many modules they stop.
// This answers a different question inside one module: a refused function
// refuses everything that calls it, so the cost of one primary refusal is the
// size of its transitive cone, not one line of output.
//
// The distinction is not academic. In the `os` program on 2026-09-08 there were
// 87 primary refusals and 140 further functions stopped by cascade, and reading
// the raw counts suggested the worst offenders were `checkedOffset` (28) and
// `checkedIntegerWrite` (21). Both are themselves cascaded. The actual root was
// `ERR_OUT_OF_RANGE#constructor`, which stops **74** functions transitively and
// appears in the flat count only nine times -- so the ranking everyone would
// naturally read was not merely imprecise, it named the wrong function.
//
// Attribution of a root to a *shape* is done by line range and is reported as a
// guess, because the diagnostics say which function calls a refused one but not
// which function contains a given NTS1001. Where the range is ambiguous this
// prints the candidates rather than picking one.

import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

/* Emitted trees under one root, removed when the run ends.
 *
 * Temp directories created per case and never removed filled a 16G `/tmp`
 * across a day of runs. The failure does not look like a disk error: `emit-c`
 * has nowhere to write, every case reports a refusal it did not have, and a
 * failed emit reads exactly like a real regression. `NTS_KEEP_TEMP=1` keeps the
 * tree for anyone reducing a case by hand. */
const RUN_ROOT = mkdtempSync(join(tmpdir(), "nts-cascadereach-"));
const workspace = (prefix) => mkdtempSync(join(RUN_ROOT, prefix));
process.on("exit", () => {
  if (process.env.NTS_KEEP_TEMP === undefined) {
    try { rmSync(RUN_ROOT, { recursive: true, force: true }); } catch { /* going away anyway */ }
  } else {
    console.log(`  kept ${RUN_ROOT}`);
  }
});


const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

const module_ = process.argv[2] ?? "os";
const compiler = process.env.NTS_COMPILER ?? process.env.NTS_BIN ??
  join(ROOT, "target/release/nts");
if (!existsSync(compiler)) {
  console.error(`no compiler at ${compiler}; the compiler session builds it`);
  process.exit(2);
}

const tsconfig = join(ROOT, "runtime/node", module_, "tsconfig.json");
if (!existsSync(tsconfig)) {
  console.error(`no such module: ${module_}`);
  process.exit(2);
}

const run = spawnSync(compiler, [
  "emit-c",
  tsconfig,
  "--out",
  workspace("nts-cascade-"),
  "--napi",
], {
  encoding: "utf8",
  maxBuffer: 128 * 1024 * 1024,
  timeout: 3_600_000,
  env: { NTS_TSGO: join(ROOT, "target/tsgo"), ...process.env },
});
const text = `${run.stdout ?? ""}${run.stderr ?? ""}`;

const lines = text.split("\n");
const primary = lines.filter((l) => l.includes("NTS1001"));
const cascadeLines = lines.filter((l) => l.includes("NTS1003"));

// A sweep that found nothing must not read as a clean sweep. An unset or wrong
// `NTS_TSGO` fails the frontend before any lowering happens, and every count
// below is then zero for a reason that has nothing to do with the compiler.
// Three ways to end up with no diagnostics, and they are not the same finding.
// The first version of this printed "produced no diagnostics at all" for a run
// that had been *killed by a timeout* -- `fs` emits 574KB of them and needs
// longer than the caller allowed. Reporting a killed process as a silent one
// sent me looking at `NTS_TSGO`, which was fine. Ask the process what happened
// before drawing any conclusion from its output.
if (run.error !== undefined || run.signal !== null) {
  console.log(`INSTRUMENT FAILURE: the compiler did not finish for ${module_}.`);
  if (run.signal !== null) {
    console.log(`  Killed by ${run.signal} -- most likely the caller's timeout.`);
    console.log("  This says nothing about the module. Allow more time and rerun.");
  } else {
    console.log(`  ${run.error.message}`);
  }
  process.exit(2);
}
if (primary.length === 0 && cascadeLines.length === 0) {
  // "Either it compiles cleanly -- which would be news -- or the frontend never
  // ran" was the whole of this check, and it could not tell those apart. It then
  // reported `punycode` as an instrument failure: the one module that lowers
  // completely, compiles, and passes 3 of 3. A guard that calls the success case
  // a failure trains its reader to ignore it.
  //
  // The two are distinguishable by whether anything was emitted. A frontend that
  // never started writes no `program.c`; a module with nothing to refuse writes
  // a real one.
  if (/wrote .* to \S+/.test(text)) {
    console.log(`  ${module_}: no refusals at all -- it lowers completely.`);
    console.log("  Nothing to rank. This is the answer, not a failed measurement.");
    process.exit(0);
  }
  console.log(`INSTRUMENT FAILURE: ${module_} produced no diagnostics and no`);
  console.log(`  output, and the compiler exited ${run.status} rather than being`);
  console.log("  killed. The frontend never ran -- check NTS_TSGO before");
  console.log("  believing a zero.");
  process.exit(2);
}

const edge = /`([^`]+)` cannot be compiled because it calls `([^`]+)`/;
const initEdge = /the initializer of `([^`]+)` was not compiled because it calls `([^`]+)`/;

const stops = new Map(); // cause -> Set of functions it directly stopped
const cascaded = new Set();
for (const line of cascadeLines) {
  const m = edge.exec(line) ?? initEdge.exec(line);
  if (m === null) continue;
  const [, who, cause] = m;
  if (!stops.has(cause)) stops.set(cause, new Set());
  stops.get(cause).add(who);
  cascaded.add(who);
}

function cone(root) {
  const seen = new Set();
  const stack = [root];
  while (stack.length > 0) {
    for (const next of stops.get(stack.pop()) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

// A root is a cause nothing else stopped: it was refused on its own merits.
const roots = [...stops.keys()].filter((c) => !cascaded.has(c));

// Where each primary refusal sits, so a root can be matched to a shape.
const byFile = new Map();
for (const line of primary) {
  const m = /^(\S+?):(\d+):\d+: NTS1001 (.*)$/.exec(line.trim());
  if (m === null) continue;
  const [, file, at, shape] = m;
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push({ at: Number(at), shape });
}

/** The NTS1001 shapes inside the declaration named `name`, if it can be found. */
function shapesIn(name) {
  const bare = name.replace(/#.*$/, "");
  const found = [];
  for (const [file, entries] of byFile) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8").split("\n");
    // The declaration, and the next one at the same indentation, bound it.
    let start = -1;
    for (let i = 0; i < source.length; i++) {
      const declares = new RegExp(
        `^(export )?(default )?(async )?(function|class|const|let) ${bare}\\b`,
      );
      if (declares.test(source[i])) { start = i + 1; break; }
    }
    if (start < 0) continue;
    let end = source.length;
    for (let i = start; i < source.length; i++) {
      if (/^(export |)(function|class|const|let) /.test(source[i])) { end = i; break; }
    }
    for (const e of entries) {
      if (e.at >= start && e.at <= end) found.push(`${file.split("/").pop()}:${e.at} ${e.shape}`);
    }
  }
  return found;
}

// The exports the module wanted and did not get, so a cone can be reported in
// the units anybody actually cares about.
//
// Matched on the name *before* any `@scope` suffix, which is the trap this
// exists to close. The compiler names a function `join@posix`; the export table
// wants `join`. Checking membership with the plain name finds nothing and reads
// as "none of the missing exports are in this cone" -- which is what I concluded
// about `path` for several minutes, on a cone that in fact contains all
// twenty-three of them. A silent zero from a name mismatch looks exactly like a
// real negative result.
const wanted = new Set(
  lines
    .map((l) => /^no wrapper for (\S+?): is exported and no function of that name/.exec(l.trim()))
    .filter((m) => m !== null)
    .map((m) => m[1]),
);
const base = (name) => name.split("@")[0].replace(/#.*$/, "");

const scored = roots
  .map((r) => {
    const c = cone(r);
    return {
      root: r,
      size: c.size,
      exports: [...new Set([...c].map(base))].filter((n) => wanted.has(n)).sort(),
    };
  })
  .sort((a, b) => b.size - a.size);

console.log(`  ${module_}: ${primary.length} primary refusal(s), ` +
  `${cascaded.size} function(s) stopped by cascade\n`);
console.log("  A cone counts what a refusal stopped *through other functions*.");
console.log("  A function refused on its own account is in none of them, so the");
console.log("  export counts below are floors and not totals. And clearing the");
console.log("  head of a cone can reveal the next refusal in the same function,");
console.log("  so a cone sizes a queue rather than a step.\n");
console.log("  Primary refusals ranked by the size of their cone:\n");
for (const { root, size, exports } of scored.slice(0, 10)) {
  console.log(`  ${String(size).padStart(4)}  ${root}`);
  if (exports.length > 0) {
    console.log(`        unblocks ${exports.length} missing export(s): ${exports.join(" ")}`);
  }
  // Two ways this number is a *floor* rather than an answer, both of which
  // matter to anyone deciding what to fix:
  //
  // 1. A function refused *directly* -- one whose own body holds an NTS1001 --
  //    is in no cone at all, so fixing the shape it holds unblocks it without
  //    that ever appearing here. `querystring` reports zero unblocked exports
  //    while every one of its eight is refused, two of them by the very shape
  //    that tops this list, because those refusals are primary rather than
  //    inherited.
  // 2. An export in more than one cone needs all of them fixed, so the counts
  //    across roots do not add up and the largest is not a promise on its own.
  // 3. **Clearing the head of a cone can reveal the next refusal in the same
  //    function.** `determineSpecificType` is a `switch (typeof value)` and
  //    every arm is its own narrowing: clearing the bigint arm let the lowering
  //    reach the symbol arm, which was refused for a different reason, and
  //    behind that a string conversion, and behind that a radix. The cone was
  //    measured correctly and is real; what it cannot see is what it is
  //    standing in front of. So a cone is an upper bound on what one fix
  //    unblocks only when the refusal at its head is the *only* one in that
  //    function -- otherwise it is the size of a queue, not of a step.
  const shapes = shapesIn(root);
  if (shapes.length === 0) {
    console.log("        (could not attribute a shape to this one by line range)");
  }
  for (const s of new Set(shapes)) console.log(`        ${s}`);
}

const total = scored.reduce((n, s) => n + s.size, 0);
if (scored.length > 0) {
  const top = scored[0];
  console.log(`\n  The largest single cone is ${top.size} of ${cascaded.size} ` +
    `cascaded function(s).`);
  console.log("  Cones overlap, so these do not sum to the cascade total " +
    `(${total} against ${cascaded.size}).`);
}
