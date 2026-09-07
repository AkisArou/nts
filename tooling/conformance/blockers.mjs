// Which compiler blocker gates a module's public API, and how much it costs.
//
//   node tooling/conformance/blockers.mjs path
//   node tooling/conformance/blockers.mjs path --log <a saved emit-c log>
//   node tooling/conformance/blockers.mjs --all      # every module, plus a table
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

// `--all` re-runs this script once per module and prints the summary table.
// Done by re-exec rather than by looping in-process, so every module is
// measured by exactly the code path a single-module run uses -- a summary
// assembled a second way is a second thing to keep true.
if (argv.includes("--all")) {
  const { readdirSync, existsSync: exists } = await import("node:fs");
  const profile = join(ROOT, "runtime/node");
  const modules = readdirSync(profile, { withFileTypes: true })
    .filter((e) => e.isDirectory() && exists(join(profile, e.name, "tsconfig.json")))
    .map((e) => e.name)
    .sort();

  const rows = [];
  for (const name of modules) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    });
    const out = `${run.stdout ?? ""}`;
    process.stdout.write(`########## ${name}\n${out}${run.stderr ?? ""}\n`);
    const shape = /shape needs (\d+) name\(s\), (\d+) published/.exec(out);
    const root = /^chain roots[^\n]*\n  (\S+)  --  (\d+) export/m.exec(out);
    rows.push({
      name,
      needs: shape === null ? null : Number(shape[1]),
      published: shape === null ? null : Number(shape[2]),
      root: root === null ? "" : `${root[1]} (${root[2]})`,
    });
  }

  console.log("\n| module | shape needs | published | largest chain root |");
  console.log("| --- | ---: | ---: | --- |");
  for (const r of rows.sort((a, b) => (b.published ?? -1) - (a.published ?? -1))) {
    const needs = r.needs === null ? "?" : r.needs;
    const pub = r.published === null ? "unreadable" : r.published;
    console.log(`| \`${r.name}\` | ${needs} | ${pub} | ${r.root} |`);
  }
  const unreadable = rows.filter((r) => r.needs === null).map((r) => r.name);
  if (unreadable.length > 0) {
    console.log(`\n${unreadable.length} module(s) could not be read: ${unreadable.join(", ")}`);
  }
  process.exit(0);
}

const module = argv.find((a) => !a.startsWith("--"));
if (module === undefined) {
  console.error("usage: blockers.mjs <module> [--log <emit-c output>]   |   blockers.mjs --all");
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
let apiUnreadable;
{
  const lines = layouts.split("\n");
  const start = lines.findIndex((l) => l.trim() === "public api");
  if (start < 0) {
    // Reported rather than counted as zero. The tool once printed
    // "querystring: 0 of 0 exports published", which reads like a measurement
    // and was the absence of one: `layouts` had failed and every count
    // downstream was computed over an empty list.
    //
    // But exiting here threw away the half that does not need `layouts`. `fs`
    // is the largest module in the profile -- 359 pinned test files -- and
    // `nts layouts` prints no public API section for it at all, so refusing
    // outright left the one module most worth analysing unanalysable. The
    // refusal census and the cascade come from `emit-c`; only the published
    // count needs `layouts`. So that count is marked unknown and the rest is
    // still printed.
    apiUnreadable = layouts.trim().split("\n").slice(-2).join(" / ");
  }
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
// A class export is only as published as its methods are compiled. The cascade
// names those `StringDecoder#flush`, never `StringDecoder`, so an exported
// class whose every method is refused used to read here as "refused by
// nothing" -- backend work only. `string_decoder` needs its class exported
// *and* `Buffer#toString` lowered, and reporting the first without the second
// would have called it one feature away when it is two.
const membersOf = (name) =>
  [...refusedNames].filter((n) => n.startsWith(`${name}#`));

const inCascade = (name) =>
  refusedNames.has(name) || calleeNames.has(name) || membersOf(name).length > 0;

const gatedBy = new Map();
const unnameable = [];
for (const entry of api) {
  if (entry.published) continue;
  if (!inCascade(entry.target)) {
    unnameable.push(entry);
    continue;
  }
  // Only walk the export itself when the cascade actually names it. A class
  // reached solely through its methods is not its own blocker, and listing it
  // as one puts `StringDecoder -- 1 export(s)` at the top of a ranking whose
  // whole job is to say what to go and fix.
  const named = edges.has(entry.target) || refusedNames.has(entry.target) ||
    calleeNames.has(entry.target);
  const behind = [
    ...(named ? rootsBehind(entry.target) : []),
    ...membersOf(entry.target).flatMap((m) => rootsBehind(m)),
  ];
  for (const root of new Set(behind)) {
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

if (apiUnreadable !== undefined) {
  console.log(
    `${module}: shape needs ${required === undefined ? "?" : required.length} name(s), ` +
      `published UNKNOWN -- \`nts layouts\` printed no public API section`,
  );
  console.log(`  (${apiUnreadable})`);
  console.log(`  The refusal census below is from emit-c and is unaffected.`);
} else {
  if (required !== undefined) {
    const missing = required.filter((n) => !publishedNames.has(n));
    console.log(
      `${module}: shape needs ${required.length} name(s), ` +
        `${required.length - missing.length} published, ${missing.length} missing`,
    );
    if (missing.length > 0) console.log(`  missing: ${missing.join(", ")}`);
  }
  console.log(`${module}: ${published.length} of ${api.length} exports published`);
}
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
    // Normalise the *name* and keep the *type*. Replacing every backticked
    // token collapsed `a property X of unrepresentable type (X | null)` over
    // both `PromiseWithResolvers | null` and `Cell | null` -- one name, two
    // entirely different causes -- and this document's author then described
    // the group by the wrong one and recommended a feature nobody needed. The
    // member name varies and is never the reason; the type is always the
    // reason, so the parenthesised part is kept verbatim.
    const open = r.what.indexOf(" (");
    const head = open < 0 ? r.what : r.what.slice(0, open);
    const tail = open < 0 ? "" : r.what.slice(open);
    const kind = head.replace(/`[^`]*`/g, "X") + tail;
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
