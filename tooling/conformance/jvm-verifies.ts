// Does what `emit-jvm` emits for the runtime pass the JVM's verifier?
//
//   node tooling/conformance/jvm-verifies.ts [project ...]   (default: runtime/node/*, runtime/web-platform)
//   node tooling/conformance/jvm-verifies.ts --outcomes      the outcomes fixtures instead
//   NTS_BIN=<a pin> node tooling/conformance/jvm-verifies.ts
//
// # Why
//
// The JVM is the backend that sees type confusions C and LLVM agree on by
// construction -- C spells every reference `T *` and LLVM `ptr`, and the
// verifier types them. The gate's `jvm` step runs the *examples*, so the
// runtime's class files were emitted by nobody and checked by none: the
// position `emit-llvm` was in when `assembles` found 24 of 27 modules invalid
// on its first run.
//
// # What it asks
//
// Per project, `nts emit-jvm --out <dir>`, then JvmVerify.java under
// `java -Xverify:all` loads every class without initialising it -- no static
// initialiser runs, so nothing the program does happens -- and links it, which
// is when HotSpot verifies. Every class is tried, so a module reports each
// failing class, not only the first. Two kinds, kept apart:
//
//   INVALID   VerifyError, ClassFormatError: bytecode the JVM rejects
//   MISSING   a reference that does not resolve (a class or member absent)
//
// A verifier reason is read before it is named: url's "Bad local variable
// type ... locals[238] is top" looked like a read no path initialises, and is
// a stack-map frame at a branch join that drops a local both arms leave
// assigned -- the JVM backend's frame, not the program. Two of the first
// run's five causes (an array given for a `{ length }` record, and that one)
// are the JVM's alone; C was measured answering right.
//
// **A MISSING class is usually the JVM's own refusal**, not an emitter gap:
// `emit-jvm` declines a class under NTS4009 when one of its overrides has
// another representation than the method it overrides ("dispatch would
// silently reach the wrong one"), and what references it then does not
// resolve. C and LLVM have no such check and dispatch anyway -- a narrowed
// parameter read at an erased argument is SIGSEGV on C
// (a-writable-override-narrowing-an-erased-chunk, child_process's
// `ChildWritable._write`). So read (E) through the declines: fewer parameters
// and a covariant record return are the JVM's alone (C ignores extra
// arguments; the subtype's record extends the base's), and a narrowed
// parameter is live on C.
//
// **Seen once, unattributed:** one runtime run on 2026-09-28 reported "1 not
// measured" and did not say which module; the rerun and every run since
// measured 29 of 29. Recorded so it is not read as a finding later, nor
// forgotten if it recurs -- if it does, the NOT MEASURED line names the module.
//
// Declines are not failures: `emit-jvm` names what it cannot call (a native C
// function) and writes the rest, and the rest must verify. A module whose
// `emit-jvm` writes no class is NOT MEASURED.
//
// # Known modules
//
// `tooling/conformance/jvm-verifies.known`: `project<TAB>why`, one per line.
// Its failures print and pass; any other fails; one that verifies again
// prints "remove it".
//
// Exit 0: every module verifies or is known not to. Exit 1: a new failure, or
// a module not measured. Exit 2: the tool could not start.

import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { materialise, outcomeFixtures, OUTCOMES, runMode } from "./outcomes-project.ts";
import { describe, provenanceOf, frontendFor } from "./pin.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const KNOWN = join(HERE, "jvm-verifies.known");
const DECLINES = join(HERE, "jvm-declines.known");
const DRIVER = join(HERE, "JvmVerify.java");
const SOURCE = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const JAVA = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin/java") : "java";
const WORKERS = Number(process.env.NTS_JVM_VERIFIES_JOBS ?? 4);

