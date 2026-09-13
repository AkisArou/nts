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

import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = resolvePath(HERE, "../..");
const NODE_ROOT = join(ROOT, "third_party/node");
const PARALLEL_SUITE = join(NODE_ROOT, "test/parallel");


// **A variable that quiets the output is part of the subject.**
//
// `NODE_NO_WARNINGS=1`, set to keep the punycode deprecation line out of a log,
// suppresses the warnings node's own tests assert on:
//
//     test-url-parse-invalid-input.js   assert.match(stderr, /\[DEP0170\] DeprecationWarning:/)
//     test-http-debug.js                the NODE_DEBUG warning in a child's stderr
//
// Both fail with it set and pass without. On 2026-09-09 that produced two
// failures in a lane whose headline was "nothing failing", and the failures
// survived three runs on an idle machine and a bisect into a pinned worktree at
// two earlier commits -- because the variable came along each time. A ledger
// entry was corrected on the strength of it before the cause was found. **A
// contaminant present in both arms is not controlled by comparing them.**
//
// So a run refuses rather than warns: a warning in a 2,300-line log is exactly
// what gets missed. `NTS_ALLOW_OUTPUT_ENV=1` overrides, which makes carrying one
// in a deliberate act rather than an inherited default.
// Two lists, because refusing on everything refuses on everything. This box
// exports `NODE_OPTIONS=--max-old-space-size=8192 --disable-warning=ExperimentalWarning`
// as a standing setting, and it was present for the 1,859 baseline -- a guard
// blocking it would block every run in the profile's history, which is a worse
// answer than the problem.
//
// So: refuse the two that demonstrably suppress what a test reads, and *print*
// the rest, so a log records the environment it was taken in and a later reader
// can tell one run from another.
const REFUSE = ["NODE_NO_WARNINGS", "NODE_DEBUG"];
const REPORT = ["NODE_OPTIONS", "NO_COLOR", "FORCE_COLOR"];
if (process.env.NTS_ALLOW_OUTPUT_ENV === undefined) {
  const carried = REFUSE.filter((name) => process.env[name] !== undefined);
  if (carried.length > 0) {
    console.error(`refusing to run: ${carried.join(", ")} changes what the tests read.`);
    console.error("Node's own tests assert on warnings and on stderr. Filter the log after");
    console.error("the run instead, where the filtering is visible in the command, or set");
    console.error("NTS_ALLOW_OUTPUT_ENV=1 if you mean it.");
    process.exit(2);
  }
}
for (const name of REPORT) {
  if (process.env[name] !== undefined) {
    console.log(`  inherited ${name}=${process.env[name]}`);
  }
}
const argv = process.argv;
const arg = (name, fallback = null) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};

const moduleName = arg("--module");
/**
 * Resolved here rather than in the child, because the child runs with `cwd`
 * set to node's checkout so that upstream tests resolving `./test/...` find
 * it. A relative `--addon` therefore resolved against `third_party/node`
 * rather than against the directory the user typed it in, and reported
 * `Cannot find module` naming a path nobody had asked for.
 */
const addonArg = arg("--addon");
const addon = addonArg === null ? null : resolvePath(addonArg);
const only = arg("--only");
const verbose = argv.includes("--verbose");
/**
 * Hand every test an empty module instead of ours.
 *
 * A pass count nobody has tried to make fail is not a measurement. Whatever
 * still passes under this was never measuring us: it reached for node's own
 * implementation through a global, or asserted something true of any module at
 * all. `node:buffer` read 51 of 60 until this was run and 15 afterwards --
 * node's tests use the global `Buffer`, which was node's own.
 */
const sabotage = argv.includes("--sabotage");
/**
 * Run the shim against an addon that published nothing, and let the shim run.
 *
 * `--sabotage` hands the test `{}` and skips the shim entirely. This hands the
 * *shim* `{}` and keeps it, so every absent-export guard fires and every name
 * they guard is `undefined`. A file that still passes is passing on two absent
 * values agreeing, which is the one comparison neither sabotage nor
 * `--mutate-addon` can express.
 */
const emptyExports = argv.includes("--empty-exports");
/**
 * Keep the compiled addon's exported names and destroy their behaviour.
 *
 * `--sabotage` blanks the module, which asks whether the suite is connected to
 * its subject at all. This asks the harder question -- whether a file that
 * passes depends on what the module *does* -- and it exists because the
 * compiled lane produced a pass that survived sabotage and measured nothing.
 */
