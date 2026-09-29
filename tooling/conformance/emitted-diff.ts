// What two compilers emit differently for the runtime, per module -- and, with
// `--axis`, what that difference does to node's own tests.
//
//   node tooling/conformance/emitted-diff.ts <before> <after> [project ...]
//                                        (default: runtime/node/*, runtime/web-platform)
//   node tooling/conformance/emitted-diff.ts <before> <after> --axis
//   node tooling/conformance/emitted-diff.ts <before> <after> --rc     under reference counting
//   node tooling/conformance/emitted-diff.ts --self-test
//
// # Why
//
// 7f7bf5340 (`Array.isArray` of a value narrowed to `object`) read neutral in
// four instruments: the census (refusals, sites, definitions, messages),
// `refusal-diff` (0 moves), the examples differential (361 unchanged) and
// the definitions floor. It changed the emitted C of every node module and
// fixed two live wrong answers in files everything imports. Each of those
// instruments asks *whether* code compiles; none asks what it answers. The
// compiled axis does, and nothing pointed it at the change.
//
// So this names the modules whose emitted program differs -- the blast
// radius, and the honest answer to "did my change do anything" -- and `--axis`
// runs node's tests for exactly those, under both compilers, per test file.
// The axis over everything is about 16 minutes; over a few modules it is not.
//
// # Differs, robustly to renumbering
//
// A byte diff selects every module every time: one new closure renumbers
// `Closure1818`, every `obj` type id after it and every temporary. In `stream`
// the byte diff was 5,562 lines and the finding was `nts_is_array` going 5 to
// 8. So each module is read as:
//
//   helpers    calls per runtime helper (`nts_*(`) -- the line that says what
//              a change did, in a second
//   functions  a multiset of function bodies, each **alpha-renamed**: every
//              identifier with a digit in it becomes its spelling with digits
//              removed plus the order it first appears in *that* function. A
//              renumbering is invisible; `return v1` against `return v2` is
//              not, which it would be if the digits were simply erased
//   bytes      the size of program.c, which was the only evidence a `&&`
//              fold fired at all: corpus-neutral in counts, 456 bytes smaller
//
// Top-level declarations (program.h, and program.c between functions) are one
// more body, so a changed layout or constant table differs too.
//
// **"Emitted C differs" is still not "behaviour differs"**: a changed body can
// be equivalent. That is what `--axis` is for, and why a differing module is
// a selection and not a verdict.
//
// # The provider is part of the question
//
// `--rc` (or `NTS_RC=1`, as agree.mjs reads it) emits under reference
// counting, and `--axis` then builds its addons counted too (build.sh's
// `NTS_CONFORMANCE_RC`). Without it the provider is `NoGc`, `rc.rs` never
// runs, and a change to where releases go reads "29 of 29 byte-identical" --
// true and vacuous, and nearly quoted as evidence on 2026-09-28. So every
// result names its provider, and a change to counting owes a run with `--rc`.
//
// # What it cannot see
//
// `runtime/web-platform` differs or not like any module, but the compiled axis
// is node's tests and has no row for it. A module that differs and passes
// nothing on the axis either way is selected and says nothing: the axis is
// only as sharp as the module's real passes (see compiled-axis.floor).
//
// Exit 0: measured, and under `--axis` no test file lost a real pass. Exit 1:
// a module not measured, or a lost pass. Exit 2: the tool could not start.

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAxis } from "./compiled-axis-rows.mjs";
import { armLines, oneChange, frontendFor } from "./pin.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const WORKERS = Number(process.env.NTS_EMITTED_JOBS ?? 4);

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;
const HELPER = /\bnts_[A-Za-z0-9_]+(?=\()/g;
// A definition starts at column 0 and ends its line with `) {`; its body ends
// at the next line that is exactly `}`. That is how both backends' C printer
// lays a function out, and a body the reader misses lands in the declarations
// body, so it still differs rather than vanishing.
const DEFINITION = /^[A-Za-z_][^;=]*?\b([A-Za-z_][A-Za-z0-9_]*)\(.*\) \{$/;

/** `text` with each identifier containing a digit alpha-renamed within it. */
export function alphaRename(text) {
  const order = new Map();
  return text.replace(IDENT, (id) => {
    if (!/\d/.test(id)) return id;
    if (!order.has(id)) order.set(id, order.size);
    return `${id.replace(/\d+/g, "#")}@${order.get(id)}`;
  });
}

/** A module's emitted program as helpers, renamed bodies by name, and bytes. */
export function summarise(program, header = "") {
  const helpers = new Map();
  for (const m of program.matchAll(HELPER)) helpers.set(m[0], (helpers.get(m[0]) ?? 0) + 1);
  const bodies = new Map();
  let order = 0;
  const add = (name, text) => bodies.set(name, [...(bodies.get(name) ?? []), { renamed: alphaRename(text), raw: text, order: order++ }]);
  const declarations = [header];
  const lines = program.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const head = DEFINITION.exec(lines[i]);
    if (!head) {
      declarations.push(lines[i]);
      continue;
    }
    const end = lines.indexOf("}", i + 1);
    if (end < 0) {
      declarations.push(...lines.slice(i));
      break;
    }
    add(head[1].replace(/\d+/g, "#"), lines.slice(i, end + 1).join("\n"));
    i = end;
  }
  add("(declarations)", declarations.join("\n"));
  for (const list of bodies.values()) list.sort((a, b) => (a.renamed < b.renamed ? -1 : a.renamed > b.renamed ? 1 : 0));
  return { helpers, bodies, bytes: program.length, text: `${header}\n${program}` };
}

/** How `after` differs from `before`: helper deltas, changed/added/removed functions, bytes. */
export function compare(before, after) {
  const helpers = [];
  for (const name of new Set([...before.helpers.keys(), ...after.helpers.keys()])) {
    const a = before.helpers.get(name) ?? 0;
    const b = after.helpers.get(name) ?? 0;
    if (a !== b) helpers.push({ name, before: a, after: b });
  }
  helpers.sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before) || x.name.localeCompare(y.name));
  let changed = 0;
  let added = 0;
  let removed = 0;
  const names = [];
  const renumbered = [];
  const sameMultiset = (xs, ys) => xs.length === ys.length && [...xs].sort().every((x, i) => x === [...ys].sort()[i]);
  for (const name of new Set([...before.bodies.keys(), ...after.bodies.keys()])) {
    const a = before.bodies.get(name) ?? [];
    const b = after.bodies.get(name) ?? [];
    // A multiset difference: `Closure#__call` names many bodies.
    const left = a.map((x) => x.renamed);
    let only = 0;
    for (const body of b.map((x) => x.renamed)) {
      const at = left.indexOf(body);
      if (at >= 0) left.splice(at, 1);
      else only += 1;
    }
    if (left.length === 0 && only === 0) {
      // The same program up to renaming -- and still a fact when the text
      // moved: a value added or removed where no C shows it shifts every id
      // after it, and that shift is the only evidence it happened.
      if (!sameMultiset(a.map((x) => x.raw), b.map((x) => x.raw))) renumbered.push({ name, order: Math.min(...b.map((x) => x.order)) });
      continue;
    }
    names.push(name);
    const both = Math.min(left.length, only);
    changed += both;
    removed += left.length - both;
    added += only - both;
  }
  const functions = before.bodies.size;
  renumbered.sort((x, y) => x.order - y.order);
  const identical = before.text === after.text;
  return { helpers, changed, added, removed, names: names.sort(), functions, bytes: after.bytes - before.bytes, differs: names.length > 0, renumbered: renumbered.map((r) => r.name), renumberedOnly: names.length === 0 && !identical, identical };
}

