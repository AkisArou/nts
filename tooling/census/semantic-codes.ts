// Which checker codes does valid test262 JavaScript draw once the checker
// type-checks it (`checkJs: true`)? The measurement that decides which of
// TypeScript's semantic codes nts may treat as an ECMAScript early error.
//
//   node tooling/census/semantic-codes.ts [--under test/language ...] [--jobs N]
//        [--sample N] [--out <json>]
// Build the raw SDK instrument first:
//   cargo build --release -p nts-frontend-tsrs --example diagnostics
// NTS_CHECKER_DIAGNOSTICS selects another build of that instrument.
// A measured run requires a sealed copy with clean provenance.json beside it.
//
// Default population: every in-lane file under language, built-ins, annexB,
// staging and harness, laid out exactly as the census lays it out (project.ts:
// stand-in, includes, the test, its fixtures), with one change: `checkJs:
// true`. The native checker then reports semantic errors on JavaScript as well as syntax.
//
// # Why
//
// With `checkJs` unset the checker reports only syntax and grammar on a .js
// file, so a module-goal early error that TypeScript diagnoses semantically
// (a duplicate export, TS2300) never reaches a diagnostic, and 88 negatives
// are accepted. The compiler lane's fix asks the frontend for semantic
// diagnostics and rejects a program on an allowlist of codes. Rejecting valid
// JavaScript is a regression, so a code is allowlistable only if **no positive
// draws it** -- measured here, over the whole population, the way
// test262-evidence-codes.json measures the syntax codes. A code positives
// draw is printed with an example, so the reason it is excluded is readable.
//
// Diagnostics in the stand-in (`src/harness.ts`, TypeScript of ours) are not
// the test's and are left out; an include (`src/include-*`, test262's own
// JavaScript) and a fixture count as the test's program.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { flagsOf, HARNESS_FILE, materialise, workspace } from "./project.ts";
import { Admission } from "../gate/admission.ts";
import { provenanceOf } from "../conformance/pin.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SUITE = join(ROOT, "third_party/test262");
const CHECKER = process.env.NTS_CHECKER_DIAGNOSTICS ?? join(ROOT, "target/release/examples/diagnostics");
const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const many = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
const unders = many("--under").length > 0 ? many("--under") : ["test/language", "test/built-ins", "test/annexB", "test/staging", "test/harness"];
const jobs = Number(flag("--jobs", String(Math.min(8, availableParallelism()))));
const sample = Number(flag("--sample", "0"));
const out = flag("--out", null);
let instrument, expectedChecker;

/** The census's own population: planned records, through the protocol command conformance262 uses. */
function population(under) {
  const protocol = process.env.NTS_TEST262_PROTOCOL;
  return execFileSync(protocol ?? "cargo", protocol ? ["select", SUITE, under] : ["run", "-q", "-p", "nts-suite", "--no-default-features", "--bin", "nts-test262-protocol", "--", "select", SUITE, under], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((r) => r.schedule === "planned");
}

/** Raw checker errors, with the synthetic host left out; messages are display only. */
export function codesOf(diagnostics) {
  return [...new Set(diagnostics
    .filter((value) => value.category === "error" && !value.path?.endsWith(HARNESS_FILE))
    .map((value) => `TS${value.code}`))];
}

/** A diagnostic rejection completed capture; a crash or loading failure did not. */
function measured(status, signal) {
  return !signal && (status === 0 || status === 2);
}

/** A complete owned diagnostic vector from exactly the checker being audited. */
function responseOf(stdout, status, expected) {
  const result = JSON.parse(stdout);
  if (result.status !== "completed" || !Array.isArray(result.diagnostics)) throw new Error("incomplete diagnostics response");
  if (result.checker_count !== 1 || !Array.isArray(result.files) || !result.files.length || !result.files.every((file) => typeof file === "string")) throw new Error("invalid diagnostic scope response");
  if (result.checker?.tsrs_commit !== expected.tsrs_commit || result.checker?.typescript_commit !== expected.typescript_commit) throw new Error("diagnostics response has a mismatched checker identity");
  if (JSON.stringify(result.checker?.patches ?? []) !== JSON.stringify(expected.patches ?? [])) throw new Error("diagnostics response has mismatched carried checker patches");
  const categories = new Set(["error", "warning", "suggestion", "message"]);
  const valid = (value) => value && (value.path === null || typeof value.path === "string")
    && (value.span === null || (Array.isArray(value.span) && value.span.length === 2 && value.span.every((n) => Number.isSafeInteger(n) && n >= 0)))
    && categories.has(value.category) && Number.isSafeInteger(value.code) && typeof value.message === "string"
    && Array.isArray(value.chain) && value.chain.every(valid) && Array.isArray(value.related) && value.related.every(valid);
  if (!result.diagnostics.every(valid)) throw new Error("malformed owned diagnostic vector");
  if (status !== (result.diagnostics.some((value) => value.category === "error") ? 2 : 0)) throw new Error("diagnostics status and exit code disagree");
  return result;
}

/** One case: laid out, checked with checkJs, its codes. */
function measure(dir, record) {
  return new Promise((resolve) => {
    const file = join(SUITE, record.path);
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      return resolve({ path: record.path, unread: true });
    }
    workspace(dir);
    materialise(dir, body, file);
    const config = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8"));
    config.compilerOptions.checkJs = true;
    writeFileSync(join(dir, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
    const child = spawn(instrument.binary, [join(dir, "tsconfig.json"), "--checkers", "1"], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ path: record.path, failed: error.message });
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (!measured(status, signal)) return resolve({ path: record.path, failed: signal ?? `exit ${status}`, output: (stdout + stderr).slice(-2000) });
      let result;
      try {
        result = responseOf(stdout, status, expectedChecker);
        if (!result.files.includes(join(dir, "src/main.js"))) throw new Error("the test file was absent from the diagnostic scope");
      } catch (error) {
        return resolve({ path: record.path, failed: String(error), output: (stdout + stderr).slice(-2000) });
      }
      resolve({ path: record.path, negative: record.negative ? record.negative.phase : null, module: flagsOf(body).includes("module"), codes: codesOf(result.diagnostics) });
    });
  });
}

