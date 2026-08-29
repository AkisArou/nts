// One test file, in its own process.
//
// Node's harness runs each file as a separate process, and so does this: a
// test that changes the working directory, installs a global, or leaves a
// listener behind must not decide whether the next one passes.
// `test-path-zero-length-strings.js` passed alone and failed in a batch before
// this existed, which is exactly the class of bug the isolation prevents.
//
// Reports one JSON line on stdout so the parent can aggregate without parsing
// prose.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert";
import process from "node:process";
import { makeCommon, checkPending, peekPending, Skip } from "./common.mjs";
import tmpdir from "./tmpdir.mjs";
import fixtures from "./fixtures.mjs";
import * as hijackstdio from "./hijackstdio.mjs";

const [, , moduleName, file, addon] = process.argv;

// Node's own scheduling, captured before anything can replace it.
//
// The harness schedules the test body and its settle loop, and `node:timers`
// installs itself over the globals. Without capturing, running the timers
// module would make the harness measure the subject with the subject: a broken
// `setImmediate` would report every file as failing for reasons that have
// nothing to do with the file. The same rule as substituting node's `util`
// into a differential test.
// Node's own `process`, held separately from the global.
//
// `node:process` installs itself over `globalThis.process`, and after that a
// bare `process` in this file would be the module under test. The runner's own
// scheduling, its `beforeExit` wait and its exit have to keep working while
// the subject is being measured -- and have to keep working when the subject
// is broken, which is the whole point of running it.
const hostProcess = globalThis.process;
const hostSetImmediate = globalThis.setImmediate;
const hostSetTimeout = globalThis.setTimeout;
const hostClearTimeout = globalThis.clearTimeout;
const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = resolvePath(HERE, "../..");
const moduleDir = join(ROOT, "runtime/node", moduleName);

/**
 * Report, then let the process exit on its own.
 *
 * Deliberately not `process.exit`: many of node's tests assert inside a
 * `process.on('exit')` handler, and killing the process here would skip them --
 * the child would report a pass that nothing had checked. Exiting normally runs
 * those handlers, and a throw from one sets a non-zero exit status that the
 * parent turns into a failure.
 */
const reportTo = process.stdout.write.bind(process.stdout);

let reported = false;

/**
 * Lets `settle` give up when the loop ends underneath it.
 *
 * Without this the runner exits with node's "unsettled top-level await" status
 * rather than the status its own report implies, and the parent reads the exit
 * code rather than the report.
 */
let releaseSettle = null;

function report(result) {
  if (reported) return;
  reported = true;
  // Bound at load: node's console tests replace `process.stdout.write`, and
  // the report must reach the parent whatever the test did to the stream.
  reportTo(`${JSON.stringify(result)}\n`);
}

/**
 * The last word, if the loop ended before the runner had one.
 *
 * A test can leave `settle` waiting forever: it has an unmet expectation, so
 * the runner waits for another `beforeExit` round to meet it, and no round
 * comes because the loop has drained. The process then exits with nothing
 * written and the parent sees silence, which is a failure with no reason
 * attached.
 *
 * Node judges its own tests from an `exit` handler for the same reason -- it
 * is the one moment that always arrives. This is that handler, and it only
 * speaks if nothing else has.
 */
hostProcess.on("exit", () => {
  releaseSettle?.();
  if (reported) return;
  const missed = checkPending();
  if (missed.length > 0) {
    const m = missed[0];
    report({
      kind: "fail",
      why: `${m.name} was called ${m.actual} times, expected ${m.expected}`,
      detail: "the loop ended with the expectation unmet",
    });
  } else {
    report({ kind: "pass" });
  }
});

/**
 * A cap on waiting for the loop to drain, for a test that leaves something
 * running on purpose. Long enough for any delay these tests use.
 */
const SETTLE_CAP_MS = 2000;

/**
 * How many `beforeExit` rounds to wait through.
 *
 * A bound rather than a belief that tests are well behaved: a listener that
 * schedules work from every `beforeExit` would keep the loop alive forever,
 * and the runner would hang instead of failing.
 */
const SETTLE_ROUNDS = 16;

/**
 * Decide the verdict once the loop has run out of work.
 *
 * Node checks its own `mustCall` tallies from a `process.on('exit')` handler --
 * that is, once there is nothing left to run. Turning the loop a fixed number
 * of times is not the same thing: `setTimeout(common.mustCall(), 10)` had
 * about a millisecond to fire and was reported as a callback that never ran.
 *
 * `beforeExit` is the signal, and it can arrive more than once. A listener is
 * allowed to schedule more work -- that is what the event is *for*, and node
 * re-emits it each time the loop drains again. So this leaves on the first
 * round where nothing is outstanding; if an expectation is unmet, another
 * round is where it would be met.
 *
 * Not written as an `await` in the main flow, though it reads better that way.
 * If the loop ends while that promise is pending, node exits with its
 * "unsettled top-level await" status and the parent reads an exit code instead
 * of the report this file wrote. Handlers cannot be left pending; a promise
 * can.
 */
