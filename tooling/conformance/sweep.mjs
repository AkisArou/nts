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

import { readdirSync, existsSync, statSync } from "node:fs";
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
  return {
    stage: applicable > 0 && real === applicable ? "green" : real > 0 ? "partial" : "all-passes-degenerate",
    detail: `${tally.pass} / ${applicable}${degenerate > 0 ? `, ${degenerate} degenerate` : ""}`,
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

if (withAddons && !withTests) {
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

// The two audits that look for what is *absent*: a test file no module claims,
// and an export node has that the shape does not. Both are failures a green
// sweep is structurally unable to show -- an unclaimed file is in no
// denominator, and nothing can fail on a function nothing calls -- so they run
// here rather than when someone remembers. Skipped for a single-module or
// compiler-only run, where a profile-wide answer would be noise.
if (!withCompiles && modules.length > 1) {
  const audit = spawnSync(process.execPath, [join(HERE, "audit.mjs")], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = `${audit.stdout ?? ""}${audit.stderr ?? ""}`.trimEnd();
  if (text !== "") console.log(`\n${text}`);
  if (audit.status !== 0) process.exitCode = 4;
}
