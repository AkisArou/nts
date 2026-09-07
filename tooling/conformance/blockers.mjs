// Which compiler blocker gates a module's public API, and how much it costs.
//
//   node tooling/conformance/blockers.mjs path
//   node tooling/conformance/blockers.mjs path --log <a saved emit-c log>
//
// Walking `path`'s last mile by hand took five builds and three wrong
// hypotheses -- the star re-export, the export name, the signature -- before
// the answer turned out to be that ten of its eleven public functions validate
// an argument and one does not. Every one of those hypotheses was cheap to
// state and expensive to test. This does the same walk in one command.
//
// It answers the question the ledger keeps needing: *which root refusal, if it
// were fixed, would publish the most exports*. A refusal count cannot answer
// that. 32 roots sounds like 32 pieces of work; in `path` it was one chain
// three constructs deep, and the other 29 roots were in code nothing public
// reaches.
//
// Two things it deliberately does not do. It does not rank by refusal count,
// because a count of refusals is a count of *functions* and not of work -- the
// emitter reports the first refused construct in a function and stops, so
// removing one reveals the next. And it does not guess which NTS1001 site sits
// inside which function: the diagnostic gives a location and not an enclosing
// name, so the site is reported with its file and line for a human to read
// rather than attributed by proximity, which would be a guess wearing a
// number.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

const argv = process.argv.slice(2);
const module = argv.find((a) => !a.startsWith("--"));
if (module === undefined) {
  console.error("usage: blockers.mjs <module> [--log <emit-c output>]");
  process.exit(2);
}
const logFlag = argv.indexOf("--log");
const savedLog = logFlag < 0 ? undefined : argv[logFlag + 1];

const compiler = process.env.NTS_COMPILER ?? process.env.NTS_BIN ??
  join(ROOT, "target/release/nts");
const tsconfig = join(ROOT, "runtime/node", module, "tsconfig.json");
if (!existsSync(tsconfig)) {
  console.error(`no such module: ${module}`);
  process.exit(2);
}

