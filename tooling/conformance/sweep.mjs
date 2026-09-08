// Every module, both modes, as the table the conformance doc carries.
//
//   node tooling/conformance/sweep.mjs [--modules a,b,c] [--no-sabotage]
//                                     [--compiles] [--addons] [--no-tests]
//
// Two reasons this exists rather than thirteen invocations typed by hand.
//
// The first is drift. The per-module table in `docs/conformance/nodejs.md` was
// hand-copied, and a hand-copied number is a claim nobody can check -- which is
// the same failure as a measurement that cannot go red, one level up. The rows
// this prints are the rows that belong in the document.
//
// `--compiles --no-tests` is the compiler axis alone, in seconds rather than
// minutes. It exists for the other side of this project: their corpus is
// TypeScript's own test suite, which is single-file by construction, so a rule
// about the relationship *between* modules has nowhere to appear in it. Three
// separate compiler bugs have been found here and not there for that reason --
// a name collision across two files, calls to imported functions, and the
// evaluation order of a second module's top-level statements. This profile is
// thirteen real multi-module programs sharing an `internal/`, so pointing the
// compiler at it is a standing test of a dimension the corpus does not have.
//
// `--addons --no-tests` is the third axis and the one that is actually the
// gate: build each module's Node-API addon and run node's tests against the
// artifact rather than against TypeScript on node. It reports where each
// module *stops* -- emit refused, the emitted C did not compile, the addon
// built and loaded but exports the wrong things, or it passes -- because a
// count of "not green" tells a compiler session nothing and the stage tells it
// which pass to look at. It exists because that axis was measured for the
// first time by a shell loop typed by hand, and a hand-typed loop is not
// something a later reader can re-run to check the claim.
//
// `--compiles` adds the other axis: `nts hir` per module, lowered and refused.
// It is off by default because it is slow, and it exists because a change to
// this profile's *source* can cost lowered functions in a module it did not
// touch. Adding argument validation to `node:buffer` cost `node:fs` ten,
// measured only because a compiler change happened to prompt a re-run. A
// behaviour sweep cannot see that: node's tests do not care whether a function
// lowered.
//
// The second is that a change to shared code costs its passes somewhere other
// than where it was aimed. `internal/errors.ts`, `util/src/inspect.ts` and
// `deep-equal.ts` are under every module here, and a sweep that covers only the
// module being worked on would report the win and miss the cost.

import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "../..");
const PROFILE = join(ROOT, "runtime/node");

const argv = process.argv;
const arg = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1];
};
const withSabotage = !argv.includes("--no-sabotage");
const withCompiles = argv.includes("--compiles");
const withAddons = argv.includes("--addons");
const withTests = !argv.includes("--no-tests");
/**
 * Which `nts` to measure, and why it is not simply `target/release/nts`.
 *
 * Three sessions share this checkout and only one of them builds into
 * `target/`. A hard-coded path therefore measures whichever binary that
 * session happens to have produced, which may be a different compiler than the
 * one whose behaviour is being asked about -- and the run gives no sign of it.
 * `NTS_BIN` is the name the gate and the differential already use for a pinned
 * copy; `NTS_COMPILER` is the name `build.sh` already accepted here. Both are
 * honoured so that neither existing habit silently does nothing.
 */
const compiler = process.env.NTS_BIN || process.env.NTS_COMPILER || join(ROOT, "target/release/nts");
const usesCompilerEarly = withCompiles || withAddons;

if (usesCompilerEarly && !existsSync(compiler)) {
  console.error(`no compiler at ${compiler}; the compiler session must build it`);
  process.exit(2);
}

/**
 * The binary can change underneath a measurement that takes minutes.
 *
 * `nodejs.md` states the rule -- `stat` before and after, discard if the mtime
 * moved -- and stating a rule is not the same as running it. A compiled column
 * was published once from a run a rebuild had landed in the middle of, and
 * nothing about it looked wrong. So the sweep checks itself now: it records the
 * mtime before the first `nts hir` and again after the last, and refuses to
 * print a `compiles` column it cannot vouch for.
 *
 * Pinning with `NTS_BIN` makes this check pass trivially, which is the point.
 */