const mutateAddon = argv.includes("--mutate-addon");
/** The silent poison: answer `undefined` rather than throwing. See `poisonedBody`. */
const mutateSilent = argv.includes("--mutate-silent");
const asJson = argv.includes("--json");
const RESULT_PREFIX = "NTS_CONFORMANCE_RESULT ";

if (!moduleName) {
  console.error(
    "usage: run.mjs --module <name> [--addon <path.node>] [--only <file>] " +
      "[--verbose] [--json] [--sabotage]",
  );
  process.exit(2);
}
if (!existsSync(PARALLEL_SUITE)) {
  console.error(`no node checkout at ${PARALLEL_SUITE}; see the clone command in .gitignore`);
  process.exit(2);
}

// Some of node's tests spawn `process.execPath` and assert on what the child
// prints. `run-one.mjs` routes structurally identifiable same-suite and
// declared fixture programs back through itself so those children retain the
// substituted subject. What remains here is a deliberate exception: a child
// that cannot be routed without interpreting arbitrary program text, or a
// test of Node's executable rather than of the selected module.
//
// Exceptions are listed per module in `not-applicable`, one `file: reason` per
// line. Listed rather than detected on purpose: a rule like "skip anything
// that requires child_process" would quietly drop tests that only use it for
// part of their work, and a conformance number nobody can audit is not worth
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

function printedSkipReason(output) {
  const prefix = "1..0 # Skipped:";
  for (const line of output.split("\n")) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return undefined;
}

const notApplicable = readList(join(ROOT, "runtime/node", moduleName, "not-applicable"));
const moduleDir = join(ROOT, "runtime/node", moduleName);

// A name that does not exist is an error, not an empty run.
//
// Without this, `--module notamodule` answered `0 file(s): 0 passed, 0 failed`
// -- which reads as "nothing to do" rather than "you asked for something that
// is not there". In a loop over module names a typo contributes a clean 0/0 and
// the total looks the same as if it had been covered.
//
// The same shape as a nine-module floor printing "11 newly building", and as a
// differential counting an absent export as agreement: an instrument answering
// a question about something that is not there, in the vocabulary it uses for
// success.
if (!existsSync(moduleDir)) {
  console.error(
    `no module at runtime/node/${moduleName}. ` +
      `An empty run would report 0 passed and 0 failed, which is not the same answer.`,
  );
  process.exit(2);
}

// A module's tests are `test-<module>.js` and `test-<module>-*.js`. Node also
// files some under other names; those are found by hand and listed in the
// module's `extra-tests` file when they exist.
const extraPath = join(moduleDir, "extra-tests");
const extra = [...readList(extraPath).keys()];

// `test-<module>.js` and `test-<module>-*.js` by default. Node does not name
// them all that way -- `events` has thirty-odd `test-event-emitter-*.js` -- so a
// module may say which files are its own in a `test-pattern` file holding one
// regular expression.
const patternPath = join(moduleDir, "test-pattern");
const pattern = existsSync(patternPath)
  ? new RegExp(readFileSync(patternPath, "utf8").trim())
  : new RegExp(`^test-${moduleName}(-.*)?\\.m?js$`);

const upstream = [
  ...readdirSync(PARALLEL_SUITE)
    .filter((fileName) => pattern.test(fileName))
    .map((fileName) => ({ name: fileName, path: join(PARALLEL_SUITE, fileName) })),
  ...extra.map((fileName) => ({ name: fileName, path: join(PARALLEL_SUITE, fileName) })),
];

// Some Node subsystems have a dedicated suite in addition to `test/parallel`.
// A module opts in through `test-suites`, one path below `third_party/node/test`
// per line. A path can name a suite directory (every `test-*.js` in it) or one
// exact test file when a shared suite contains tests for many subsystems. Names
// retain the directory prefix so duplicate basenames remain auditable.
const additionalSuitesPath = join(moduleDir, "test-suites");
if (existsSync(additionalSuitesPath)) {
  for (const suiteName of readFileSync(additionalSuitesPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))) {
    const suite = join(ROOT, "third_party/node/test", suiteName);
    if (!existsSync(suite)) {
      console.error(`no configured Node test suite at ${suite}`);
      process.exit(2);
    }
    if (suiteName.endsWith(".js") || suiteName.endsWith(".mjs")) {
      upstream.push({ name: suiteName, path: suite });
      continue;
    }
    for (const fileName of readdirSync(suite)) {
      if (!/^test-.*\.(?:js|mjs)$/.test(fileName)) continue;
      upstream.push({ name: `${suiteName}/${fileName}`, path: join(suite, fileName) });
    }
  }
}