// Raw category/code identity, stand-in exclusion and duplicate-code guard.
function selfTest() {
  const diagnostics = [
    {category: "error", code: 1116, path: "src/main.js", message: "arbitrary display wording"},
    {category: "error", code: 2322, path: "src/harness.ts"},
    {category: "error", code: 2300, path: "src/include-compareArray.js"},
    {category: "error", code: 1116, path: "src/main.js"},
    {category: "message", code: 1450, path: "src/main.js"},
  ];
  const codes = codesOf(diagnostics).sort().join();
  if (codes !== "TS1116,TS2300") return `codesOf read ${codes}`;
  if (!measured(0, null) || !measured(2, null)) return "a completed capture was lost";
  for (const [status, signal] of [[1, null], [101, null], [null, "SIGABRT"], [2, "SIGKILL"]]) {
    if (measured(status, signal)) return "an incomplete capture was counted";
  }
  const expected = {tsrs_commit: "a".repeat(40), typescript_commit: "b".repeat(40)};
  const clean = {status: "completed", checker: expected, checker_count: 1, files: ["src/main.js"], diagnostics: []};
  responseOf(JSON.stringify(clean), 0, expected);
  const wrong = { ...expected, typescript_commit: "c".repeat(40) };
  const patched = { ...expected, patches: [{id: "yield-recovery", sha256: "d".repeat(64)}] };
  let patchRejected = false;
  try { responseOf(JSON.stringify(clean), 0, patched); } catch { patchRejected = true; }
  if (!patchRejected) return "an unpatched diagnostic instrument answered a patched audit";
  responseOf(JSON.stringify({...clean, checker: patched}), 0, patched);
  for (const [result, status] of [[{ ...clean, checker: wrong }, 0], [{ ...clean, checker: null }, 0], [{ ...clean, checker_count: 4 }, 0], [{ ...clean, files: [] }, 0], [{ ...clean, status: "failed" }, 0], [{ ...clean, diagnostics: [{}] }, 0], [clean, 2]]) {
    let rejected = false;
    try { responseOf(JSON.stringify(result), status, expected); } catch { rejected = true; }
    if (!rejected) return "an untrusted diagnostic response was counted";
  }
  return null;
}

const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: raw checker codes read, the stand-in's left out, one code per file");
  process.exit(0);
}

