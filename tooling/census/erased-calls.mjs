// Every call of a function value reached through an erased slot, and the
// signatures they call it at.
//
//   node tooling/census/erased-calls.mjs [project ...]   (default: the runtime, runtime/react, examples/, outcomes)
//   node tooling/census/erased-calls.mjs --test262 <rows> ...   and every test262 file those census rows saw reach lowering
//   node tooling/census/erased-calls.mjs --self-test
//   NTS_BIN=<a pin> node tooling/census/erased-calls.mjs
//
// # Why
//
// A function held as `unknown` and called is `unerase` to a closure layout
// followed by `call.closure[slot]`: the slot index comes from the *call
// site's* function type, while the value's descriptor belongs to its real
// type. When they disagree the slot returns the wrong representation, runs at
// the wrong arity, or does not exist -- the last is every compiled React
// component segfaulting in `renderWithHooks` (2026-09-28). Two shapes of fix:
// one uniform erased signature with the call site erasing its arguments, or a
// slot per signature the program calls an erased value at. The second is only
// tractable if that set is small, so this counts it: per corpus, the sites,
// the distinct call signatures (type ids normalised), and their arities.
//
// A site is one whose callee operand is defined by `unerase` in the same
// function. A callee that reaches the call through a block argument or a
// field load after unerasing is not counted, and the count is a floor.

import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { materialise, outcomeFixtures, OUTCOMES, runMode } from "../conformance/outcomes-project.mjs";
import { bodyOf, materialise as materialiseCase, workspace } from "./project.mjs";
import { describe, provenanceOf } from "../conformance/pin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const WORKERS = Number(process.env.NTS_ERASED_CALLS_JOBS ?? 6);

/** A type with the compiler's numbering taken out, so two programs' signatures compare. */
const plain = (ty) => ty.replace(/#\d+/g, "").replace(/<\d+>/g, "").trim();

/** The erased-callee call sites of one prepared listing. */
export function erasedCalls(text) {
  const sites = [];
  for (const fn of text.split(/\n(?=(?:export )?(?:declare )?func )/)) {
    const name = /^(?:export )?(?:declare )?func (.+?)\(/.exec(fn)?.[1] ?? "?";
    const types = new Map();
    const unerased = new Set();
    for (const m of fn.matchAll(/^ {2}(%\d+) = (\S+).*? : (.+)$/gm)) {
      types.set(m[1], m[3]);
      if (m[2] === "unerase") unerased.add(m[1]);
    }
    // Block arguments: `b1(%3: i32, %4: f64):`.
    for (const header of fn.matchAll(/^b\d+\((.*)\):$/gm)) {
      for (const m of header[1].matchAll(/(%\d+): ([^,]+(?:<[^>]*>)?)/g)) types.set(m[1], m[2]);
    }
    for (const m of fn.matchAll(/^ {2}%\d+ = call\.closure\[(\d+)\] (%\d+)\(([^)]*)\) : (.+)$/gm)) {
      if (!unerased.has(m[2])) continue;
      // The first argument is the closure itself.
      const args = m[3].split(",").map((a) => a.trim()).filter(Boolean).slice(1);
      const signature = `(${args.map((a) => plain(types.get(a) ?? "?")).join(", ")}) -> ${plain(m[4])}`;
      sites.push({ function: name, slot: Number(m[1]), arity: args.length, signature });
    }
  }
  return sites;
}

// **Seen to count before it is trusted**, on the listing shape this reads.
function selfTest() {
  const listing = [
    "func run(key: managed<str>) -> managed<str> {",
    "b0:",
    "  %3 = call.extern nts_map_get(%1, %2) : erased",
    "  %8 = unerase %3 : managed<obj#18>",
    "  %9 = const 41 : f64",
    "  %10 = call.closure[0] %8(%8, %9) : f64",
    "  %12 = param 0 : managed<obj#7>",
    "  %13 = call.closure[0] %12(%12, %9) : f64",
    "}",
    "func two() -> f64 {",
    "b0:",
    "  %1 = unerase %0 : managed<obj#23>",
    "  %2 = const \"a\" : managed<str>",
    "  br b1(%2)",
    "b1(%5: managed<str>):",
    "  %3 = call.closure[1] %1(%1, %2, %5) : managed<str>",
    "}",
  ].join("\n");
  const sites = erasedCalls(listing);
  if (sites.length !== 2) return `${sites.length} site(s) read where two call through an unerase and one through a param`;
  if (sites[0].signature !== "(f64) -> f64" || sites[0].arity !== 1) return `the first site read as ${JSON.stringify(sites[0])}`;
  if (sites[1].signature !== "(managed<str>, managed<str>) -> managed<str>" || sites[1].slot !== 1) return `the second site read as ${JSON.stringify(sites[1])}`;
  return null;
}

const argv = process.argv.slice(2);
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: sites through an unerase counted, one through a param not; signatures and slots read");
  process.exit(0);
}