const usesCompiler = withCompiles || withAddons;
const compilerStamp = () => (usesCompiler ? statSync(compiler).mtimeMs : 0);
const compilerBefore = usesCompiler ? compilerStamp() : 0;

const requested = arg("--modules");
const modules = requested
  ? requested.split(",").map((m) => m.trim()).filter(Boolean)
  : readdirSync(PROFILE, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(PROFILE, e.name, "src/main.ts")))
      .map((e) => e.name)
      .sort();

/**
 * The compiled artifact, which is the gate: build the Node-API addon and run
 * node's own tests against it.
 *
 * This axis had no instrument until it had a result, which is backwards. It
 * was first measured by a shell loop typed by hand, and a shell loop is not
 * something a later reader can re-run to check a claim -- the same objection
 * this file already makes to a hand-copied table.
 *
 * The classification matters as much as the count. A module can stop at three
 * different places and only one of them is about the module: `emit-c` can
 * refuse, the C it emits can fail to compile, or the addon can build and load
 * and export the wrong things. Collapsing those into "not green" throws away
 * the only part a compiler session can act on.
 */
/**
 * Names a module's `shape.mjs` reads off its exports that the addon does not
 * publish.
 *
 * The export audit asks this of the TypeScript lane. Nothing asked it of a
 * compiled artifact, because until now no artifact published enough for the
 * question to arise.
 */