function judgeWhenQuiet() {
  let rounds = 0;
  let finished = false;

  const cap = hostSetTimeout(() => finish(), SETTLE_CAP_MS);
  // Unrefed, or the cap would itself be pending work and `beforeExit` would
  // never arrive before it.
  cap.unref();

  const onBeforeExit = () => {
    rounds++;
    if (peekPending().length > 0 && rounds < SETTLE_ROUNDS) return;
    finish();
  };
  hostProcess.on("beforeExit", onBeforeExit);

  function finish() {
    if (finished) return;
    finished = true;
    hostClearTimeout(cap);
    hostProcess.off("beforeExit", onBeforeExit);
    // Let ticks and microtasks finish, because `process.emitWarning` delivers
    // on a tick. Ticks and microtasks only -- deliberately not `setImmediate`
    // or a zero timer. Those turn the loop, and a turn after the loop has gone
    // quiet runs exactly the work that was supposed to have been abandoned:
    // `setImmediate(common.mustNotCall()).unref()` called its callback.
    drain(3, judge);
  }
}

/** `times` rounds of "every tick, then every microtask", then `then`. */
function drain(times, then) {
  if (times === 0) {
    then();
    return;
  }
  hostProcess.nextTick(() => {
    Promise.resolve().then(() => drain(times - 1, then));
  });
}

function judge() {
  try {
    const missed = checkPending();
    if (missed.length > 0) {
      const m = missed[0];
      throw new Error(`${m.name} was called ${m.actual} times, expected ${m.expected}`);
    }
    if (testCases.registered > 0 && testCases.skipped === testCases.registered) {
      report({ kind: "skip", why: `all ${testCases.registered} node:test case(s) skipped` });
    } else {
      report({ kind: "pass" });
    }
  } catch (e) {
    reportFailure(e);
  }
}

/**
 * The siblings this module shares state with, named in its `uses` file.
 *
 * One `name` per line. Each is loaded exactly as the module under test is,
 * native half included, so that both halves of a shared registry are ours.
 */
const siblings = new Map();

/** Node-internal module ids the module under test answers for, from its shape. */
let internals = null;

/** The module's own uncaught-exception dispatch, when it has one. */
let uncaughtHandler = null;

/**
 * `--sabotage`, via the environment so the child sees it.
 *
 * Everything the module under test would have supplied is blanked: the module
 * itself, the node-internal ids it answers for, and the siblings it shares
 * state with. Whatever still passes was never measuring us.
 */
const sabotaged = process.env["NTS_CONFORMANCE_SABOTAGE"] === "1";

/**
 * Warnings the module emitted while it was being loaded.
 *
 * Node loads a module when the test calls `require`, and a module that warns on
 * load -- `punycode` deprecating itself -- emits *after* the test has installed
 * its listener. This harness must import before the test body runs, because
 * imports are asynchronous, so that warning would fire into an empty room.
 *
 * They are held here and re-emitted when the test first requires the module,
 * which is where node would have emitted them. Replaying is faithful rather
 * than compensatory: the observable event moves back to the point the test
 * actually asks for the module.
 */
const loadTimeWarnings = [];
let capturingLoadWarnings = true;
const realEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (...args) => {
  if (capturingLoadWarnings) {
    loadTimeWarnings.push(args);
    return;
  }
  return realEmitWarning(...args);
};