function nts(args) {
  const run = spawnSync(compiler, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { NTS_TSGO: join(ROOT, "target/tsgo"), ...process.env },
  });
  return `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
}

// ---------------------------------------------------------------------------
// The diagnostics.

const log = savedLog !== undefined
  ? readFileSync(savedLog, "utf8")
  : nts(["emit-c", tsconfig, "--out", mkdtempSync(join(tmpdir(), "nts-blockers-")), "--napi"]);

/** `file:line:col: NTS1001 <what>` -- a construct this lowering cannot do. */
const roots = [];
for (const m of log.matchAll(/([^\s:]+):(\d+):(\d+): NTS1001 (.+)$/gm)) {
  // Strip the shared tail unconditionally rather than in the pattern. Leaving
  // it optional there matched it on some lines and not others, which split one
  // refusal kind into two entries with two counts -- a ranking bug, in the one
  // number this tool exists to get right.
  const what = m[4].replace(/ is not supported by this lowering yet\s*$/, "").trim();
  roots.push({ file: m[1].replace(`${ROOT}/`, ""), line: Number(m[2]), what });
}

/**
 * `NTS1003 `fn` cannot be compiled because it calls `callee`` -- one edge of
 * the cascade. `reads X, whose initializer was lost` is the same edge with a
 * different verb, and is matched too.
 */
const edges = new Map();
for (const m of log.matchAll(/NTS1003 `([^`]+)` cannot be compiled because it (?:calls|reads) `([^`]+)`/g)) {
  if (!edges.has(m[1])) edges.set(m[1], new Set());
  edges.get(m[1]).add(m[2]);
}

// A function refused at its own construct is one that never appears on the
// left of an edge: something calls it and it blames nothing further. Those are
// where a fix has to land, and everything else is downstream of one.
const refusedNames = new Set(edges.keys());
const calleeNames = new Set([...edges.values()].flatMap((s) => [...s]));
const chainRoots = [...calleeNames].filter((n) => !refusedNames.has(n)).sort();

// ---------------------------------------------------------------------------
// The public API, and which chain root each entry is stuck behind.

const layouts = nts(["layouts", tsconfig]);
const api = [];
{
  const lines = layouts.split("\n");
  const start = lines.findIndex((l) => l.trim() === "public api");
  for (let i = start + 1; start >= 0 && i < lines.length; i++) {
    const m = /^\s{2}(\S+) -> (\S+)(\s+\(no function of that name\))?\s*$/.exec(lines[i]);
    if (m === null) break;
    api.push({ name: m[1], target: m[2], published: m[3] === undefined });
  }
}

/** Walk the cascade from `name` to the roots that ultimately refuse it. */
function rootsBehind(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const next = edges.get(name);
  if (next === undefined) return refusedNames.has(name) ? [] : [name];
  return [...next].flatMap((callee) => rootsBehind(callee, seen));
}

// Two different failures wear the same "not published" label, and they are
// different work. An export whose target appears in the cascade is waiting on a
// *lowering*: something it calls cannot be compiled. An export whose target
// appears nowhere in the cascade was never refused at all -- it is a value, a
// namespace or an erased type, and what it is waiting on is the *backend*
// learning to name that kind of export. Ranking them together would put
// `determineSpecificType` and a string constant in one list.
const inCascade = (name) => refusedNames.has(name) || calleeNames.has(name);

const gatedBy = new Map();
const unnameable = [];
for (const entry of api) {
  if (entry.published) continue;
  if (!inCascade(entry.target)) {
    unnameable.push(entry);
    continue;
  }
  for (const root of new Set(rootsBehind(entry.target))) {
    if (!gatedBy.has(root)) gatedBy.set(root, []);
    gatedBy.get(root).push(entry.name);
  }
}

// ---------------------------------------------------------------------------
// What the module's *shape* needs, which is not the same as what it exports.
//
// `shape.mjs` assembles node's CommonJS surface out of typed exports, so the
// two counts come apart in both directions. `async_hooks` publishes 17 of 31
// and none of it matters: the 17 are internal helpers that `net` and `http`
// import across module boundaries, while the four names node's tests use are
// all absent. A raw publish count invites exactly that mistake, so the number
// this prints first is the one that decides whether a test can run.

/** The `exports.X` names read inside `shape.mjs`'s `shape()`. */
function shapeRequires() {
  const path = join(ROOT, "runtime/node", module, "shape.mjs");
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("export function shape(");
  if (start < 0) return undefined;
  const next = text.indexOf("\nexport function ", start + 1);
  const body = text.slice(start, next < 0 ? text.length : next);
  return [...new Set([...body.matchAll(/\bexports\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))].sort();
}

const published = api.filter((e) => e.published);
const publishedNames = new Set(published.map((e) => e.name));
const required = shapeRequires();
if (required !== undefined) {
  const missing = required.filter((n) => !publishedNames.has(n));
  console.log(
    `${module}: shape needs ${required.length} name(s), ` +
      `${required.length - missing.length} published, ${missing.length} missing`,
  );
  if (missing.length > 0) console.log(`  missing: ${missing.join(", ")}`);
}

console.log(`${module}: ${published.length} of ${api.length} exports published`);
if (published.length > 0) {
  console.log(`  published: ${published.map((e) => e.name).join(", ")}`);
}

if (unnameable.length > 0) {
  console.log(
    `\n${unnameable.length} export(s) refused by nothing -- the backend cannot\n` +
      `name this kind of export. Backend work, not lowering work:`,
  );
  for (const e of unnameable) console.log(`  ${e.name} -> ${e.target}`);
}

const ranked = [...gatedBy.entries()].sort((a, b) => b[1].length - a[1].length);
if (ranked.length > 0) {
  console.log(`\nchain roots, by how many exports each one gates:`);
  for (const [root, exports] of ranked) {
    console.log(`  ${root}  --  ${exports.length} export(s)`);
    console.log(`    ${exports.join(", ")}`);
  }
}

if (roots.length > 0) {
  const byKind = new Map();
  for (const r of roots) {
    const kind = r.what.replace(/`[^`]*`/g, "X");
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(`${r.file}:${r.line}`);
  }
  console.log(`\n${roots.length} refused construct(s), by kind:`);
  for (const [kind, sites] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(sites.length).padStart(3)}  ${kind}`);
    console.log(`       ${sites.slice(0, 4).join("  ")}${sites.length > 4 ? "  ..." : ""}`);
  }
  console.log(
    `\nOne construct is reported per function, so this is a count of refused\n` +
      `functions and a lower bound on the constructs behind them.`,
  );
}