function shapeNamesMissingFrom(module, artifact) {
  const shapePath = join(PROFILE, module, "shape.mjs");
  if (!existsSync(shapePath)) return [];
  const text = readFileSync(shapePath, "utf8");
  const start = text.indexOf("export function shape(");
  if (start < 0) return [];
  const next = text.indexOf("\nexport function ", start + 1);
  const body = text.slice(start, next < 0 ? text.length : next);
  const needed = new Set(
    [...body.matchAll(/\bexports\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  );
  let published;
  try {
    published = new Set(Object.keys(createRequire(import.meta.url)(artifact)));
  } catch {
    return [];
  }
  return [...needed].filter((name) => !published.has(name)).sort();
}

function addon(module) {
  const artifact = join(ROOT, "target/node", `${module}.node`);
  try {
    execFileSync(join(HERE, "build.sh"), [module], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NTS_COMPILER: compiler },
    });
  } catch (e) {
    const log = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    const clang = [...log.matchAll(/error: (.+)/g)].map((m) => m[1]);
    return clang.length > 0
      ? { stage: "c-did-not-compile", detail: `${clang.length} clang error(s)`, clang }
      : { stage: "emit-refused", detail: (log.split("\n").filter(Boolean).pop() ?? "").slice(0, 70), clang: [] };
  }

  // Does the artifact survive being used at all? A module that loads and then
  // dies on its first real call reports the same way as one whose surface is
  // incomplete -- `0 / N, k names published` -- and they want completely
  // different work. `punycode` was the first module here to compile and it
  // segfaulted on `encode('a')`; the sweep called that a coverage gap, and it
  // was found only by running the test by hand. A crash reported as a missing
  // export is worse than no report.
  const crash = crashesOnUse(module, artifact);
  if (crash !== null) return { stage: "built-but-crashes", detail: crash, clang: [] };

  const tally = runAddon(module, artifact);
  if (tally === null) return { stage: "runner-produced-nothing", detail: "", clang: [] };
  const applicable = tally.pass + tally.fail;
  if (tally.pass === 0 && applicable > 0) {
    // An addon that publishes nothing and one that publishes some of the right
    // names are different situations and want different work. Empty means every
    // name this module exports is a class or a const bound to a native
    // function, so the blocker is class values crossing the ABI. Non-empty
    // means the table is right as far as it goes and the missing entries are
    // the ones whose types cannot cross -- an object return, an array return.
    // Collapsing the two hides which of those a module is waiting on.
    let published = 0;
    try {
      published = Object.keys(createRequire(import.meta.url)(artifact)).length;
    } catch {
      return { stage: "built-but-unloadable", detail: `0 / ${applicable}`, clang: [], tally };
    }
    return {
      stage: published === 0 ? "built-exports-nothing" : "built-exports-partial",
      detail: `0 / ${applicable}, ${published} name(s) published`,
      clang: [],
      tally,
    };
  }
  // Any pass on this axis gets the harder question asked of it, because the
  // first one that was ever reported did not survive it. `path` reported 2 of
  // 17 and both were `require('path/posix') === require('path').posix`
  // holding because each side was `undefined`. Sabotage failed those files --
  // for the wrong reason, the subpath stopping resolving -- and so reported a
  // clean hollow count. Keeping the addon's names and destroying its behaviour
  // is the question sabotage cannot ask: did this pass depend on what the
  // module *does*?
  const degenerate = runAddon(module, artifact, true)?.pass ?? 0;
  const real = tally.pass - degenerate;
  const stage = applicable > 0 && real === applicable
    ? "green"
    // Named for the passes, not the tests. `all-passes-degenerate` read as "all
    // tests pass, degenerately" to the person who wrote it, an hour later, in
    // his own table -- `path` is 2 passed and 17 failed, and the row means both
    // passes were hollow. The two readings call for opposite work, so the label
    // says which noun it quantifies.
    : real > 0 ? "partial" : "every-pass-hollow";

  // Passing every test is not the same as being complete, and this axis is
  // about to have a row where the difference matters. `punycode` publishes
  // `decode`, `encode`, `toASCII`, `toUnicode` and `ucs2` but not `version`, a
  // string constant node's own test never touches -- so it can pass every
  // applicable test with a name missing from its surface, and "green" would
  // read as "works" when it means "nothing asked".
  //
  // So a green module that does not publish everything its `shape.mjs` needs
  // says so on the same line. Not a downgrade -- the tests really do pass -- but
  // the first row on an axis that has only ever reported zero will be quoted,
  // and it should carry its own caveat.
  // Computed for *every* module that produced an artifact, not only green ones.
  //
  // It was `stage === "green"` because the case it was written for was
  // `punycode` passing everything with `version` absent. But the modules that
  // most need this are the ones that build and fail: their missing names are the
  // whole explanation, and without them a row reads as a behaviour problem.
  // `buffer` at 0 of 55 looks like fifty-five broken assertions and is one fact
  // -- it publishes 3 of its 15 exports. `path` at 2 of 22 is eleven absent
  // functions, and every test that touches one fails with a TypeError about
  // `undefined`, which names nothing.
  //
  // I derived that by hand for five modules today, one addon at a time, before
  // noticing this line already knew how and was declining to say.
  const missing = artifact !== null ? shapeNamesMissingFrom(module, artifact) : [];
  const incomplete = missing.length > 0
    ? `${stage === "green" ? "incomplete" : "absent"}: ${missing.join(", ")}`
    : "";
  return {
    stage,
    // Its own field as well as part of `detail`, because the two output paths
    // print different things and the qualifier has to survive both. The first
    // version put it only in `detail`, which the with-tests row does not print
    // -- so the first green row this axis ever produced came out unqualified,
    // which is the exact outcome the annotation was added to prevent.
    incomplete,
    detail: `${tally.pass} / ${applicable}` +
      (degenerate > 0 ? `, ${degenerate} degenerate` : "") +
      (incomplete === "" ? "" : `, ${incomplete}`),
    clang: [],
    tally,
    degenerate,
  };
}

/**
 * Load the artifact in a child and call each exported function once.
 *
 * Deliberately in its own process: a segfault takes the whole runtime with it,
 * so this cannot be asked from inside the sweep. The arguments are a single
 * empty-ish value -- the point is not to test behaviour but to find out whether
 * the module survives being entered, which is a question no test result can
 * answer once the process is gone.
 */
function crashesOnUse(module, artifact) {
  const probe =
    `const m = require(${JSON.stringify(artifact)});` +
    `for (const k of Object.keys(m)) { if (typeof m[k] === "function") { try { m[k]("a"); } catch {} } }`;
  try {
    execFileSync(process.execPath, ["-e", probe], {
      encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
    });
    return null;
  } catch (e) {
    if (e.signal) return `died on ${e.signal} calling an export`;
    if (e.killed) return "hung calling an export";
    return null; // an ordinary throw is not a crash; the suite will judge it
  }
}