const SOURCE = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
if (!existsSync(SOURCE)) {
  console.log(`  NOT MEASURED: no compiler at ${SOURCE}; set NTS_BIN`);
  process.exit(2);
}
const base = join(homedir(), ".cache/nts-erased-calls");
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(join(base, "run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const NTS = join(scratch, "nts");
copyFileSync(SOURCE, NTS);
chmodSync(NTS, 0o755);
const env = { ...process.env, NTS_TSGO: process.env.NTS_TSGO ?? join(ROOT, "target/tsgo"), NTS_SNAPSHOT_CACHE: join(scratch, "snapshots") };
delete env.NTS_NO_SNAPSHOT_CACHE;

const under = (dir) =>
  readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, dir, e.name, "tsconfig.json")))
    .map((e) => ({ corpus: dir.split("/")[0] === "runtime" ? "runtime" : dir, label: `${dir}/${e.name}`, at: join(dir, e.name) }));
/** Every project under runtime/react, at any depth its tsconfigs sit. */
function react(dir = "runtime/react", depth = 0) {
  const out = existsSync(join(ROOT, dir, "tsconfig.json")) ? [{ corpus: "react", label: dir, at: dir }] : [];
  if (depth >= 3) return out;
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) out.push(...react(join(dir, e.name), depth + 1));
  }
  return out;
}

/**
 * test262's files that reached lowering in a census run, each materialised
 * the way the census builds a case (project.mjs is the one definition): the
 * `--rows` files name them and their buckets, and a file that never
 * typechecked has no prepared program to read.
 */
function test262(rowsFiles) {
  const reached = new Set(["strict-pass", "threw", "fail", "invalid-hir"]);
  const cases = [];
  for (const file of rowsFiles) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.startsWith("{\"path\"")) continue;
      const r = JSON.parse(line);
      if (reached.has(r.bucket) || r.why === "lowering") cases.push(r.path);
    }
  }
  return cases.map((path, i) => {
    const dir = workspace(join(scratch, "t262", String(i)));
    materialiseCase(dir, bodyOf(readFileSync(join(ROOT, "third_party/test262", path), "utf8")));
    return { corpus: "test262", label: path, at: dir };
  });
}

const flag = (name) => {
  const at = argv.indexOf(name);
  if (at < 0) return [];
  const values = [];
  for (let i = at + 1; i < argv.length && !argv[i].startsWith("--"); i++) values.push(argv[i]);
  return values;
};
const rowsFiles = flag("--test262");
const named = argv.filter((a, i) => !a.startsWith("--") && !rowsFiles.includes(a));
const projects = named.length > 0
  ? named.map((p) => ({ corpus: "named", label: p, at: p }))
  : [
    ...under("runtime/node"),
    { corpus: "runtime", label: "runtime/web-platform", at: "runtime/web-platform" },
    ...react(),
    ...under("examples"),
    ...outcomeFixtures().map((n) => ({ corpus: "outcomes", label: `outcomes/${n}`, at: materialise(scratch, n, join(OUTCOMES, n, "src"), runMode(n)) })),
    ...test262(rowsFiles),
  ];

const run = (args) =>
  new Promise((done) => {
    const child = spawn(NTS, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", () => {});
    const timer = setTimeout(() => child.kill("SIGKILL"), 600_000);
    child.on("close", (status) => { clearTimeout(timer); done({ status, out }); });
  });

const found = [];
const unmeasured = [];
let next = 0;
await Promise.all(Array.from({ length: WORKERS }, async () => {
  while (next < projects.length) {
    const p = projects[next++];
    const r = await run(["hir", "--prepared", p.at]);
    if (!/^\d+ function\(s\)/m.test(r.out)) {
      unmeasured.push(p.label);
      continue;
    }
    for (const s of erasedCalls(r.out)) found.push({ ...p, ...s });
  }
}));

console.log(`  compiler ${SOURCE} -- ${describe(provenanceOf(SOURCE))}`);
console.log(`  ${projects.length - unmeasured.length} of ${projects.length} project(s) listed; ${unmeasured.length} printed no prepared program (does not typecheck, or refused whole)`);
for (const corpus of [...new Set(projects.map((p) => p.corpus))]) {
  const sites = found.filter((f) => f.corpus === corpus);
  const signatures = new Map();
  for (const s of sites) {
    const row = signatures.get(s.signature) ?? { sites: 0, projects: new Set(), slots: new Set() };
    row.sites += 1;
    row.projects.add(s.label);
    row.slots.add(s.slot);
    signatures.set(s.signature, row);
  }
  const arities = new Map();
  for (const s of sites) arities.set(s.arity, (arities.get(s.arity) ?? 0) + 1);
  console.log(`\n  ${corpus}: ${sites.length} site(s) in ${new Set(sites.map((s) => s.label)).size} project(s), ${signatures.size} distinct call signature(s); arities ${[...arities].sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}:${n}`).join(" ") || "-"}`);
  // The table a per-signature thunk needs is per *program*: its width is the
  // distinct signatures one program calls an erased value at.
  const perProject = new Map();
  for (const s of sites) perProject.set(s.label, (perProject.get(s.label) ?? new Set()).add(s.signature));
  const widest = [...perProject].sort((a, b) => b[1].size - a[1].size).slice(0, 3);
  if (widest.length > 0) console.log(`    widest program(s): ${widest.map(([l, set]) => `${l} ${set.size}`).join(", ")}`);
  for (const [sig, row] of [...signatures].sort((a, b) => b[1].sites - a[1].sites).slice(0, 15)) {
    console.log(`    ${String(row.sites).padStart(4)} site(s) ${String(row.projects.size).padStart(3)} project(s) slot ${[...row.slots].join(",")}  ${sig}`);
  }
  if (signatures.size > 15) console.log(`    ... ${signatures.size - 15} more`);
}