upstream.sort((left, right) => left.name.localeCompare(right.name));

// A Node file can mix a permanently excluded §13 operation with otherwise
// supported behavior. Excluding the whole file would hide the latter. A
// module may keep focused CommonJS tests under `test/`; their names are
// deliberately prefixed in the report so they cannot be mistaken for
// upstream files. Each such test must name its upstream source in a comment.
const localDir = join(moduleDir, "test");
const local = existsSync(localDir)
  ? readdirSync(localDir)
      .filter((f) => f.endsWith(".js"))
      .sort()
  : [];

const allTests = [
  ...upstream.filter(
    (test, index, all) => all.findIndex((candidate) => candidate.name === test.name) === index,
  ),
  ...local.map((fileName) => ({ name: `local/${fileName}`, path: join(localDir, fileName) })),
];

let tests = allTests;
if (only !== null) {
  const exact = allTests.filter((test) => test.name === only);
  if (exact.length > 0) {
    tests = exact;
  } else {
    const byBasename = allTests.filter((test) => test.name.split("/").pop() === only);
    if (byBasename.length > 1) {
      console.error(
        `ambiguous --only ${only}; use one of: ${byBasename.map((test) => test.name).join(", ")}`,
      );
      process.exit(2);
    }
    tests = byBasename;
  }
}
if (only !== null && tests.length === 0) {
  console.error(`no test named ${only} for module ${moduleName}`);
  process.exit(2);
}

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
  "--experimental-stream-iter",
  "--expose-externalize-string",
  "--allow-natives-syntax",
  "--test-udp-no-try-send",
  "--no-network-family-autoselection",
]);

function nodeFlags(path) {
  // Node's standard licence header already occupies more than twenty lines;
  // flagged tests commonly place metadata immediately after it.
  const first = readFileSync(path, "utf8")
    .split("\n", 64)
    .find((l) => l.startsWith("// Flags:"));
  if (!first) return [];
  return (
    first
      .slice("// Flags:".length)
      .trim()
      .split(/\s+/)
      // V8's flags take either spelling and node's own harness passes the line
      // through untouched, so `--expose_gc` and `--expose-gc` are one flag.
      // Matching only the hyphen spelling silently dropped it for four files,
      // which then failed on `globalThis.gc is not a function` -- a statement
      // about how they were run, not about the module.
      .map((f) => f.replaceAll("_", "-"))
      .filter(
        (f) =>
          PASSED_THROUGH_FLAGS.has(f) ||
          f.startsWith("--title=") ||
          f.startsWith("--network-family-autoselection-attempt-timeout="),
      )
  );
}

// **node's test tree needs a `package.json` saying `commonjs`, and has none.**
//
// This repository's own `package.json` declares `"type": "module"`, and node's
// checkout has no top-level `package.json` at all. So the nearest one above
// `third_party/node/test/parallel/*.js` is ours, and node reads every one of those
// files as an ES module. In-process tests never notice, because the runner loads
// them itself. A test that **spawns a child** running a `.js` test file does: the
// child gets `require is not defined in ES module scope`, or fails on a top-level
// `return`, and reports empty output with a non-zero status.
//
// Written here rather than left in the tree because `third_party/node` is untracked
// and a `git clean` there would take it. Creating it is idempotent and costs a
// `stat`.
//
// **This block and the pty one below were deleted by f83be20a**, whose message
// describes only adding stderr to framed failures. The file it writes happened to
// already exist on disk, so nothing failed and nothing said anything -- a mechanism
// whose only remaining guarantee was that nobody had run `git clean` yet.
const nodePackageJson = join(ROOT, "third_party/node/package.json");
if (!existsSync(nodePackageJson)) {
  try {
    writeFileSync(nodePackageJson, '{ "type": "commonjs" }\n');
  } catch (error) {
    // A read-only or absent checkout is not this runner's problem to solve, but it
    // says so rather than passing silently. The first version of this block
    // swallowed a `ReferenceError` -- `writeFileSync` was never imported -- and the
    // runner reported a green lane while creating nothing.
    process.stderr.write(`note: could not write ${nodePackageJson}: ${error.message}\n`);
  }
}