/** One module against its compiled artifact, optionally with its behaviour destroyed. */
function runAddon(module, artifact, mutate = false) {
  const args = [join(HERE, "run.mjs"), "--module", module, "--addon", artifact, "--json"];
  if (mutate) args.push("--mutate-addon");
  try {
    return JSON.parse(execFileSync(process.execPath, args, {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    })).tally;
  } catch (e) {
    try {
      return JSON.parse(e.stdout ?? "").tally;
    } catch {
      return null;
    }
  }
}

/**
 * `nts hir` for one module: how many functions lowered, how many constructs
 * refused. Compiler failures propagate: reporting them as an absent optional
 * axis would turn a backend regression into an apparently successful sweep.
 */
function compiles(module) {
  const out = execFileSync(
    compiler,
    ["hir", join(PROFILE, module, "tsconfig.json")],
    {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NTS_TSGO: join(ROOT, "target/tsgo") },
    },
  );
  const match = /(\d+) function\(s\), (\d+) construct\(s\) refused/.exec(out);
  if (match === null) {
    throw new Error(`could not read lowering totals for ${module}`);
  }
  return { lowered: Number(match[1]), refused: Number(match[2]), backend: backendRefusals(module) };
}

/**
 * Functions the C backend refuses that the lowering accepted.
 *
 * `nts hir` cannot see this: the pass that drops callers of a refused function
 * runs long before a backend can refuse anything. So `lowered` is an upper
 * bound on what reaches an artifact, and this is the distance between the two.
 *
 * It is a quantity in its own right rather than a correction. `punycode`
 * reports 16 lowered and 3 refused while its artifact publishes nothing,
 * because `emit-c` refuses five more that `hir` never sees -- and nobody knew
 * that number existed until an artifact came out empty.
 */
