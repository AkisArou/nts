// What the compiler refuses across the runtime tree, ranked by cause.
//
//   NTS_BIN=<a pinned copy> node tooling/conformance/refusal-census.mjs
//   NTS_BIN=<a pinned copy> node tooling/conformance/refusal-census.mjs fs stream
//
// # Why not just count the diagnostics
//
// Because the count answers a question nobody asked. Three readings of the same
// data, in the order I made them, each one correcting the last:
//
//     modules blocked   every root in `internal/errors.ts` blocks 21 of 22,
//                       because every module imports it. The number does not
//                       discriminate between a defect and a defect.
//
//     sites             better, until you notice `stream/src/iter/push.ts`
//                       reports `#pendingEnd` at lines 118, 141 and 173 -- one
//                       property, three uses. In `fs`, 104 sites stand behind
//                       **4** distinct named things, and 51 behind 5.
//
//     distinct things   what this reports. A cause is worth what fixing it
//                       clears, and fixing a property clears every use of it.
//
// The middle reading is the tempting one and it is wrong by a factor of twenty
// in the worst row. A ranking by sites puts breadth-of-use where it looks like
// breadth-of-cause.
//
// # Two things the diagnostics do not tell you, both measured
//
// **The location names the enclosing declaration, not the construct.**
// `fs/src/async.ts:2719` is `start(): void {`, a method with no parameters at
// all, reported as "a rest parameter that is not an array". The rest parameter
// is on line 2720, inside a `nextTick(() => this.#walk())` call. Reading the
// reported line and reducing what you find there produces a fixture for the
// wrong construct -- which is how one afternoon went. Read the enclosing
// function, not the line.
//
// **A message is not a cause, and neither are two.** The same construct refuses
// as "a rest parameter that is not an array" in one context and "a rest
// parameter of unrepresentable type" in another; `??` on an erased value gives
// two different messages depending on whether the right operand is optional.
// Going the other way, "a property of unrepresentable type (a union of `X` |
// null)" is not about unions -- `number | null`, `string | null`,
// `Class | null` and a three-member union all compile. It is a cascade from
// whichever member has no representation, and grouping by the message hides
// that the cause is somewhere else entirely.
//
// **A single site can name several things.** `buffer/src/main.ts:575:54` is
// `end = this.length` in a default parameter, and it is reported three times --
// once each for `Dir`, `FSWatcher` and `ReadFileContext`, the classes in some
// union that do not declare `length`. So `things` is not a lower bound on
// distinct defects the way it reads. Measured across `fs`, it is still the
// smaller column in every row (the ratio runs from 26.0 down to 1.2), which is
// why the ranking uses it; the two columns are both printed so a row where they
// converge can be spotted, because that is the row where the message is
// grouping by something other than the defect.
//
// So: this ranks **texts**, grouped as carefully as text allows, and a row is a
// place to start reducing rather than a defect. Every reduction has to be
// controlled against the real site before it is filed.

import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const compiler = process.env.NTS_BIN ?? process.env.NTS_COMPILER ?? join(ROOT, "target/release/nts");

if (!existsSync(compiler)) {
  console.error(`no compiler at ${compiler}`);
  process.exit(2);
}

const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modules = argv.length > 0
  ? argv
  : readdirSync(join(ROOT, "runtime/node"))
    .filter((m) => m !== "node_modules" && existsSync(join(ROOT, "runtime/node", m, "tsconfig.json")))
    .sort();

