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

import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

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
  mkdtempSync(join(tmpdir(), "nts-cascade-")),
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
  console.log(`INSTRUMENT FAILURE: ${module_} produced no diagnostics at all,`);
  console.log(`  and the compiler exited ${run.status} rather than being killed.`);
  console.log("  Either it compiles cleanly -- which would be news -- or the");
  console.log("  frontend never ran. Check NTS_TSGO before believing a zero.");
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

const scored = roots
  .map((r) => ({ root: r, size: cone(r).size }))
  .sort((a, b) => b.size - a.size);

console.log(`  ${module_}: ${primary.length} primary refusal(s), ` +
  `${cascaded.size} function(s) stopped by cascade\n`);
console.log("  Primary refusals ranked by the size of their cone:\n");
for (const { root, size } of scored.slice(0, 10)) {
  console.log(`  ${String(size).padStart(4)}  ${root}`);
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