function backendRefusals(module) {
  // `spawnSync` rather than `execFileSync`, because the diagnostics are on
  // stderr and `execFileSync` returns only stdout when the command succeeds --
  // which made this function report zero backend refusals for every module,
  // including one known to have six.
  const run = spawnSync(
    compiler,
    ["emit-c", join(PROFILE, module, "tsconfig.json"), "--out", join(ROOT, "target/node", `${module}.gap`), "--napi"],
    {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, NTS_TSGO: join(ROOT, "target/tsgo") },
    },
  );
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  // One name per function the backend declined, however many times it is cited.
  const names = new Set();
  for (const line of out.split("\n")) {
    const named = /NTS\d+ `([^`]+)` cannot be compiled/.exec(line);
    if (named !== null) names.add(named[1]);
  }
  return names.size;
}

/** One module, one mode. Returns the tally the runner reported. */
function run(module, sabotage) {
  const args = [join(HERE, "run.mjs"), "--module", module, "--json"];
  if (sabotage) args.push("--sabotage");
  try {
    const out = execFileSync(process.execPath, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out).tally;
  } catch (e) {
    // A non-zero exit is the normal case: the runner reports failures that way.
    try {
      return JSON.parse(e.stdout ?? "").tally;
    } catch {
      return null;
    }
  }
}

const rows = [];
let totalPass = 0;
let totalHollow = 0;

for (const module of modules) {
  const started = Date.now();
  const real = withTests ? run(module, false) : { pass: 0, fail: 0 };
  if (real === null) {
    console.error(`  ${module}: the runner produced nothing`);
    continue;
  }
  const hollow = withTests && withSabotage ? run(module, true)?.pass ?? null : null;
  const lowering = withCompiles ? compiles(module) : null;
  const compiled = withAddons ? addon(module) : null;
  const applicable = real.pass + real.fail;
  totalPass += real.pass;
  if (hollow !== null) totalHollow += hollow;
  rows.push({ module, pass: real.pass, applicable, hollow, lowering, compiled });
  process.stderr.write(
    withAddons && !withTests
      ? `  ${module.padEnd(22)} ${compiled.stage.padEnd(20)} ${compiled.detail}` +
        `  (${((Date.now() - started) / 1000).toFixed(0)}s)\n`
      : withTests
        ? `  ${module.padEnd(22)} ${String(real.pass).padStart(3)} / ${String(applicable).padEnd(4)}` +
          `${hollow === null ? "" : ` hollow ${hollow}`}` +
          `${compiled === null ? "" : ` addon ${compiled.stage}`}` +
          `${compiled?.incomplete ? `, ${compiled.incomplete}` : ""}` +
          `  (${((Date.now() - started) / 1000).toFixed(0)}s)\n`
        : `  ${module.padEnd(22)} ${lowering ? `${lowering.lowered} lowered, ${lowering.refused} refused, ${lowering.backend} backend-refused` : "no compiler"}\n`,
  );
}

// Best first, as the document orders them: a reader wants the finished modules
// at the top and the ones with the most left to do at the bottom.
rows.sort((a, b) =>
  withTests
    ? (b.pass / (b.applicable || 1)) - (a.pass / (a.applicable || 1))
    : (b.lowering?.lowered ?? 0) - (a.lowering?.lowered ?? 0));

if (withAddons) {
  console.log(`\n| module | compiled artifact | |`);
  console.log(`| --- | :---: | :---: |`);
  for (const { module, compiled } of rows) {
    console.log(`| \`${module}\` | ${compiled.stage} | ${compiled.detail} |`);
  }
  const green = rows.filter((r) => r.compiled.stage === "green").length;
  console.log(`\n${green} of ${rows.length} modules' compiled artifacts pass every applicable test.`);

  // The classification is the actionable half. A count of "not green" tells a
  // compiler session nothing; the error text tells it which pass to look at.
  const byStage = new Map();
  for (const { compiled } of rows) byStage.set(compiled.stage, (byStage.get(compiled.stage) ?? 0) + 1);
  console.log("\nwhere they stop:");
  for (const [stage, n] of [...byStage].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${stage}`);
  }

  const classes = new Map();
  for (const { compiled } of rows) {
    for (const raw of compiled.clang) {
      const key = raw.replace(/'[^']*'/g, "'X'").slice(0, 72);
      classes.set(key, (classes.get(key) ?? 0) + 1);
    }
  }
  if (classes.size > 0) {
    console.log("\nclang error classes:");
    for (const [k, n] of [...classes].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`  ${String(n).padStart(3)}  ${k}`);
    }
  }
} else if (withTests) {
  console.log(`\n| module | node's tests | hollow |${withCompiles ? " compiles |" : ""}`);
  console.log(`| --- | :---: | :---: |${withCompiles ? " :---: |" : ""}`);
} else {
  console.log(`\n| module | lowered / refused | backend-refused |`);
  console.log(`| --- | :---: | :---: |`);
}
let totalLowered = 0;
for (const { module, pass, applicable, hollow, lowering } of withAddons && !withTests ? [] : rows) {
  const complete = applicable > 0 && pass === applicable;
  const count = complete ? `**${pass} / ${applicable}**` : `${pass} / ${applicable}`;
  const compiled = lowering ? `${lowering.lowered} / ${lowering.refused}` : "—";
  if (lowering) totalLowered += lowering.lowered;
  console.log(
    withTests
      ? `| \`${module}\` | ${count} | ${hollow ?? "—"} |${withCompiles ? ` ${compiled} |` : ""}`
      : `| \`${module}\` | ${compiled} | ${lowering ? lowering.backend : "—"} |`,
  );
}
if (withTests) {
  console.log(
    `\n${totalPass} of node's own test files pass across ${rows.length} modules` +
      (withSabotage ? `, of which ${totalHollow} are hollow.` : "."),
  );
}
if (usesCompiler) {
  const compilerAfter = compilerStamp();
  if (compilerAfter !== compilerBefore) {
    console.log(
      `\nDISCARD THIS COLUMN. ${compiler} was rebuilt during the run ` +
        `(mtime ${new Date(compilerBefore).toISOString()} -> ` +
        `${new Date(compilerAfter).toISOString()}), so the modules measured ` +
        `before it used a different compiler than the ones measured after. ` +
        `Pin a copy and re-run with NTS_BIN=<path>.`,
    );
    process.exitCode = 3;
  } else if (withCompiles) {
    const totalBackend = rows.reduce((n, r) => n + (r.lowering?.backend ?? 0), 0);
    console.log(
      `${totalLowered} functions lower to HIR, measured with ${compiler}.\n` +
        `${totalBackend} of them are refused afterwards by the C backend, which this axis cannot see.`,
    );
  } else {
    console.log(`measured with ${compiler}.`);
  }
}