/**
 * **The unmeasured count is part of every verdict line, not a line above it.**
 * A change that produces invalid HIR leaves one arm with no program.c, and
 * refusal-diff cannot see that either. On 2026-09-29 "0 emit a different
 * program" over the projects that remained read as clean, with the loss
 * printed just above it.
 */
function notMeasuredClause(unmeasured, total) {
  return unmeasured === 0 ? "" : `; ${unmeasured} of ${total} project(s) NOT MEASURED, and byte-identical says nothing about them`;
}

// **Seen to tell renumbering from change before it is trusted.**
function selfTest() {
  if (notMeasuredClause(0, 5) !== "" || !notMeasuredClause(1, 5).includes("1 of 5 project(s) NOT MEASURED")) return `the verdict's unmeasured clause: ${JSON.stringify([notMeasuredClause(0, 5), notMeasuredClause(1, 5)])}`;
  const prog = (a, b, t, extra = "") => [
    `static NtsObj_Closure${a} * g${t};`,
    `double f${a}(double v0) {`,
    `  double v${b} = nts_unit(v0);`,
    `  return v${b} + ${extra || "1"};`,
    "}",
    `void Closure${a}__call(NtsObj_Closure${a} * v0) {`,
    "  nts_is_array(v0);",
    "}",
  ].join("\n");
  const base = summarise(prog(12, 3, 7));
  const renumbered = compare(base, summarise(prog(19, 5, 2)));
  if (renumbered.differs) return `a renumbering read as a change: ${renumbered.names.join(", ")}`;
  // ...and never as "the same": the shift is the only evidence a value came or went.
  if (!renumbered.renumberedOnly || !renumbered.renumbered.includes("f#")) return `a renumbering read as nothing: ${JSON.stringify(renumbered.renumbered)}`;
  const same = compare(base, summarise(prog(12, 3, 7)));
  if (!same.identical || same.renumberedOnly || same.differs) return "an identical program read as moved";
  const shifted = compare(base, summarise(prog(12, 4, 7)));
  if (shifted.renumbered.join() !== "f#" || shifted.differs) return `one function's shifted value: ${JSON.stringify(shifted)}`;
  const literal = compare(base, summarise(prog(12, 3, 7, "2")));
  if (!literal.differs || literal.names.join() !== "f#" || literal.changed !== 1) return `a changed literal: ${JSON.stringify(literal.names)}`;
  const swapped = summarise(prog(12, 3, 7).replace("return v3", "return v0"));
  if (!compare(base, swapped).differs) return "`return v3` against `return v0` read as the same body";
  const helper = compare(base, summarise(`${prog(12, 3, 7)}\nvoid h(void) {\n  nts_is_array(0);\n}`));
  if (helper.helpers.map((h) => `${h.name} ${h.before}->${h.after}`).join() !== "nts_is_array 1->2" || helper.added !== 1) return `a new call: ${JSON.stringify(helper)}`;
  const table = compare(base, summarise(prog(12, 3, 7).replace(" * g7;", " * g7 = 0;")));
  if (table.names.join() !== "(declarations)") return `a changed declaration: ${table.names.join()}`;
  return null;
}