let underTest;
try {
  let exports;
  if (addon && addon !== "-") {
    exports = createRequire(import.meta.url)(resolvePath(addon));
  } else {
    const shims = join(moduleDir, "bindings.node.mjs");
    if (existsSync(shims)) await import(shims);
    exports = await import(join(moduleDir, "src/main.ts"));
  }
  const shapePath = join(moduleDir, "shape.mjs");
  const shapeModule = existsSync(shapePath) ? await import(shapePath) : null;
  underTest = shapeModule ? shapeModule.shape({ ...exports }) : { ...exports };
  // A module that is also a global -- `console` -- has to be installed as one,
  // or a test comparing `require('console')` with `globalThis.console` sees
  // node's on one side and ours on the other. Declared per module rather than
  // guessed, so the substitution stays auditable.
  // `--sabotage`: hand the test an empty module instead of ours. Every file
  // that still passes is a file that was never measuring us -- it reached for
  // node's own implementation, or asserted something true of any module at
  // all. A pass count nobody has tried to make fail is not a measurement.
  if (sabotaged) {
    underTest = {};
  }
  shapeModule?.installGlobals?.(underTest);
  internals = sabotaged ? {} : (shapeModule?.internals?.({ ...exports }) ?? null);
  uncaughtHandler = sabotaged ? null : (shapeModule?.dispatchUncaught ?? null);

  const usesPath = join(moduleDir, "uses");
  if (existsSync(usesPath)) {
    for (const name of readFileSync(usesPath, "utf8").split("\n").map((l) => l.trim())) {
      if (!name || name.startsWith("#")) continue;
      const dir = join(ROOT, "runtime/node", name);
      const siblingShims = join(dir, "bindings.node.mjs");
      if (existsSync(siblingShims)) await import(siblingShims);
      const siblingExports = { ...(await import(join(dir, "src/main.ts"))) };
      const siblingShape = join(dir, "shape.mjs");
      const siblingShapeModule = existsSync(siblingShape) ? await import(siblingShape) : null;
      const shaped = sabotaged
        ? {}
        : (siblingShapeModule ? siblingShapeModule.shape(siblingExports) : siblingExports);
      siblings.set(name, shaped);
      // A sibling that owns globals has to install them, or the test reaches
      // node's. An `async_hooks` test calling `setImmediate` is the case that
      // found this: it was measuring node's timers and reporting the result as
      // ours, which is a hollow pass the sabotage run cannot catch -- sabotage
      // blanks our module, and node's globals were never ours to blank.
      if (!sabotaged) siblingShapeModule?.installGlobals?.(shaped);
    }
  }
} catch (e) {
  // Nothing to run against, so stop here rather than letting the test fail
  // later for a reason that only restates this one.
  report({ kind: "fail", why: `loading the module: ${e?.message ?? e}` });
  hostProcess.exit(0);
}

const common = makeCommon();
const realRequire = createRequire(import.meta.url);

/**
 * How many of the file's `node:test` cases were registered, and how many were
 * declared skipped.
 *
 * A file whose every case skipped exits 0, and exiting 0 is what this runner
 * reads as a pass -- so such a file was reported as passing while running
 * nothing. It is reported as a skip now, which is what it is.
 */
const testCases = { registered: 0, skipped: 0 };

let wrappedTestRunner;
function countingTestRunner() {
  if (wrappedTestRunner !== undefined) return wrappedTestRunner;
  const real = realRequire("node:test");
  const count = (fn) => (...args) => {
    testCases.registered++;
    // `test(name, options, fn)` and `test(options, fn)` both carry `skip`.
    const options = args.find((a) => a !== null && typeof a === "object" && !Array.isArray(a));
    if (options?.skip || options?.todo) testCases.skipped++;
    return fn(...args);
  };
  wrappedTestRunner = Object.assign(count(real), real, {
    test: count(real.test ?? real),
    it: count(real.it ?? real),
  });
  return wrappedTestRunner;
}

/**
 * Block the thread for `ms`, the way node's `internal/util.sleep` does.
 *
 * `Atomics.wait` on a value that never changes is a real sleep: it parks the
 * thread rather than spinning, and nothing else on this thread runs, which is
 * the point. A test uses it to prove that a callback taking longer than an
 * interval does not make the interval fire twice.
 */
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

const internalUtilStandIn = new Proxy(
  {
    sleep(ms) {
      Atomics.wait(sleepCell, 0, 0, ms);
    },
  },
  {
    get(target, property) {
      if (property in target || typeof property === "symbol") {
        return target[property];
      }
      throw new Skip(`needs internal/util.${String(property)}`);
    },
  },
);