/** `a property `#x` of type `Y`` -> `a property `X` of type `X``, so uses group. */
const shape = (message) => message.replace(/`[^`]*`/g, "`X`");

const causes = new Map();
let scanned = 0;
for (const module of modules) {
  const out = mkdtempSync(join(tmpdir(), "nts-census-"));
  const run = spawnSync(
    compiler,
    ["emit-c", join(ROOT, "runtime/node", module, "tsconfig.json"), "--out", out, "--napi"],
    { encoding: "utf8", env: { ...process.env, NTS_TSGO: join(ROOT, "target/tsgo") }, timeout: 900_000 },
  );
  rmSync(out, { recursive: true, force: true });
  const text = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  scanned++;

  const rows = text.matchAll(
    /([^\s]+\.ts):(\d+):(\d+): (NTS100[13]) (.+?) is not supported by this lowering yet|([^\s]+\.ts):(\d+):(\d+): (NTS1003) (.+)/g,
  );
  for (const row of rows) {
    const file = row[1] ?? row[6];
    const line = row[2] ?? row[7];
    const column = row[3] ?? row[8];
    const code = row[4] ?? row[9];
    const message = (row[5] ?? row[10] ?? "").trim();
    if (file === undefined || message === "") continue;
    // web-platform is not adopted, and it dominates every count: 6,695 of the
    // lines in one sweep against 1,981 sites in runtime/node. Left out rather
    // than left in and explained away.
    if (file.includes("web-platform")) continue;

    const key = `${code} ${shape(message)}`;
    if (!causes.has(key)) causes.set(key, { sites: new Set(), things: new Set(), modules: new Set() });
    const entry = causes.get(key);
    entry.sites.add(`${file}:${line}:${column}`);
    entry.modules.add(module);
    // The named thing, scoped to its file: two classes may share a member name.
    const named = /`([^`]+)`/.exec(message);
    entry.things.add(`${file}::${named === null ? `${line}:${column}` : named[1]}`);
  }
}

if (scanned === 0) {
  console.log("  INSTRUMENT FAILURE: no module was scanned.");
  process.exit(2);
}

// Roots and cascades are counted apart, and the ranking is roots only.
//
// NTS1003 is "X cannot be compiled because it calls Y, which was refused
// above" -- one message covering every cascade in the tree, and in `fs` and
// `stream` together it stands at 589 things against the largest root's 28. Left
// in the ranking it heads it by a factor of twenty and says nothing: its size
// is a measure of how much calls how much, not of anything to fix. Its total is
// worth one line, because that line is the prize for fixing the roots.
const isCascade = (key) => key.startsWith("NTS1003");
const cascades = [...causes.entries()].filter(([k]) => isCascade(k));
const roots = [...causes.entries()].filter(([k]) => !isCascade(k))
  .sort((a, b) => b[1].things.size - a[1].things.size);

const rootThings = roots.reduce((n, [, v]) => n + v.things.size, 0);
const rootSites = roots.reduce((n, [, v]) => n + v.sites.size, 0);
const cascadeThings = cascades.reduce((n, [, v]) => n + v.things.size, 0);

console.log(`  ${scanned} module(s), ${roots.length} distinct root messages, ` +
  `${rootThings} distinct named things behind ${rootSites} sites.`);
console.log(`  ${cascadeThings} further things refuse only because something they call was ` +
  `refused.\n`);
// Which roots already have a fixture, so the list reads as work rather than as
// a report. A fixture's `expect:` line is matched against the message either
// way round, because a fixture usually names a fragment of one.
//
// Crude on purpose, and one-sided: a fixture naming the same defect in
// different words reads as absent here, so `filed` is trustworthy and blank is
// not. It saves re-deriving `??` twice, which is what it was written after.
const filings = [];
const fixtures = join(ROOT, "tooling/conformance/blockers");
if (existsSync(fixtures)) {
  for (const d of readdirSync(fixtures).sort()) {
    const src = join(fixtures, d, "src", "main.ts");
    if (!existsSync(src)) continue;
    const first = readFileSync(src, "utf8").split("\n")[0].trim();
    const m = /^\/\/\s*expect:\s*(.+)$/.exec(first);
    if (m !== null) filings.push([d, shape(m[1].trim()).toLowerCase()]);
  }
}
const filedAs = (message) => {
  const text = message.replace(/^NTS1001 /, "").toLowerCase();
  const hit = filings.find(([, e]) => e.includes(text) || text.includes(e));
  return hit === undefined ? "" : hit[0];
};

console.log(`  ${"things".padStart(6)} ${"sites".padStart(6)} ${"mods".padStart(5)}  root`);
for (const [key, v] of roots.slice(0, 25)) {
  const filed = filedAs(key);
  console.log(`  ${String(v.things.size).padStart(6)} ${String(v.sites.size).padStart(6)} ` +
    `${String(v.modules.size).padStart(5)}  ${key.replace(/^NTS1001 /, "").slice(0, 62)}` +
    (filed === "" ? "" : `\n  ${" ".repeat(19)}filed as ${filed}`));
}
console.log("\n  Ranked by things, because fixing a property clears every use of it.");
console.log("  A row is a place to start reducing, not a defect: the location names the");
console.log("  enclosing declaration rather than the construct, and one message covers");
console.log("  several causes as readily as one cause wears several messages.");