// **Tests that need their stdio to be a terminal.** A module names them one per line
// in `needs-pty`, and they run under `script(1)`, which allocates a pseudo-terminal
// and gives the child fds 0, 1 and 2 on it.
//
// This exists because `pseudo-tty/test-tty-isatty.js` asserts `isatty(0)`,
// `isatty(1)` and `isatty(2)` are **true**. The runner gives its children pipes, so a
// correct `tty` fails that file -- measured, on both lanes: under `script` the same
// sources and the same artifact pass, and without it both report "stdin reported to
// not be a tty, but it is". The row was reading as a defect in `tty`.
//
// Inert without the file: no module that lacks one changes behaviour, and only the
// named tests take the wrapped path. `script` is util-linux and is not everywhere, so
// its absence is a **skip with a reason** rather than a failure -- a missing harness
// tool is not the profile's defect.
// **Reap what a previous run orphaned, before starting another one.** A test that is
// waiting rather than failing does not stop when the runner gives up on it:
// `execFileSync`'s timeout signals the direct child, and everything that child had
// spawned is reparented to init and keeps its memory. Idle, so no core burns and nothing
// draws attention. 459 of them were found on 2026-09-13, about 25 hours old, holding 34 GB
// of resident memory; clearing them returned available memory to 21 GB and dropped load
// from 7.65 to 3.00.
//
// `NTS_CONFORMANCE_TIMEOUT_MS` above reduces how many get made. This reduces how long the
// ones already made survive, and the two are different problems -- at PPID 1 an orphan
// outlives every session that could have reaped it.
//
// Selecting on PPID 1 is the whole of the safety argument: three sessions run these same
// files concurrently, so a name match would kill a peer's live test, while a live runner's
// children always have a live parent. Failure to reap is never failure to run.
try {
  const reaped = execFileSync("bash", [join(HERE, "reap-orphans.sh")], { encoding: "utf8" });
  if (!reaped.startsWith("no orphaned")) process.stderr.write(reaped);
} catch (error) {
  process.stderr.write(`note: could not reap orphans: ${error.message}\n`);
}