function shimmedRequire(id) {
  const bare = id.replace(/^node:/, "");
  if (bare === moduleName) {
    for (const args of loadTimeWarnings.splice(0)) {
      realEmitWarning(...args);
    }
    return underTest;
  }
  if (bare.startsWith(`${moduleName}/`)) {
    const half = bare.slice(moduleName.length + 1);
    if (half in underTest && underTest[half]) return underTest[half];
    throw new Skip(`needs ${id}`);
  }
  if (bare === "assert" || bare === "assert/strict") return assert;
  if (bare === "test" || bare === "node:test") return countingTestRunner();
  // A sibling the module under test shares state with. `console` publishes to
  // `diagnostics_channel`, and a test that subscribes has to reach the same
  // registry the console publishes into -- node's would be a different one and
  // the subscription would silently never fire.
  //
  // Only the modules named in the module's `uses` file, never every module we
  // happen to have: a test that builds its expected output with `util.inspect`
  // is checking us *against node*, and handing it our own `util` would turn a
  // differential test into a tautology.
  if (siblings.has(bare)) return siblings.get(bare);
  // A node-internal module the test reaches for with `--expose-internals`.
  // Ours live in different files, so the module says which of its exports
  // stand in -- declared in `shape.mjs`, so the mapping is readable next to
  // the module rather than hidden in the harness.
  if (internals && bare in internals) return internals[bare];
  // `internal/util` holds one thing these tests want that is test
  // infrastructure rather than any module's implementation: a blocking sleep,
  // used to make wall-clock time pass inside a callback. It is served here,
  // beside `common` and `fixtures`, rather than pretended to be part of a
  // module that does not have it.
  //
  // Only `sleep`. Anything else on that module is a real implementation
  // detail, and asking for one is a skip that names it -- not `undefined`,
  // which would let a test run against a missing dependency and report
  // whatever came of that.
  if (bare === "internal/util") return internalUtilStandIn;
  if (id.endsWith("../common")) return common;
  if (id.endsWith("common/tmpdir")) return tmpdir;
  if (id.endsWith("common/fixtures")) return fixtures;
  if (id.endsWith("common/hijackstdio")) return hijackstdio;
  // Anything else is infrastructure rather than the subject: `node:test` is a
  // test runner, `child_process` spawns, `util` formats. Node's own is the
  // right answer for those -- substituting ours would test ours. A module we
  // do not have is a skip, and the reason names it.
  for (const candidate of [id, bare]) {
    try {
      return realRequire(candidate);
    } catch {
      // try the next spelling
    }
  }
  throw new Skip(`needs ${id}`);
}

const src = readFileSync(file, "utf8");
const module = { exports: {} };
try {
  // Node's tests are CommonJS. Running the source in a function with a
  // substituted `require` is the whole mechanism: no rewriting, so what runs is
  // what node's maintainers wrote.
  const run = new Function(
    // `console` is deliberately absent: node's tests reassign
    // `globalThis.console` and expect the next unqualified `console` to see
    // the new value, which a parameter binding would not. Some of them also
    // declare a local `const console`, which a parameter would collide with.
    "require", "module", "exports", "__filename", "__dirname",
    "process", "global", "globalThis",
    src,
  );
  // From a fresh macrotask, not from here.
  //
  // Everything above this point is `await`ed, so calling `run` directly would
  // execute the test body inside a microtask continuation -- and a body that
  // starts mid-drain sees its own top-level microtasks resolve *before* its
  // top-level `process.nextTick`, which is the reverse of what node does. Node
  // runs `test/parallel` as CommonJS, where the body is a plain host task and
  // the checkpoint starts empty: ticks first, then microtasks.
  //
  // Measured rather than reasoned: the same file gives
  //   node, CommonJS      tick -> microtask -> tick-from-microtask
  //   here, before this   microtask -> tick -> tick-from-microtask
  // A module system is a hidden parameter of every ordering assertion, and
  // this harness was silently supplying the wrong one.
  capturingLoadWarnings = false;
  await new Promise((resolve, reject) => hostSetImmediate(() => {
    try {
      // `globalThis.process`, not the captured one: node hands the CJS wrapper
      // the real global, so when `node:process` has installed itself the test
      // must see the installed object under both names.
      run(shimmedRequire, module, module.exports, file, dirname(file),
          globalThis.process, globalThis, globalThis);
      resolve();
    } catch (e) {
      // A module that owns uncaught-exception dispatch gets first refusal.
      //
      // Node's runtime hands an escaped exception to `process`, which runs a
      // capture callback or emits `uncaughtException`; a program with either
      // of those carries on. Catching it here and reporting a failure would
      // make every such test fail for the one reason the test is about. Only
      // a module that declares the hook can claim one -- for everything else
      // an escaped exception is exactly the failure it looks like.
      if (uncaughtHandler?.(underTest, e)) resolve();
      else reject(e);
    }
  }));
  judgeWhenQuiet();
} catch (e) {
  reportFailure(e);
}

function reportFailure(e) {
  if (e instanceof Skip || e?.name === "Skip") {
    report({ kind: "skip", why: e.message });
    hostProcess.exit(0);
  }
  report({
    kind: "fail",
    why: (e?.message ?? String(e)).split("\n").find((l) => l.trim())?.trim() ?? "",
    // The message and the frames that are ours. Node's own frames and the
    // harness's are noise; the test file and the module under test are not.
    detail: [
      (e?.message ?? String(e)).split("\n").slice(0, 16).join("\n"),
      // Our frames, the test file's, and the anonymous ones -- a test runs
      // inside `new Function`, so its own frames are `<anonymous>` with a line
      // number two off the file's, which is still the fastest way to find the
      // assertion that failed.
      ...(e?.stack ?? "").split("\n").filter((l) =>
        l.includes("/runtime/node/") || l.includes("/test/parallel/") || l.includes("<anonymous")
      ).slice(0, 8),
    ].join("\n"),
  });
}

