// Node's own test suite, run against our implementation of a node module.
//
// # Why node's tests and not ours
//
// A suite we write tests what we thought of. Node's tests what its maintainers
// thought of, including every case that was a bug once and has a regression
// test now. The difference is not theoretical: a hand-written differential
// harness reported 5,457 cases agreeing while `basename(p, suffix)` was missing
// entirely, because it never occurred to its author to pass a second argument.
//
// # What is under test
//
//   --addon <path.node>   the compiled artifact -- our TypeScript through nts,
//                         our C through clang, linked. This is the gate.
//   (default)             the TypeScript on node, with the module's own
//                         `bindings.node.mjs` standing in for its native half.
//                         Real, and the only gate available before a module
//                         compiles; not the one that decides shipping.
//
// # How a test reaches our code
//
// By substitution, not by patching. The test's `require` is intercepted and
// handed our module; node's own `node:path` is untouched and still works in the
// same process. Each file runs in its own process, as node's harness does.
//
// Usage:
//   node run.mjs --module path [--addon target/node/path.node] [--only f.js]
//                              [--verbose] [--json]

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = resolvePath(HERE, "../..");
const SUITE = join(ROOT, "third_party/node/test/parallel");

const argv = process.argv;
const arg = (name, fallback = null) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};

const moduleName = arg("--module");
const addon = arg("--addon");
const only = arg("--only");
const verbose = argv.includes("--verbose");
const asJson = argv.includes("--json");

if (!moduleName) {
  console.error("usage: run.mjs --module <name> [--addon <path.node>] [--only <file>] [--verbose] [--json]");
  process.exit(2);
}
if (!existsSync(SUITE)) {
  console.error(`no node checkout at ${SUITE}; see the clone command in .gitignore`);
  process.exit(0);
}

// Some of node's tests spawn `process.execPath` and assert on what the child
// prints. The child is real node running real node modules, so the assertion
// is about node's binary and not about ours -- there is no way to inject our
// module into a process we did not start.
//
// Those are listed per module in `not-applicable`, one `file: reason` per line.
// Listed rather than detected on purpose: a rule like "skip anything that
// requires child_process" would quietly drop tests that only use it for part
// of their work, and a conformance number nobody can audit is not worth
// reporting. Every exclusion here is a claim someone can check.
function readList(path) {
  if (!existsSync(path)) return new Map();
  return new Map(
    readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const at = l.indexOf(":");
        return at === -1 ? [l, "not applicable"] : [l.slice(0, at).trim(), l.slice(at + 1).trim()];
      }),
  );
}

const notApplicable = readList(join(ROOT, "runtime/node", moduleName, "not-applicable"));

// A module's tests are `test-<module>.js` and `test-<module>-*.js`. Node also
// files some under other names; those are found by hand and listed in the
// module's `extra-tests` file when they exist.
const extraPath = join(ROOT, "runtime/node", moduleName, "extra-tests");
const extra = [...readList(extraPath).keys()];

// `test-<module>.js` and `test-<module>-*.js` by default. Node does not name
// them all that way -- `events` has thirty-odd `test-event-emitter-*.js` -- so a
// module may say which files are its own in a `test-pattern` file holding one
// regular expression.
const patternPath = join(ROOT, "runtime/node", moduleName, "test-pattern");
const pattern = existsSync(patternPath)
  ? new RegExp(readFileSync(patternPath, "utf8").trim())
  : new RegExp(`^test-${moduleName}(-.*)?\\.js$`);

const files = [
  ...readdirSync(SUITE).filter((f) => pattern.test(f)),
  ...extra,
]
  .filter((f, i, all) => all.indexOf(f) === i)
  .filter((f) => !only || f === only)
  .sort();

/**
 * The `node` flags a test asks for in its `// Flags:` line.
 *
 * Node's own harness reads that line and passes the flags to the child; a test
 * that says `--expose-gc` and does not get it fails on `global.gc is not a
 * function`, which is a statement about how it was run rather than about the
 * module. Only the flags that are ours to give are passed on: `--expose-gc`
 * and `--no-warnings` change node's behaviour, while `--expose-internals`
 * exposes node's *own* internals, which we substitute for by hand and would
 * otherwise let a test reach node's implementation instead of ours.
 */
const PASSED_THROUGH_FLAGS = new Set([
  "--expose-gc",
  "--no-warnings",
  "--pending-deprecation",
  "--allow-natives-syntax",
]);

function nodeFlags(path) {
  const first = readFileSync(path, "utf8").split("\n", 20).find((l) => l.startsWith("// Flags:"));
  if (!first) return [];
  return first.slice("// Flags:".length).trim().split(/\s+/).filter((f) => PASSED_THROUGH_FLAGS.has(f));
}

const rows = [];
for (const name of files) {
  let result;
  if (notApplicable.has(name)) {
    rows.push({ name, kind: "n/a", why: notApplicable.get(name) });
    continue;
  }
  try {
    const out = execFileSync(
      process.execPath,
      [...nodeFlags(join(SUITE, name)), join(HERE, "run-one.mjs"), moduleName, join(SUITE, name), addon ?? "-"],
      { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
    result = line ? JSON.parse(line) : { kind: "fail", why: "no result from the child" };
  } catch (e) {
    // A non-zero exit *after* a result was reported means an exit handler
    // threw. Many of node's tests do their real assertion in
    // `process.on('exit')`, so this is a failure the child could not know
    // about when it printed.
    const printed = (e.stdout ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
    if (printed) {
      const reported = JSON.parse(printed);
      const why = (e.stderr ?? "").split("\n").find((l) => l.includes("Error") || l.includes("Assertion"));
      rows.push(
        reported.kind === "pass"
          ? { name, kind: "fail", why: (why ?? "an exit handler failed").trim().slice(0, 110), detail: e.stderr }
          : { name, ...reported },
      );
      continue;
    }
    // A child that died rather than reported: a crash, a timeout, or a
    // `process.exit` inside the test. All are failures, and saying which
    // matters more than the exit code.
    const why = e.killed ? "timed out" : (e.stderr || e.message || "").split("\n").find((l) => l.trim()) ?? "child died";
    result = { kind: "fail", why: why.trim().slice(0, 120) };
  }
  rows.push({ name, ...result });
}

const tally = { pass: 0, fail: 0, skip: 0, "n/a": 0 };
for (const r of rows) tally[r.kind]++;

if (asJson) {
  console.log(JSON.stringify({ module: moduleName, addon: addon ?? null, rows, tally }, null, 2));
} else {
  const label = addon ? addon.replace(`${ROOT}/`, "") : "TypeScript on node";
  console.log(`node:${moduleName} against node's own tests — ${label}\n`);
  for (const row of rows) {
    const mark = { pass: "pass", fail: "FAIL", skip: "skip", "n/a": " n/a" }[row.kind];
    console.log(`  ${mark}  ${row.name}${row.why ? `\n          ${row.why}` : ""}`);
    if (verbose && row.detail) {
      console.log(row.detail.split("\n").map((l) => `        ${l}`).join("\n"));
    }
  }
  console.log(
    `\n  ${files.length} file(s): ${tally.pass} passed, ${tally.fail} failed, ` +
      `${tally.skip} skipped, ${tally["n/a"]} not applicable`,
  );
}
process.exitCode = tally.fail > 0 ? 1 : 0;
