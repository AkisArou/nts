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

/**
 * Every refusal in one module, keyed by the name a later pass asks with.
 *
 * `nts refusals` prints `Program::uncompiled`, which is the only place a
 * refusal is keyed by a name rather than a span. Without it this instrument
 * could name a root and not say why *it* was refused, and establishing that
 * `asRequest` is refused for one particular reason meant grepping a module's
 * whole diagnostic stream by hand and matching on a line number.
 */
function refusals(module) {
  const run = spawnSync(
    NTS,
    ["refusals", join(ROOT, "runtime/node", module, "tsconfig.json")],
    { encoding: "utf8", maxBuffer: 1 << 30 },
  );
  const reasons = new Map();
  for (const line of (run.stdout ?? "").split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const name = line.slice(0, tab);
    if (!reasons.has(name)) reasons.set(name, line.slice(tab + 1));
  }
  return reasons;
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

/**
 * The declaration a name belongs to, with the instance stripped.
 *
 * Monomorphisation and closure capture spell one source function several ways:
 * `getHighWaterMark@0obj8148_1obj7883` and `getHighWaterMark@0obj8252_1obj7880`
 * are two copies of one declaration, `nextTick<obj1361x0>` is one instantiation
 * of one function, and `asBytes@zlib_src_main` carries the module it came from.
 *
 * **Merging them is the point, not a convenience.** This instrument answers
 * "what would fixing this publish", and the unit of a fix is the *declaration*
 * — fixing `getHighWaterMark` fixes every copy of it at once. Ranking the
 * copies separately splits one root's exports across several rows and buries
 * it, which is the failure the node lane hit from the other side the same day:
 * a set difference over text reported `addListener<obj6704>` becoming
 * `<obj6705>` as a new line, when nothing had changed but a counter.
 *
 * **Strip the whole marker, not the spellings you have seen.** The first
 * version matched `<obj[0-9]+>` and `<[0-9]+>`, which are the two forms that
 * appeared in the rows it printed -- and left `asRequest<[erased]x2>` ranked
 * separately from `asRequest`, five exports away from the row it belongs to,
 * because that spelling was in the 33 roots the table does not show. An
 * enumeration taken from the visible rows is an enumeration of the visible
 * rows.
 */
function declarationOf(name) {
  return name
    .replace(/@[0-9]*obj[0-9]+(?:_[0-9]*obj[0-9]+)*/g, "")
    .replace(/<[^<>]*>/g, "")
    .replace(/@[A-Za-z0-9_]+_src_[A-Za-z0-9_]+/g, "");
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
  const reasons = refusals(module);
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
    const declaration = declarationOf(root);
    const entry = gated.get(declaration) ?? {
      exports: new Set(),
      modules: new Set(),
      cyclic: false,
      why: null,
    };
    entry.why ??= reasons.get(root) ?? reasons.get(declaration) ?? null;
    entry.exports.add(`${module}:${name}`);
    entry.modules.add(module);
    entry.cyclic ||= cyclic;
    gated.set(declaration, entry);
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
  // The root's *own* refusal, which is the thing a reader has to know before
  // deciding anything. A root with none is one the cascade names and the
  // lowering never filed -- worth seeing rather than silently blank.
  console.log(
    `  ${" ".repeat(18)}${entry.why ?? "(no recorded reason -- named by a cascade, filed by nothing)"}`,
  );
}
if (ranked.length > 25) {
  console.log(`  ... and ${ranked.length - 25} more root(s) not shown.`);
}