const argv = process.argv.slice(2);
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: a renumbering is the same program and reported as renumbered, never as identical; a literal, a swapped operand, a new call and a declaration each differ; a verdict names its unmeasured projects");
  process.exit(0);
}

/** Reference counting: the flag, or `NTS_RC` as the differential reads it. */
const RC = argv.includes("--rc") || (process.env.NTS_RC ?? "0") !== "0";
const PROVIDER = RC ? "reference counting (--rc)" : "no-gc (the default; rc.rs does not run)";
const positional = argv.filter((a) => !a.startsWith("--"));
const [beforeBin, afterBin, ...named] = positional;
if (!beforeBin || !afterBin) {
  console.log("  usage: emitted-diff.ts <before-nts> <after-nts> [project ...] [--axis] [--one-change]");
  process.exit(2);
}
for (const bin of [beforeBin, afterBin]) {
  if (!existsSync(bin)) {
    console.log(`  NOT MEASURED: no compiler at ${bin}`);
    process.exit(2);
  }
}
if (argv.includes("--one-change")) {
  const why = oneChange(beforeBin, afterBin);
  if (why) {
    console.log(`  NOT MEASURED: --one-change, and ${why}`);
    process.exit(2);
  }
}

const projects = (named.length > 0
  ? named
  : [
    ...readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(ROOT, "runtime/node", e.name, "tsconfig.json")))
      .map((e) => `runtime/node/${e.name}`),
    "runtime/web-platform",
  ]).sort();

// Emitted C for 27 modules twice is hundreds of megabytes: under ~/.cache,
// never the /tmp tmpfs. Each arm pinned, with its own snapshot cache.
const base = join(homedir(), ".cache/nts-emitted-diff");
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(join(base, "run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
const arms = [["before", beforeBin], ["after", afterBin]].map(([name, source]) => {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  const nts = join(dir, "nts");
  copyFileSync(source, nts);
  chmodSync(nts, 0o755);
  return { name, source, dir, nts };
});
// The frontend follows the pin (pin.ts `frontendFor`); none stops the run
// here, before every project prints nothing and reads as clean.
// Per arm: two arms are two binaries and may be two pins, and one shared
// frontend would serve one arm the other's -- what the per-arm snapshot
// caches exist to prevent. Asked of each *source*, where a pin's provenance
// sits, not of the scratch copy.
for (const arm of arms) {
  arm.frontend = frontendFor(arm.source, ROOT);
  if (!arm.frontend.exists) {
    console.log(`  NOT MEASURED: no frontend for the ${arm.name} arm at ${arm.frontend.path} -- set NTS_TSGO, or use a pin (it records its frontend)`);
    process.exit(2);
  }
}

const run = (cmd, args, env) =>
  new Promise((done) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 900_000);
    child.on("error", (error) => { clearTimeout(timer); done({ error, out }); });
    child.on("close", (status, signal) => { clearTimeout(timer); done({ status, signal, out }); });
  });