if (!existsSync(SOURCE)) {
  console.log(`  NOT MEASURED: no compiler at ${SOURCE}; set NTS_BIN`);
  process.exit(2);
}
const base = join(homedir(), ".cache/nts-jvm-verifies");
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(join(base, "run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
const NTS = join(scratch, "nts");
copyFileSync(SOURCE, NTS);
chmodSync(NTS, 0o755);
// The frontend follows the pin (pin.ts `frontendFor`); none stops the run
// here, before every project prints nothing and reads as clean.
const FRONTEND = frontendFor(SOURCE, ROOT);
if (!FRONTEND.exists) {
  console.log(`  NOT MEASURED: no frontend at ${FRONTEND.path} -- set NTS_TSGO, or use a pin (it records its frontend)`);
  process.exit(2);
}
const env = { ...process.env, NTS_TSGO: FRONTEND.path, NTS_SNAPSHOT_CACHE: join(scratch, "snapshots") };
delete env.NTS_NO_SNAPSHOT_CACHE;

const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
/**
 * Outcomes fixtures, each as the project outcomes-check builds (one definition
 * of a fixture as a program), labelled by its own path. A fixture can be a JVM
 * witness while its C record is a guard.
 */
const where = new Map();
const outcomes = () => outcomeFixtures().map((n) => {
  const label = `tooling/conformance/outcomes/${n}`;
  where.set(label, materialise(scratch, n, join(OUTCOMES, n, "src"), runMode(n)));
  return label;
});
const projects = (named.length > 0
  ? named
  : process.argv.includes("--outcomes")
    ? outcomes()
    : [
    ...readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(ROOT, "runtime/node", e.name, "tsconfig.json")))
      .map((e) => `runtime/node/${e.name}`),
    "runtime/web-platform",
  ]).sort();

const known = new Map(
  (existsSync(KNOWN) ? readFileSync(KNOWN, "utf8") : "")
    .split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t")).map(([p, why]) => [p, why ?? ""]),
);

const run = (cmd, args) =>
  new Promise((done) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 900_000);
    child.on("error", (error) => { clearTimeout(timer); done({ error, out }); });
    child.on("close", (status, signal) => { clearTimeout(timer); done({ status, signal, out }); });
  });

/** JvmVerify's output as `{ invalid, missing, verified, total }`, or null when it printed no summary. */
export function readVerify(text) {
  const summary = /^VERIFIED (\d+) OF (\d+)$/m.exec(text);
  if (!summary) return null;
  const lines = (kind) => text.split("\n").filter((l) => l.startsWith(`${kind} `)).map((l) => l.slice(kind.length + 1));
  return { invalid: lines("INVALID"), missing: lines("MISSING"), verified: Number(summary[1]), total: Number(summary[2]) };
}

/**
 * An NTS4009 decline, normalised to its shape: an override whose
 * representation differs from the method it overrides, with the compiler's
 * numbering (closures, generic instances, signature layouts) taken out so one
 * shape across programs and runs is one key.
 */