// The three audits that look for what is *absent*: a test file no module
// claims, an export node has that the shape does not, and a module that no
// longer typechecks against its own tsconfig. All three are failures a green
// sweep is structurally unable to show -- an unclaimed file is in no
// denominator, nothing can fail on a function nothing calls, and the aggregate
// typecheck reads a referenced project's built declarations rather than its
// source, so it stayed green through thirteen broken modules. They run here
// rather than when someone remembers. Skipped for a single-module or
// compiler-only run, where a profile-wide answer would be noise.
if (!withCompiles && modules.length > 1) {
  const audit = spawnSync(process.execPath, [join(HERE, "audit.mjs")], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = `${audit.stdout ?? ""}${audit.stderr ?? ""}`.trimEnd();
  if (text !== "") console.log(`\n${text}`);
  if (audit.status !== 0) process.exitCode = 4;

  // A fourth audit, for what is *silently wrong* rather than absent. The three
  // above look for a missing test, a missing export, a module that stopped
  // typechecking. This one reads emitted C for accessors the emitter marks
  // `(void)v0` -- a getter compiled to ignore its receiver, which the source
  // says reads a field.
  //
  // It exists because `Response__get_status` returned a constant `0` with no
  // refusal, no clang error and no failing test, and was found by reading
  // generated C for an unrelated reason. `get ok()` is `this.status >= 200`, so
  // every response looked like a failure. Nothing in this profile could have
  // reported that.
  //
  // The number is the signal rather than the exit code: a genuine class constant
  // legitimately ignores its receiver, so a count is a question and not a
  // verdict. What matters is it *moving*. Reads whatever `target/node/*.build`
  // holds, so it describes the last builds rather than this run.
  {
    const accessors = spawnSync(
      process.execPath,
      [join(HERE, "accessor-audit.mjs"), "--all"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const summary = `${accessors.stdout ?? ""}`
      .split("\n")
      .filter((l) => l.includes("accessor(s) examined"))
      .join("")
      .trim();
    if (summary !== "") console.log(`\naccessors in the last emitted C: ${summary}`);
  }

  // Whether any binding's C disagrees with its declaration about types. This is
  // cheap -- it reads sources, builds nothing -- and it covers a defect class
  // neither lane can see: the interpreted lane's stand-ins are node's own
  // implementations, and the compiled lane only objects for a module that gets
  // far enough to emit C, which fifteen of twenty-two do not. Two were found by
  // hand in `zlib` before this existed and both had been there for as long as
  // the file had.
  {
    const abi = spawnSync(
      process.execPath,
      [join(HERE, "binding-abi-audit.mjs")],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const text = `${abi.stdout ?? ""}`;
    const summary = text.split("\n").filter((l) => l.includes("disagreeing")).join("").trim();
    if (summary !== "") console.log(`binding types: ${summary}`);
    for (const line of text.split("\n").filter((l) => l.includes("MISMATCH"))) {
      console.log(`  ${line.trim()}`);
    }
  }

  // Emitting C and compiling it are different claims, and only one was being
  // checked anywhere. The gate's `profile` step emits for all twenty-two
  // modules and never runs a compiler over any of it, so a change that breaks
  // every node module's compilation passes it green -- which happened on
  // 2026-09-08 and was caught by a rebuild done for something else. A floor,
  // not a target: it does not care how many build, only that the ones which did
  // still do.
  {
    const floor = spawnSync("bash", [join(HERE, "build-floor.sh")], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 3_600_000,
      env: process.env,
    });
    const text = `${floor.stdout ?? ""}${floor.stderr ?? ""}`;
    if (text.includes("INSTRUMENT FAILURE")) {
      console.log("build floor: INSTRUMENT FAILURE -- the floor list is empty");
    } else {
      const summary = text.split("\n").filter((l) => l.includes("still build")).join("").trim();
      if (summary !== "") console.log(`build floor: ${summary}`);
      for (const line of text.split("\n").filter((l) => /REGRESSED/.test(l))) {
        console.log(`  ${line.trim()}`);
      }
    }
  }

  // The skip lists, read back. A skip removes a file from a denominator, so
  // every percentage in the ledger is computed without it; the entries carry a
  // reason each and were read by a person when written, and nothing had ever
  // read them back.
  {
    const skips = spawnSync(process.execPath, [join(HERE, "skip-audit.mjs")], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    const text = `${skips.stdout ?? ""}${skips.stderr ?? ""}`;
    if (text.includes("INSTRUMENT FAILURE")) {
      console.log("skips: INSTRUMENT FAILURE -- nothing read; see skip-audit.mjs");
    } else {
      const summary = text.split("\n").filter((l) => l.includes("entr(ies)")).join("").trim();
      if (summary !== "") console.log(`skips: ${summary}`);
      for (const line of text.split("\n").filter((l) => /STALE|NO REASON/.test(l))) {
        console.log(`  ${line.trim()}`);
      }
    }
  }

  // A test that requires both `x` and `node:x` is comparing the module under
  // test with itself, because the harness substitutes it for both spellings.
  // One such test existed, asserted that node's `EventEmitter.prototype` names
  // were all present, said in its own comment that it read node's class at run
  // time, and could not have failed for the reason it was written.
  {
    const oracle = spawnSync(process.execPath, [join(HERE, "self-oracle.mjs")], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    const text = `${oracle.stdout ?? ""}${oracle.stderr ?? ""}`;
    if (text.includes("INSTRUMENT FAILURE")) {
      console.log("self-oracle: INSTRUMENT FAILURE -- no local tests scanned");
    } else {
      const summary = text.split("\n").filter((l) => l.includes("scanned")).join("").trim();
      if (summary !== "") console.log(`self-oracle: ${summary}`);
      for (const line of text.split("\n").filter((l) => /SELF-ORACLE/.test(l))) {
        console.log(`  ${line.trim()}`);
      }
    }
  }

  // What the shape shims answer for themselves. A shim builds the object node's
  // tests see out of a module's exports and is supposed to add shape and no
  // behaviour; where it supplies a value instead, every test reading it is
  // testing this repository rather than the artifact. `path/shape.mjs` handed
  // out `sep` and `delimiter` as literals, and a module exporting the wrong
  // separator passed 21 of 21.
  {
    const shims = spawnSync(process.execPath, [join(HERE, "shape-blindspot.mjs")], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 300_000,
    });
    const text = `${shims.stdout ?? ""}${shims.stderr ?? ""}`;
    if (text.includes("INSTRUMENT FAILURE")) {
      console.log("shape shims: INSTRUMENT FAILURE -- no shim exported `shape`");
    } else {
      const summary = text.split("\n").filter((l) => l.includes("supplying a value")).join("").trim();
      if (summary !== "") console.log(`shape shims: ${summary}`);
      for (const line of text.split("\n").filter((l) => /SUPPLIES/.test(l))) {
        console.log(`  ${line.trim()}`);
      }
    }
  }

  // And the C itself, run rather than type-checked. The audit above compares a
  // `declare function` against a prototype, which is a claim about types; this
  // executes the code. The two are easy to confuse, and on 2026-09-08 the
  // position was that `zlib`'s seven changed signatures, `fs`'s eleven byte
  // bindings and `timers`' whole handle policy had a clean audit and had never
  // been executed by anything -- because a module's C normally runs only when
  // the module compiles, and fifteen of twenty-two do not.
  //
  // Cheap, and it is the only check on this list that can fail for a reason the
  // compiler cannot fix.
  {
    const ctests = spawnSync("bash", [join(HERE, "c-tests.sh")], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 600_000,
    });
    const text = `${ctests.stdout ?? ""}${ctests.stderr ?? ""}`;
    const summary = text.split("\n").filter((l) => l.includes("needing a person")).join("").trim();
    if (text.includes("INSTRUMENT FAILURE")) {
      console.log("module C: INSTRUMENT FAILURE -- no test files found at all");
    } else if (summary !== "") {
      console.log(`module C: ${summary}`);
    }
    for (const line of text.split("\n").filter((l) => /did not build|CRASHED|HUNG|failed|DRIFT/.test(l))) {
      console.log(`  ${line.trim()}`);
    }
  }

  // And how many bindings no lane can currently disagree with node about: a
  // stand-in that delegates to node's own implementation cannot disagree with
  // it, and the compiled lane only speaks for a module that builds. This is a
  // queue rather than a gate, and it should go down.
  {
    const blind = spawnSync(
      process.execPath,
      [join(HERE, "standin-blindspot.mjs")],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const summary = `${blind.stdout ?? ""}`
      .split("\n")
      .filter((l) => l.includes("no lane can disagree"))
      .join("")
      .trim();
    if (summary !== "") console.log(`unmeasurable bindings: ${summary}`);
  }

  // What blocks the compiled axis, by *reach*: how many distinct modules each
  // refusal shape stops. `--backend` makes it run `emit-c` as well as `hir`, so
  // the backend codes are counted too -- `NTS2006` and its neighbours come from
  // the backend, and a table built on `hir` alone said nothing about 253 of them
  // sitting in this corpus. That hole was found by another lane asking what they
  // were, not by anything here noticing.
  //
  // It is the expensive block on this list, roughly an order of magnitude over
  // the audits above, because it compiles every module twice. It lives here
  // rather than in a flag because the compiler lane reads these numbers and was
  // otherwise producing them by hand, three columns at a time.
  {
    const reach = spawnSync(
      process.execPath,
      [join(HERE, "blocker-reach.mjs"), "--backend"],
      { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 3_600_000 },
    );
    const text = `${reach.stdout ?? ""}${reach.stderr ?? ""}`;
    if (text.includes("INSTRUMENT FAILURE")) {
      console.log("\nblocker reach: INSTRUMENT FAILURE -- zero shapes, see below");
      for (const line of text.split("\n").filter((l) => l.includes("NTS_TSGO") || l.includes("INSTRUMENT"))) {
        console.log(`  ${line.trim()}`);
      }
    } else {
      const rows = text.split("\n");
      const header = rows.find((l) => l.includes("distinct refusal shape"));
      if (header !== undefined) console.log(`\nblocker reach:${header}`);
      // The ten widest, and every backend code regardless of width, because the
      // backend half is the half that was invisible.
      const table = rows.filter((l) => /^ {2}\s*\d+\s+\d+\s{2}/.test(l));
      for (const line of table.slice(0, 10)) console.log(line);
      for (const line of table.filter((l) => l.includes("NTS2")).slice(0, 6)) {
        if (!table.slice(0, 10).includes(line)) console.log(line);
      }
    }
  }

  // The differential, for the same reason and at a fraction of its full size.
  // Node's tests are a fixed set of inputs a human chose; this asks node the
  // questions nobody wrote down, and it has found three real bugs -- a
  // `__proto__` that ordered itself first in `querystring`, a `domainToASCII`
  // that applied a mapping where node parses a host, and a `Buffer.from(str,
  // "base64")` that skipped every character above U+00FF and sized its
  // allocation from a count that could be zero.
  //
  // 200 iterations rather than the default, because it runs every sweep and
  // every one of those three showed up in the first few hundred inputs. The
  // full run is `differential-ts.mjs --all`, and is worth doing when a corpus
  // changes or an encoding is touched.
  const differential = spawnSync(
    process.execPath,
    [join(HERE, "differential-ts.mjs"), "--all", "--iterations", "200"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const diffText = `${differential.stdout ?? ""}${differential.stderr ?? ""}`.trimEnd();
  const summary = diffText
    .split("\n")
    .filter((line) => line.includes("comparison(s)") || line.includes("divergence"))
    .join("\n");
  if (diffText !== "") {
    console.log(`\ndifferential against node:`);
    console.log(differential.status === 0 ? summary : diffText);
  }
  if (differential.status !== 0) process.exitCode = 5;
}