/** One module under one arm, emitted the way build.sh emits an addon. */
async function emit(arm, project) {
  const out = join(arm.dir, "out", project.replace(/\//g, "_"));
  const env = { ...process.env, NTS_TSGO: arm.frontend.path, NTS_SNAPSHOT_CACHE: join(arm.dir, "snapshots") };
  delete env.NTS_NO_SNAPSHOT_CACHE;
  const r = await run(arm.nts, ["emit-c", join(project, "tsconfig.json"), "--out", out, "--napi", ...(RC ? ["--rc"] : [])], env);
  const program = join(out, "program.c");
  // "Wrote nothing" is also what a run that never happened looks like, so a
  // missing program is not measured rather than an empty module.
  if (r.error || r.signal || !existsSync(program)) {
    return { unmeasured: `emit-c ${r.signal ?? r.error?.message ?? `exit ${r.status}`}, no program.c -- ${r.out.trim().split("\n").pop()?.slice(0, 100) ?? ""}` };
  }
  const header = existsSync(join(out, "program.h")) ? readFileSync(join(out, "program.h"), "utf8") : "";
  const summary = summarise(readFileSync(program, "utf8"), header);
  rmSync(out, { recursive: true, force: true });
  return summary;
}

const started = Date.now();
const results = new Map();
let next = 0;
await Promise.all(Array.from({ length: Math.min(WORKERS, projects.length) }, async () => {
  while (next < projects.length) {
    const project = projects[next++];
    const [before, after] = [await emit(arms[0], project), await emit(arms[1], project)];
    results.set(project, { before, after });
  }
}));

console.log(`  before ${beforeBin}, after ${afterBin} (both pinned), ${projects.length} project(s) in ${Math.round((Date.now() - started) / 1000)} s`);
for (const line of armLines(beforeBin, afterBin)) console.log(`  ${line}`);
console.log(`  provider: ${PROVIDER}`);
const unmeasured = [];
const differing = [];
const renumberedOnly = [];
for (const project of projects) {
  const { before, after } = results.get(project);
  if (before.unmeasured || after.unmeasured) {
    unmeasured.push(`${project}: ${before.unmeasured ? `before: ${before.unmeasured}` : ""}${after.unmeasured ? ` after: ${after.unmeasured}` : ""}`.trim());
    continue;
  }
  const d = compare(before, after);
  if (d.renumberedOnly) {
    renumberedOnly.push({ project, d });
    continue;
  }
  if (!d.differs) continue;
  differing.push(project);
  const helpers = d.helpers.slice(0, 6).map((h) => `${h.name} ${h.before} -> ${h.after}`).join(", ");
  console.log(`\n  ${project}`);
  console.log(`    functions  ${d.changed} changed, ${d.added} added, ${d.removed} removed, of ${d.functions}; ${d.bytes >= 0 ? "+" : ""}${d.bytes} bytes`);
  console.log(`    helpers    ${helpers || "no call count moved"}${d.helpers.length > 6 ? `, +${d.helpers.length - 6} more` : ""}`);
  console.log(`    in         ${d.names.slice(0, 8).join(", ")}${d.names.length > 8 ? `, +${d.names.length - 8} more` : ""}`);
  if (d.renumbered.length > 0) console.log(`    renumbered ${d.renumbered.slice(0, 4).join(", ")}${d.renumbered.length > 4 ? `, +${d.renumbered.length - 4} more` : ""}`);
}
// **Renumbered only is a finding, not a "no".** The same program up to
// renaming, and different text: a value was added or removed where no C
// shows it, and every id after it shifted. The first function in file order
// is where the shift starts. On 2026-09-28 this was the whole of the evidence
// for a `ConstUndefined` produced at a generator's frame pointer -- no count
// moved, and a diff that normalised it away would have said nothing changed.
for (const { project, d } of renumberedOnly) {
  console.log(`\n  ${project}: RENUMBERED ONLY -- a value came or went where no C shows it`);
  console.log(`    starts in  ${d.renumbered[0] ?? "(the text moved, no function's body did)"}${d.renumbered.length > 1 ? `; ${d.renumbered.length} function(s) shifted: ${d.renumbered.slice(0, 6).join(", ")}${d.renumbered.length > 6 ? ", ..." : ""}` : ""}`);
}
for (const u of unmeasured) console.log(`  NOT MEASURED  ${u}`);
const measuredCount = projects.length - unmeasured.length;
const notMeasured = notMeasuredClause(unmeasured.length, projects.length);
console.log(`\n  of ${measuredCount} measured project(s), under ${RC ? "reference counting" : "no-gc"}: ${differing.length} emit a different program, ${renumberedOnly.length} the same program renumbered, ${measuredCount - differing.length - renumberedOnly.length} byte-identical${notMeasured}`);

const axisModules = differing.filter((p) => p.startsWith("runtime/node/")).map((p) => p.slice("runtime/node/".length));
if (!argv.includes("--axis")) {
  if (axisModules.length > 0) console.log(`  the compiled axis for them: add --axis (${axisModules.join(" ")})`);
  process.exit(unmeasured.length === 0 ? 0 : 1);
}
if (differing.includes("runtime/web-platform")) console.log("  runtime/web-platform differs and has no compiled axis: its difference is unmeasured behaviourally");
if (axisModules.length === 0) {
  console.log("  no node module differs: the axis has nothing to run");
  process.exit(unmeasured.length === 0 ? 0 : 1);
}

/**
 * compiled-axis.sh for `modules` under one arm: its rows, and each measured
 * module's real passes (intact minus those that survive emptying).
 */
function axis(arm, modules) {
  const addons = join(arm.dir, "addons");
  const tmp = join(arm.dir, "tmp");
  mkdirSync(addons, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  const r = spawnSync("bash", [join(HERE, "compiled-axis.sh"), ...modules], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 26,
    env: { ...process.env, NTS_BIN: arm.nts, NTS_TSGO: arm.frontend.path, NTS_ADDON_OUT: addons, NTS_SNAPSHOT_CACHE: join(arm.dir, "snapshots"), TMPDIR: tmp, ...(RC ? { NTS_CONFORMANCE_RC: "1" } : {}) },
  });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const rows = readAxis(text);
  const passes = new Map();
  const lines = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : null);
  for (const m of modules) {
    const row = rows.get(m);
    const intact = lines(join(addons, `${m}.intact.txt`));
    const empty = lines(join(addons, `${m}.empty.txt`));
    if (!row || row.unmeasured || !intact || !empty) {
      const said = text.split("\n").find((l) => l.startsWith(`${m} `))?.replace(/^\S+\s+/, "") ?? "no row";
      passes.set(m, { unmeasured: row?.unmeasured ?? said });
      continue;
    }
    const hollow = new Set(empty);
    passes.set(m, { real: new Set(intact.filter((t) => !hollow.has(t))) });
  }
  return passes;
}

console.log(`\n  the compiled axis over ${axisModules.length} module(s), under each compiler`);
const [axisBefore, axisAfter] = arms.map((arm) => {
  const t = Date.now();
  const passes = axis(arm, axisModules);
  console.log(`    ${arm.name}: ${Math.round((Date.now() - t) / 1000)} s`);
  return passes;
});
let lost = 0;
let axisUnmeasured = 0;
for (const m of axisModules) {
  const a = axisBefore.get(m);
  const b = axisAfter.get(m);
  if (a.unmeasured || b.unmeasured) {
    axisUnmeasured += 1;
    console.log(`  NOT MEASURED  ${m}: ${a.unmeasured ? `before: ${a.unmeasured} ` : ""}${b.unmeasured ? `after: ${b.unmeasured}` : ""}`.trimEnd());
    continue;
  }
  const gone = [...a.real].filter((t) => !b.real.has(t)).sort();
  const gained = [...b.real].filter((t) => !a.real.has(t)).sort();
  lost += gone.length;
  console.log(`  ${m.padEnd(16)} ${a.real.size} -> ${b.real.size} real pass(es)`);
  for (const t of gone) console.log(`    LOST    ${t}`);
  for (const t of gained) console.log(`    gained  ${t}   (read it: an unsound change gains too)`);
}
console.log(lost === 0 && axisUnmeasured === 0 ? `  no test file lost a real pass${notMeasured}` : `  ${lost} real pass(es) lost, ${axisUnmeasured} module(s) not measured${notMeasured}`);
process.exit(lost === 0 && axisUnmeasured === 0 && unmeasured.length === 0 ? 0 : 1);
