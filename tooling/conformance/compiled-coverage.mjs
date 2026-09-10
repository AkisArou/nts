// What the compiled differential cannot compare, and which missing export is why.
//
//   node tooling/conformance/compiled-coverage.mjs <addon-dir>
//
// # Why this is its own question
//
// `differential-addon.mjs` answers "do the two lanes agree" for one module, and
// it already refuses to print a clean row when it compared nothing. What it does
// not answer is the lane-level one: across every module, how much of the corpus
// the compiled lane can reach at all.
//
// On a 2026-09-10 pin that number is stark -- 16 of 22 modules compare **zero**
// specs, and the four that do carry the whole lane. Read one module at a time
// that is 16 separate footnotes; read together it says the compiled differential
// is mostly blank, and blank is not agreement.
//
// # Attribution is to the missing export, not to the spec
//
// A spec is skipped because some segment of the chain it reaches for is not
// published: `posix.format(...)` needs `posix` and then `format`. Counting
// skipped specs ranks *symptoms* -- 19 for `string_decoder` says only that its
// corpus is large. Counting the missing export that blocks them ranks **what
// would clear**, which is the question worth handing to whoever lowers it: one
// export can unblock nineteen specs, and nineteen exports can unblock one each.
//
// The chain is resolved segment by segment and the spec is attributed to the
// *first* segment that is missing, so a module publishing nothing attributes to
// the root rather than spreading across every leaf it never got to.
//
// # What it does not claim
//
// That a published export is a working one. This asks whether a name resolves,
// which is the precondition for comparing it -- `differential-addon.mjs` is what
// says whether the answers match, and `--sabotage` is what says that check can
// fail. A name can resolve and still be wrong.

import { createRequire } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { CORPORA } from "./differential-corpora.mjs";

const require_ = createRequire(import.meta.url);
const addonDir = process.argv[2];
if (addonDir === undefined || !existsSync(addonDir)) {
  console.error("usage: compiled-coverage.mjs <dir-of-built-addons>");
  process.exit(2);
}

/**
 * The identifier chain a spec reaches for, by the **same rule the harness uses**
 * -- `differential-addon.mjs`'s `publishes()` regex, copied deliberately so this
 * measures the harness's actual behaviour rather than a tidier version of it.
 *
 * The rule is a guess, and the guess is visible here: `\w` excludes `-`, so
 * `cpus-shape` truncates to `cpus` and resolves, while `split-every-byte`
 * truncates to `split` and does not. Neither label was ever an export name. A
 * first version of this file split on `.` instead and reported `os` at 15 of 22
 * where the harness compares 20 -- the disagreement is what exposed the rule.
 */
function chainOf(spec) {
  const label = String(spec.label ?? spec.name ?? "");
  const chain = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(label)?.[0];
  return chain === undefined ? [] : chain.split(".");
}

/** Resolve a chain against a module object, or undefined if any segment is absent. */
function resolveChain(root, chain) {
  let cursor = root;
  for (const segment of chain) {
    if (cursor === undefined || cursor === null) return undefined;
    if (typeof cursor !== "object" && typeof cursor !== "function") return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

const rows = [];
const blockers = new Map();
const labelBlocked = [];

for (const file of readdirSync(addonDir).filter((f) => f.endsWith(".node")).sort()) {
  const moduleName = basename(file, ".node");
  const corpus = CORPORA[moduleName];
  if (corpus === undefined) continue;

  let exports_;
  try {
    exports_ = require_(resolve(join(addonDir, file)));
  } catch (error) {
    rows.push({ moduleName, total: 0, reachable: 0, note: `would not load: ${error?.message ?? error}` });
    continue;
  }

  let upstream;
  try {
    upstream = require_(`node:${moduleName}`);
  } catch {
    upstream = undefined;
  }

  const calls = corpus.calls ?? [];
  let reachable = 0;
  let labelOnly = 0;
  for (const spec of calls) {
    const chain = chainOf(spec);
    if (chain.length === 0) {
      reachable++;
      continue;
    }
    const mine = resolveChain(exports_, chain);
    if (mine !== undefined && mine !== null) {
      reachable++;
      continue;
    }
    // **Node decides whether the guard asked a real question.** If the chain does
    // not resolve on node either, it was never an export name -- the spec was
    // skipped because of how its label is spelled, and the addon may well publish
    // everything that spec's body needs. Counting those as missing exports would
    // hand someone a list of things to go and implement that do not exist.
    const theirs = upstream === undefined ? undefined : resolveChain(upstream, chain);
    if (theirs === undefined || theirs === null) {
      labelOnly++;
      labelBlocked.push(`${moduleName}: ${spec.label ?? spec.name}  (guard read "${chain.join(".")}", which node has no such export)`);
      continue;
    }
    const key = `${moduleName}.${chain.join(".")}`;
    blockers.set(key, (blockers.get(key) ?? 0) + 1);
  }
  rows.push({ moduleName, total: calls.length, reachable, labelOnly });
}

const total = rows.reduce((n, r) => n + r.total, 0);
const reach = rows.reduce((n, r) => n + r.reachable, 0);
const blank = rows.filter((r) => r.reachable === 0 && r.total > 0).length;

console.log(`compiled differential coverage: ${reach} of ${total} spec(s) reachable across ${rows.length} module(s)`);
console.log(`  ${blank} module(s) reach nothing at all\n`);
console.log(`  ${"MODULE".padEnd(20)} ${"SPECS".padStart(6)} ${"REACH".padStart(6)}`);
for (const r of rows) {
  const note = r.note !== undefined ? `  ${r.note}` : r.reachable === 0 && r.total > 0 ? "  BLANK" : "";
  console.log(`  ${r.moduleName.padEnd(20)} ${String(r.total).padStart(6)} ${String(r.reachable).padStart(6)}${note}`);
}

const ranked = [...blockers.entries()].sort((a, b) => b[1] - a[1]);
const realBlocked = ranked.reduce((n, [, c]) => n + c, 0);
console.log(`\n  ${ranked.length} missing export(s) block ${realBlocked} spec(s). Ranked by what each clears:`);
for (const [name, n] of ranked) {
  console.log(`  ${String(n).padStart(4)}  ${name}`);
}

if (labelBlocked.length > 0) {
  console.log(
    `\n  ${labelBlocked.length} spec(s) are skipped by the label guard and not by an absence.\n` +
      `  The guard reads an identifier off the front of the label; these labels are\n` +
      `  descriptive, so it read a name node does not export either. Whether the addon\n` +
      `  publishes what their bodies need is unmeasured -- the guard never asked.`,
  );
  for (const l of labelBlocked) console.log(`    ${l}`);
}