let records = unders.flatMap(population);
if (sample > 0) records = records.filter((_, i) => i % Math.max(1, Math.floor(records.length / sample)) === 0).slice(0, sample);
const base = join(homedir(), ".cache/nts-semantic-codes");
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(join(base, "run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

// Seal the executable before the first case. A rebuilt instrument halfway
// through the audit must not silently mix checker versions or source trees.
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const provenance = provenanceOf(CHECKER);
const binaryHash = hash(CHECKER);
if (!provenance?.clean || provenance.applied || provenance.binary_sha256 !== binaryHash) throw new Error("raw SDK diagnostics instrument needs verified clean build provenance beside it");
const sealed = join(scratch, "diagnostics");
copyFileSync(CHECKER, sealed);
chmodSync(sealed, 0o755);
if (hash(sealed) !== binaryHash) throw new Error("diagnostics instrument changed while sealing");
instrument = {binary: sealed, source: CHECKER, binary_sha256: binaryHash, provenance};
const upstream = JSON.parse(readFileSync(join(ROOT, "third_party/tsrs/UPSTREAM.json"), "utf8"));
expectedChecker = {tsrs_commit: upstream.commit, typescript_commit: upstream.typescript_commit};
if (!Object.values(expectedChecker).every((value) => /^[0-9a-f]{40}$/.test(value))) throw new Error("invalid vendored checker provenance");
expectedChecker.patches = (upstream.patches ?? []).map(({id, sha256}) => ({id, sha256}));

const results = [];
let next = 0;
const started = Date.now();
const admission = new Admission({ report: (message) => console.log(message) });
console.log(`  checking ${records.length} file(s) with ${jobs} worker(s)`);
await Promise.all(
  Array.from({ length: jobs }, async (_, slot) => {
    const dir = join(scratch, `w${slot}`);
    mkdirSync(dir, { recursive: true });
    while (next < records.length) {
      while (!admission.open()) await new Promise((done) => setTimeout(done, 1000));
      if (next >= records.length) break;
      const record = records[next++];
      results.push(await measure(dir, record));
      if (results.length % 500 === 0) console.log(`  ${results.length}/${records.length} measured`);
    }
  }),
);

const failed = results.filter((r) => r.failed || r.unread);
if (failed.length > 0) {
  if (out) writeFileSync(out, `${JSON.stringify({complete: false, unders, instrument, checker: expectedChecker, cases: results.sort((a, b) => a.path.localeCompare(b.path)), unmeasured: failed.length}, null, 2)}\n`);
  for (const row of failed) console.error(JSON.stringify(row));
  throw new Error(`${failed.length} cases were not measured; no code audit was produced`);
}

const table = new Map();
for (const r of results) {
  if (r.unread) continue;
  for (const code of r.codes) {
    const e = table.get(code) ?? { positives: 0, negatives: 0, modulePositives: 0, moduleNegatives: 0, positiveExample: null, negativeExample: null };
    if (r.negative) {
      e.negatives += 1;
      if (r.module) e.moduleNegatives += 1;
      e.negativeExample ??= r.path;
    } else {
      e.positives += 1;
      if (r.module) e.modulePositives += 1;
      e.positiveExample ??= r.path;
    }
    table.set(code, e);
  }
}
const positives = results.filter((r) => !r.unread && !r.negative).length;
const negatives = results.filter((r) => !r.unread && r.negative).length;
const unread = results.filter((r) => r.unread).length;
console.log(`  ${results.length} file(s) under ${unders.join(", ")} in ${Math.round((Date.now() - started) / 1000)} s: ${positives} positive, ${negatives} negative, ${unread} unread; raw checker ${CHECKER}, checkJs true`);
// **By goal as well as overall.** A code script positives draw can still be
// an early error in module code -- TS2300, a duplicate binding, is legal for
// a sloppy global redeclaration and an error for a duplicate export -- so a
// rule keyed on the goal can allow it where the overall column cannot.
console.log("  code      positives  negatives  allowlistable  (module: positives negatives allowlistable)  example");
const rows = [...table].sort((a, b) => b[1].negatives - a[1].negatives || a[0].localeCompare(b[0]));
for (const [code, e] of rows) {
  const ok = e.positives === 0 && e.negatives > 0;
  const moduleOk = e.modulePositives === 0 && e.moduleNegatives > 0;
  console.log(`  ${code.padEnd(9)} ${String(e.positives).padStart(9)}  ${String(e.negatives).padStart(9)}  ${(ok ? "yes" : "no").padStart(13)}  (module: ${String(e.modulePositives).padStart(5)} ${String(e.moduleNegatives).padStart(5)} ${(moduleOk ? "yes" : "no").padStart(4)})  ${ok ? e.negativeExample : e.positiveExample ?? e.negativeExample}`);
}
if (out) writeFileSync(out, `${JSON.stringify({complete: true, unders, positives, negatives, unread, instrument, checker: expectedChecker, codes: Object.fromEntries(rows), cases: results.sort((a, b) => a.path.localeCompare(b.path))}, null, 2)}\n`);
