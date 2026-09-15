// Which refusal, if fixed, would publish the most exports.
//
//   NTS_BIN=<a pinned copy> node tooling/conformance/gates.mjs
//   NTS_BIN=<a pinned copy> node tooling/conformance/gates.mjs stream zlib
//
// # Why this exists rather than `refusal-census.mjs --top=`
//
// The census ranks refusal *messages* by how many things carry them. On
// 2026-09-15 that ranking was shown to mean something other than what it looks
// like. `zlib`'s fifteen declined classes all said
//
//     a property `dictionary` of unrepresentable type (a union of ...)
//
// and the node lane removed `dictionary` in a throwaway worktree: the refusal
// went from 104 lines to 0 and the declined set was **identical name for
// name**, 66 either side. The cause with the most mentions gated *nothing*.
//
// The reason is structural and applies to every count this tree takes over
// diagnostics: **the compiler reports one blocker at a time.** The message you
// see is whichever sits furthest forward in the program, so a rank by count is
// a rank by diagnostic *reach*. Reach and value are different quantities and
// nothing converts one to the other.
//
// # What this measures instead
//
// A declined export names a cause; where that cause is a cascade -- `it calls
// X, which was refused above` -- X has a cause of its own. Following those
// edges to a function with no outgoing edge gives the **root** the export
// actually stands behind. Ranking roots by how many exports reach them answers
// "what would fixing this publish", which is the question.
//
// # What it still does not answer, and cannot
//
// Reaching a root is necessary, not sufficient. Fixing it unblocks the chain
// *up to the next blocker*, which may be a refusal the compiler never printed
// because it stops at the first. So a root's export count is an **upper
// bound**, and the only way to collapse it to a real number is to fix the root
// and re-emit -- or to remove the construct in a worktree and diff the export
// set, which is cheap. Treat this as a candidate list to run that test on, in
// order, and not as a promise.
//
// Two further limits, stated because a number without them reads as coverage.
// A cycle among the edges is cut at the first repeat and the name it was cut at
// is reported as the root, which is a choice rather than a fact. And an export
// declining for its own reason, with no cascade at all, is its own root -- so
// those rank by one export each however expensive they are.

import { spawnSync } from "node:child_process";
import { readdirSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");

const CASCADE =
  /`([^`]+)` cannot be compiled because it calls `([^`]+)`, which was refused above/;
const DECLINE = /no wrapper for ([A-Za-z0-9_.#$@]+): (.+)$/;
const CALLS = /it calls `([^`]+)`, which was refused above/;

/** The modules to walk: every `runtime/node/*` holding a tsconfig. */
function modules(requested) {
  const all = readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(ROOT, "runtime/node", name, "tsconfig.json")))
    .sort();
  if (requested.length === 0) return all;
  const unknown = requested.filter((name) => !all.includes(name));
  if (unknown.length > 0) {
    console.error(`no such module(s): ${unknown.join(", ")}`);
    process.exit(2);
  }
  return requested;
}

/** Emit one module with the napi wrapper and hand back its whole log. */
function emit(module) {
  const out = mkdtempSync(join(tmpdir(), `gates-${module}-`));
  const run = spawnSync(
    NTS,
    ["emit-c", join(ROOT, "runtime/node", module, "tsconfig.json"), "--out", `${out}/`, "--napi"],
    { encoding: "utf8", maxBuffer: 1 << 30 },
  );
  // **Not the exit status.** `emit-c` exits 0 while refusing; it compiles what
  // it can and reports the rest. And a *failed* run emits nothing, which reads
  // as "declined nothing" -- so the presence of the file is the check that the
  // count below is a count of something.
  const wrote = existsSync(join(out, "program.c"));
  return { text: `${run.stdout ?? ""}${run.stderr ?? ""}`, wrote };
}

/** `Owner#member` for a class export, the bare name otherwise. */
function entryNames(name) {
  const bare = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  return [`${name}#constructor`, name, `${bare}#constructor`, bare];
}

/** Follow `it calls X` edges to a name with no outgoing edge. */
function rootOf(start, edges) {
  const seen = new Set();
  let at = start;
  for (;;) {
    if (seen.has(at)) return { root: at, cyclic: true };
    seen.add(at);
    const next = edges.get(at);
    if (next === undefined) return { root: at, cyclic: false };
    at = next;
  }
}

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const names = modules(requested);

const gated = new Map(); // root -> { exports: Set, modules: Set, cyclic: bool }
let declines = 0;
let ownRoot = 0;
let noCause = 0;
const skipped = [];

for (const module of names) {
  const { text, wrote } = emit(module);
  if (!wrote) {
    skipped.push(module);
    continue;
  }
  const edges = new Map();
  for (const line of text.split("\n")) {
    const edge = CASCADE.exec(line);
    if (edge) edges.set(edge[1], edge[2]);
  }
  for (const line of text.split("\n")) {
    const decline = DECLINE.exec(line);
    if (!decline) continue;
    declines += 1;
    const [, name, reason] = decline;
    const calls = CALLS.exec(reason);
    let start = null;
    if (calls) {
      start = calls[1];
    } else {
      // Not a cascade at the export level: the export's own entry function is
      // the place to start, and it may still cascade from there.
      start = entryNames(name).find((candidate) => edges.has(candidate)) ?? null;
      if (start === null) {
        if (/: /.test(reason)) ownRoot += 1;
        else noCause += 1;
        continue;
      }
    }
    const { root, cyclic } = rootOf(start, edges);
    const entry = gated.get(root) ?? { exports: new Set(), modules: new Set(), cyclic: false };
    entry.exports.add(`${module}:${name}`);
    entry.modules.add(module);
    entry.cyclic ||= cyclic;
    gated.set(root, entry);
  }
}

const ranked = [...gated.entries()].sort((a, b) => b[1].exports.size - a[1].exports.size);

console.log(
  `\n  ${names.length} module(s), ${declines} declined export(s). ` +
    `${[...gated.values()].reduce((sum, e) => sum + e.exports.size, 0)} reach a root through the cascade; ` +
    `${ownRoot} are their own root (a reason, no chain); ${noCause} name no cause at all.`,
);
if (skipped.length > 0) {
  console.log(`  NOT MEASURED, emitted nothing: ${skipped.join(", ")}`);
}
console.log(
  `\n  Exports standing behind one root. An UPPER BOUND -- fixing a root clears\n` +
    `  the chain only as far as the next blocker, which the compiler never printed.\n`,
);
console.log(`  ${"exports".padStart(7)}  ${"modules".padStart(7)}  root`);
for (const [root, entry] of ranked.slice(0, 25)) {
  const mark = entry.cyclic ? " (cycle cut here)" : "";
  console.log(
    `  ${String(entry.exports.size).padStart(7)}  ${String(entry.modules.size).padStart(7)}  ${root}${mark}`,
  );
}
if (ranked.length > 25) {
  console.log(`  ... and ${ranked.length - 25} more root(s) not shown.`);
}
