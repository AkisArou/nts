// Which checker codes does valid test262 JavaScript draw once the checker
// type-checks it (`checkJs: true`)? The measurement that decides which of
// TypeScript's semantic codes nts may treat as an ECMAScript early error.
//
//   node tooling/census/semantic-codes.ts [--under test/language ...] [--jobs N]
//        [--sample N] [--out <json>]
//
// Default population: every in-lane file under language, built-ins, annexB,
// staging and harness, laid out exactly as the census lays it out (project.ts:
// stand-in, includes, the test, its fixtures), with one change: `checkJs:
// true`. tsgo then reports semantic errors on JavaScript as well as syntax.
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_FILE, materialise, workspace } from "./project.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SUITE = join(ROOT, "third_party/test262");
const TSGO = process.env.NTS_TSGO ?? join(ROOT, "target/tsgo");
const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const many = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
const unders = many("--under").length > 0 ? many("--under") : ["test/language", "test/built-ins", "test/annexB", "test/staging", "test/harness"];
const jobs = Number(flag("--jobs", String(Math.min(8, availableParallelism()))));
const sample = Number(flag("--sample", "0"));
const out = flag("--out", null);

/** The census's own population: planned records, through the protocol command conformance262 uses. */
function population(under) {
  return execFileSync("cargo", ["run", "-q", "-p", "nts-suite", "--no-default-features", "--bin", "nts-test262-protocol", "--", "select", SUITE, under], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((r) => r.schedule === "planned");
}

/** `file(line,col): error TSnnnn: ...` lines, as [file, code], the stand-in's left out. */
export function codesOf(printed) {
  const found = [];
  for (const line of printed.split("\n")) {
    const m = /^(.*?)\(\d+,\d+\): error (TS\d+):/.exec(line);
    if (m && !m[1].endsWith(HARNESS_FILE)) found.push(m[2]);
  }
  return [...new Set(found)];
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
    const child = spawn(TSGO, ["-p", join(dir, "tsconfig.json"), "--noEmit", "--pretty", "false"], { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ path: record.path, negative: record.negative ? record.negative.phase : null, codes: codesOf(text) });
    });
  });
}

// **Seen to read before it is trusted**: the line shape tsgo prints, and the stand-in left out.
function selfTest() {
  const printed = [
    "src/main.js(18,3): error TS1116: A 'break' statement can only jump to a label of an enclosing statement.",
    "src/harness.ts(4,1): error TS2322: Type 'x' is not assignable.",
    "src/include-compareArray.js(9,9): error TS2300: Duplicate identifier 'a'.",
    "src/main.js(20,3): error TS1116: again.",
  ].join("\n");
  const codes = codesOf(printed).sort().join();
  return codes === "TS1116,TS2300" ? null : `codesOf read ${codes}`;
}

const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: tsgo's diagnostic lines read, the stand-in's left out, one code per file");
  process.exit(0);
}

let records = unders.flatMap(population);
if (sample > 0) records = records.filter((_, i) => i % Math.max(1, Math.floor(records.length / sample)) === 0).slice(0, sample);
const base = join(homedir(), ".cache/nts-semantic-codes");
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(join(base, "run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

const results = [];
let next = 0;
const started = Date.now();
await Promise.all(
  Array.from({ length: jobs }, async (_, slot) => {
    const dir = join(scratch, `w${slot}`);
    mkdirSync(dir, { recursive: true });
    while (next < records.length) {
      const record = records[next++];
      results.push(await measure(dir, record));
    }
  }),
);

const table = new Map();
for (const r of results) {
  if (r.unread) continue;
  for (const code of r.codes) {
    const e = table.get(code) ?? { positives: 0, negatives: 0, positiveExample: null, negativeExample: null };
    if (r.negative) {
      e.negatives += 1;
      e.negativeExample ??= r.path;
    } else {
      e.positives += 1;
      e.positiveExample ??= r.path;
    }
    table.set(code, e);
  }
}
const positives = results.filter((r) => !r.unread && !r.negative).length;
const negatives = results.filter((r) => !r.unread && r.negative).length;
const unread = results.filter((r) => r.unread).length;
console.log(`  ${results.length} file(s) under ${unders.join(", ")} in ${Math.round((Date.now() - started) / 1000)} s: ${positives} positive, ${negatives} negative, ${unread} unread; tsgo ${TSGO}, checkJs true`);
console.log("  code      positives  negatives  allowlistable  example");
const rows = [...table].sort((a, b) => b[1].negatives - a[1].negatives || a[0].localeCompare(b[0]));
for (const [code, e] of rows) {
  const ok = e.positives === 0 && e.negatives > 0;
  console.log(`  ${code.padEnd(9)} ${String(e.positives).padStart(9)}  ${String(e.negatives).padStart(9)}  ${(ok ? "yes" : "no").padStart(13)}  ${ok ? e.negativeExample : e.positiveExample ?? e.negativeExample}`);
}
if (out) writeFileSync(out, `${JSON.stringify({ unders, positives, negatives, unread, tsgo: TSGO, codes: Object.fromEntries(rows) }, null, 2)}\n`);