export function declineShape(line) {
  const m = /NTS4009 `([^`]+)` is `([^`]+)` where the method it overrides is `([^`]+)`/.exec(line);
  if (!m) return null;
  const plain = (t) => t.replace(/Closure\d+/g, "ClosureN").replace(/\$\d+\$/g, "$N$").replace(/Fn[\d_]*__\d+/g, "FnN").replace(/Type\d+/g, "TypeN");
  return `${plain(m[1])} ${plain(m[2])} over ${plain(m[3])}`;
}
/** jvm-declines.known: shape -> { verdict, why }; verdict is jvm-only, live-on-c or unmeasured. */
const declinesKnown = new Map(
  (existsSync(DECLINES) ? readFileSync(DECLINES, "utf8") : "")
    .split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t")).map(([shape, verdict, why]) => [shape, { verdict, why: why ?? "" }]),
);
const declines = new Map();

const failed = [];
const unmeasured = [];
const invalidHir = [];
let classes = 0;
let verified = 0;

async function check(project, slot) {
  const out = join(scratch, `out-${slot}`);
  rmSync(out, { recursive: true, force: true });
  const emit = await run(NTS, ["emit-jvm", where.get(project) ?? project, "--out", out]);
  const jar = join(out, "nts-runtime.jar");
  for (const line of emit.out.split("\n")) {
    const shape = declineShape(line);
    if (shape) declines.set(shape, (declines.get(shape) ?? new Set()).add(project));
  }
  // Invalid HIR emits nothing on any backend, and is its own outcome, which
  // outcomes-check records: counted, not "not measured".
  if (/refusing to emit code from invalid HIR/.test(emit.out)) {
    invalidHir.push(project);
    return;
  }
  if (emit.error || emit.signal || !existsSync(jar)) {
    unmeasured.push(`${project}: emit-jvm ${emit.signal ?? emit.error?.message ?? `exit ${emit.status}`}, no class written -- ${emit.out.trim().split("\n").pop()?.slice(0, 100)}`);
    return;
  }
  const v = await run(JAVA, ["-Xverify:all", "-cp", `${out}:${jar}`, DRIVER, out]);
  const read = readVerify(v.out);
  if (v.error || !read) {
    unmeasured.push(`${project}: the verifier printed no summary -- ${(v.error?.message ?? v.out.trim().split("\n").pop() ?? "").slice(0, 120)}`);
    return;
  }
  if (read.total === 0) {
    unmeasured.push(`${project}: emit-jvm wrote no class`);
    return;
  }
  classes += read.total;
  verified += read.verified;
  if (read.invalid.length + read.missing.length > 0) failed.push({ project, ...read });
}

const started = Date.now();
let next = 0;
await Promise.all(Array.from({ length: Math.min(WORKERS, projects.length) }, async (_, slot) => {
  while (next < projects.length) await check(projects[next++], slot);
}));

const fresh = failed.filter((f) => !known.has(f.project));
const held = failed.filter((f) => known.has(f.project));
const expired = [...known.keys()].filter((p) => projects.includes(p) && !failed.some((f) => f.project === p) && !unmeasured.some((u) => u.startsWith(`${p}:`)));
console.log(`  compiler ${SOURCE} -- ${describe(provenanceOf(SOURCE))}`);
console.log(`  ${verified} of ${classes} class(es) verify across ${projects.length - unmeasured.length} of ${projects.length} project(s), in ${Math.round((Date.now() - started) / 1000)} s`);
for (const f of fresh) {
  console.log(`  DOES NOT VERIFY  ${f.project}: ${f.invalid.length} invalid, ${f.missing.length} missing`);
  for (const l of [...f.invalid, ...f.missing].slice(0, 6)) console.log(`                   ${l.slice(0, 220)}`);
  if (f.invalid.length + f.missing.length > 6) console.log(`                   ... ${f.invalid.length + f.missing.length - 6} more`);
}
for (const f of held) console.log(`  known            ${f.project}: ${f.invalid.length} invalid, ${f.missing.length} missing -- ${known.get(f.project)}`);
for (const p of expired) console.log(`  ^ ${p} verifies now: remove it from tooling/conformance/jvm-verifies.known`);
if (invalidHir.length > 0) console.log(`  invalid HIR, so nothing to verify (outcomes records it): ${invalidHir.length} -- ${invalidHir.map((p) => p.split("/").pop()).join(", ")}`);
for (const u of unmeasured.sort()) console.log(`  NOT MEASURED     ${u}`);
// Every NTS4009 is a dispatch C and LLVM perform without checking, so each
// shape must be classified: the JVM's alone by construction, live on C (with
// the fixture that shows it), or owned and not yet measured.
const unclassified = [...declines.keys()].filter((k) => !declinesKnown.has(k));
if (declines.size > 0) {
  const by = new Map();
  for (const k of declines.keys()) {
    const v = declinesKnown.get(k)?.verdict ?? "UNCLASSIFIED";
    by.set(v, (by.get(v) ?? 0) + 1);
  }
  console.log(`  NTS4009 declines: ${declines.size} shape(s) -- ${[...by].map(([v, n]) => `${n} ${v}`).join(", ")}`);
  for (const k of [...declines.keys()].filter((k) => declinesKnown.get(k)?.verdict === "live-on-c")) console.log(`    live on C  ${k.slice(0, 110)} -- ${declinesKnown.get(k).why}`);
  for (const k of unclassified) console.log(`    UNCLASSIFIED  ${k.slice(0, 150)}  (${[...declines.get(k)].slice(0, 3).join(", ")})`);
}
const ok = fresh.length === 0 && unmeasured.length === 0 && classes > 0 && unclassified.length === 0;
console.log(ok ? `  every module verifies, or is known not to (${held.length}); every NTS4009 decline classified` : `  ${fresh.length} new failure(s), ${unmeasured.length} not measured, ${unclassified.length} unclassified decline shape(s)`);
process.exit(ok ? 0 : 1);