const needsPtyPath = join(moduleDir, "needs-pty");
const needsPty = new Set(
  existsSync(needsPtyPath)
    ? readFileSync(needsPtyPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
    : [],
);
let ptyAvailable = null;
const haveScript = () => {
  if (ptyAvailable === null) {
    try {
      execFileSync("script", ["--version"], { stdio: "ignore" });
      ptyAvailable = true;
    } catch {
      ptyAvailable = false;
    }
  }
  return ptyAvailable;
};

const rows = [];
for (const test of tests) {
  const { name } = test;
  let result;
  const shortName = name.split("/").pop();
  const notApplicableReason =
    notApplicable.get(name) ?? (shortName === undefined ? undefined : notApplicable.get(shortName));
  if (notApplicableReason !== undefined) {
    rows.push({ name, kind: "n/a", why: notApplicableReason });
    continue;
  }
  const wantsPty = needsPty.has(name) || (shortName !== undefined && needsPty.has(shortName));
  if (wantsPty && !haveScript()) {
    rows.push({ name, kind: "skip", why: "needs a pseudo-terminal and script(1) is not installed" });
    continue;
  }
  try {
    const argv = [...nodeFlags(test.path), join(HERE, "run-one.mjs"), moduleName, test.path, addon ?? "-"];
    // `script -qec <command> /dev/null`: quiet, no timing file, run the command under
    // a pty. The command is one string, so each argument is single-quoted; these are
    // absolute paths this file built, not user input.
    const quoted = [process.execPath, ...argv]
      .map((part) => `'${String(part).replaceAll("'", "'\\''")}'`)
      .join(" ");
    const out = execFileSync(
      ...(wantsPty
        ? ["script", ["-qec", quoted, "/dev/null"]]
        : [process.execPath, argv]),
      {
        encoding: "utf8",
        // **A per-test ceiling, overridable, because a control can need a cheap one.**
        // Breaking a handshake on purpose does not make its tests fail -- it makes them
        // *wait*, and 86 files at 60s each is 80 minutes for a number that is decided in
        // the first few seconds. Worse, each timeout leaks its driver: 26 `run-one.mjs`
        // processes were alive at once, with the forked workers behind them.
        //
        // A shortened ceiling is only sound if it is not itself the variable, so the
        // intact arm must be re-run at the same value and reproduce its own count before
        // the broken arm's count means anything.
        timeout: Number(process.env.NTS_CONFORMANCE_TIMEOUT_MS ?? 60_000),
        stdio: ["ignore", "pipe", "pipe"],
        // Node's own runner starts each test from the checkout root. A few
        // upstream tests intentionally resolve `./test/...`; launching them
        // from the NTS root turns those into unrelated ENOENT failures.
        cwd: NODE_ROOT,
        env: {
          ...process.env,
          NTS_CONFORMANCE_SABOTAGE: sabotage ? "1" : "",
          NTS_CONFORMANCE_EMPTY_EXPORTS: emptyExports ? "1" : "",
          NTS_CONFORMANCE_ADDON_MUTATE: mutateSilent ? "silent" : mutateAddon ? "1" : "",
        },
      },
    );
    const line = out
      // A pty ends its lines `\r\n`, so this is part of the `needs-pty` path
      // rather than tidiness -- it was deleted with the rest of it.
      .replaceAll("\r", "")
      .trim()
      .split("\n")
      .filter((candidate) => candidate.startsWith(RESULT_PREFIX))
      .pop();
    if (line) {
      result = JSON.parse(line.slice(RESULT_PREFIX.length));
    } else {
      const skipReason = printedSkipReason(out);
      result =
        skipReason === undefined
          ? { kind: "fail", why: "no result from the child" }
          : { kind: "skip", why: skipReason };
    }
  } catch (e) {
    // A non-zero exit *after* a result was reported means an exit handler
    // threw. Many of node's tests do their real assertion in
    // `process.on('exit')`, so this is a failure the child could not know
    // about when it printed.
    const printed = (e.stdout ?? "")
      .replaceAll("\r", "")
      .trim()
      .split("\n")
      .filter((candidate) => candidate.startsWith(RESULT_PREFIX))
      .pop();
    if (printed) {
      const reported = JSON.parse(printed.slice(RESULT_PREFIX.length));
      const escaped = (e.stderr ?? "")
        .split("\n")
        .find((l) => l.includes("Error") || l.includes("Assertion"));
      const why = escaped;
      rows.push(
        reported.kind === "pass"
          ? {
              name,
              kind: "fail",
              why: (why ?? "an exit handler failed").trim().slice(0, 110),
              detail: e.stderr,
            }
          // A framed failure is not always the cause, and this used to be the
          // only thing shown. A test can fail an assertion *inside a callback*
          // and thereby leave later callbacks unfired: the escaped exception goes
          // to node's default handler and lands in stderr, while the runner's exit
          // handler speaks only for the unfired callbacks, because it reports
          // pending `mustCall`s when nothing else has reported. The counts then
          // name neither the case nor the clause.
          //
          // test-child-process-exec-maxbuf is the case that paid for this: it
          // reports thirteen callbacks at 0/1 in under a second, and five separate
          // probes of it came back clean because none of them was its failing
          // case. Running `run-one.mjs` by hand printed the real error
          // immediately. So stderr is appended when it carries one and the framed
          // result does not mention it.
          //
          // This can only lengthen the detail of a row that is already failing --
          // no verdict depends on it.
          : {
              name,
              ...reported,
              detail:
                escaped === undefined || (reported.detail ?? "").includes(escaped.trim())
                  ? reported.detail
                  : `${reported.detail ?? ""}\n\n-- and on stderr, which the framed result does not mention --\n${e.stderr}`.trim(),
            },
      );
      continue;
    }
    // A child that died rather than reported: a crash, a timeout, or a
    // `process.exit` inside the test. All are failures, and saying which
    // matters more than the exit code.
    const why = e.killed
      ? "timed out"
      : ((e.stderr || e.message || "").split("\n").find((l) => l.trim()) ?? "child died");
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
      console.log(
        row.detail
          .split("\n")
          .map((l) => `        ${l}`)
          .join("\n"),
      );
    }
  }
  console.log(
    `\n  ${tests.length} file(s): ${tally.pass} passed, ${tally.fail} failed, ` +
      `${tally.skip} skipped, ${tally["n/a"]} not applicable`,
  );
}
// A sabotage run where *nothing* failed is almost never the finding it looks
// like. Blanking a module should break essentially every file that was really
// measuring it, so "every file still passed" reads as "every test is hollow" --
// a catastrophic conclusion -- when the likelier cause is that the flag never
// reached the child and no module was blanked at all. Those are opposite facts
// and the output cannot currently tell them apart.
//
// The web-platform lane hit the same shape from a different angle: a patch whose
// regex did not match, scored as a passing test, reporting a survivor against an
// unmodified tree. A mutation harness has to check that the mutation *happened*,
// not only that something ran afterwards.
if (sabotage && tally.pass > 0 && tally.fail === 0) {
  console.log(
    "\n  SABOTAGE DID NOT APPLY: every file passed with the module blanked, which" +
      "\n  means it was probably not blanked. Check that NTS_CONFORMANCE_SABOTAGE" +
      "\n  reached the child before reading this as hollow coverage.",
  );
  process.exitCode = 2;
} else {
  process.exitCode = tally.fail > 0 ? 1 : 0;
}
