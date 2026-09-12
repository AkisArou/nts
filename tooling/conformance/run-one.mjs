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

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, isAbsolute, relative, resolve as resolvePath } from "node:path";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert";
import process from "node:process";
import { getSystemErrorMap, getSystemErrorMessage, getSystemErrorName } from "node:util";
import { makeCommon, checkPending, peekPending, Skip } from "./common.mjs";
import tmpdir from "./tmpdir.mjs";
import fixtures from "./fixtures.mjs";
import * as hijackstdio from "./hijackstdio.mjs";

const [, , moduleName, file, addon, ...fixtureArgs] = process.argv;
const RESULT_PREFIX = "NTS_CONFORMANCE_RESULT ";
const nestedConformanceChild = process.env.NTS_CONFORMANCE_NESTED_CHILD === "1";

// Node launches each fixture as the program, so its private harness arguments
// are not visible through `process.argv`. Leaving ours in positions 2–4 changes
// tests that accept optional command-line inputs before the subject is reached.
process.argv = [process.execPath, file, ...fixtureArgs];

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
  // A self-forked fixture re-enters this runner so it keeps the same subject
  // and CommonJS loader. Its parent owns the published verdict; leaking a
  // second framed result onto inherited stdout could make run.mjs select the
  // child's line instead. Exit status is the ordinary child-process contract.
  if (nestedConformanceChild) {
    // A subject exit listener is allowed to change its own exitCode. Once the
    // harness has found a failure, that behavior must not overwrite the
    // runner's status in the process lifecycle relay. End this already-failed
    // nested runner directly; it publishes no framed result of its own.
    if (result.kind !== "pass") hostProcess.reallyExit(1);
    return;
  }
  // Bound at load: node's console tests replace `process.stdout.write`, and
  // the report must reach the parent whatever the test did to the stream.
  const line = `\n${RESULT_PREFIX}${JSON.stringify(result)}\n`;
  if (sabotaged && result.kind === "fail") {
    // A sabotaged test has served its only purpose as soon as it proves that
    // the empty module fails. It may have opened a child process or interval
    // before reaching our missing API; waiting for that unrelated handle made
    // the sabotage sweep sit on its per-file timeout. Flush the verdict, then
    // end this disposable child without running any more test callbacks.
    reportTo(line, () => hostProcess.reallyExit(0));
    return;
  }
  reportTo(line);
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
      detail: missed
        .map(
          (pendingCall) =>
            `${pendingCall.name}: ${pendingCall.actual}/${pendingCall.expected}` +
            (pendingCall.registeredAt === undefined ? "" : ` ${pendingCall.registeredAt.trim()}`),
        )
        .join("\n"),
    });
  } else {
    report({ kind: "pass" });
  }
});

/**
 * A cap on waiting for the loop to drain, for a test that leaves something
 * running on purpose. Long enough for any delay these tests use.
 */
// Several upstream networking tests intentionally wait four or five seconds
// to prove a timeout boundary. A two-second cap judged those files while
// their asserted callback was still legitimately pending. This remains well
// below the parent's per-file 60-second kill switch, but long enough for the
// longest ordinary timers in the supported suites.
const SETTLE_CAP_MS = 30_000;

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
    if (peekPending().length > 0 && rounds < SETTLE_ROUNDS) {
      // Work scheduled by an earlier `beforeExit` listener has not necessarily
      // run yet. In particular, a next tick runs after every listener in this
      // round, and must not itself make Node emit `beforeExit` again. Check once
      // the host tick queue has drained; only a still-pending native event needs
      // an immediate to keep the loop alive for another round.
      hostProcess.nextTick(() => {
        if (peekPending().length > 0) hostSetImmediate(() => {});
      });
      return;
    }
    finish();
  };
  hostProcess.on("beforeExit", onBeforeExit);

  function finish() {
    if (finished) return;
    finished = true;
    hostClearTimeout(cap);
    hostProcess.off("beforeExit", onBeforeExit);
    // `beforeExit` is emitted only after Node has already drained ticks and
    // microtasks. Scheduling our own ticks here changes what a test observing
    // async_hooks sees: the stream same-callback regression expects its one
    // implementation TickObject, while the old settle loop added three more.
    // Judge synchronously. If another beforeExit listener schedules work, an
    // eventual throw or non-zero exit still overrides an already printed pass
    // in the parent runner.
    judge();
  }
}

function judge() {
  try {
    const missed = checkPending();
    if (missed.length > 0) {
      const m = missed[0];
      throw new Error(
        `${m.name} was called ${m.actual} times, expected ${m.expected}` +
          (m.registeredAt === undefined ? "" : ` (${m.registeredAt.trim()})`),
      );
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

/** Private `internalBinding()` values explicitly supplied by the subject. */
let subjectTestBindings = null;

/** The module's own uncaught-exception dispatch, when it has one. */
let uncaughtHandler = null;

/**
 * Give an escaped exception to the subject, preserving a nested program's
 * ordinary fatal-error contract when nobody handles it.
 */
function dispatchEscapedException(error) {
  if (uncaughtHandler?.(underTest, error)) return true;
  if (!nestedConformanceChild) return false;

  const rendered = error?.stack ?? String(error);
  hostProcess.stderr.write(`${rendered}\n`);
  const chosenExitCode = globalThis.process?.exitCode;
  hostProcess.reallyExit(typeof chosenExitCode === "number" ? chosenExitCode : 1);
}

/**
 * `--sabotage`, via the environment so the child sees it.
 *
 * Everything the module under test would have supplied is blanked: the module
 * itself, the node-internal ids it answers for, and the siblings it shares
 * state with. Whatever still passes was never measuring us.
 */
const sabotaged = process.env["NTS_CONFORMANCE_SABOTAGE"] === "1";
/**
 * Hand the *shim* an empty exports object, and let it run.
 *
 * `--sabotage` replaces the shaped module with `{}`, so the shim never runs and
 * the test sees nothing at all. This is the other question: what does a test see
 * when the shim runs normally against an addon that published nothing? Every
 * absent-export guard fires, every name it guards becomes `undefined`, and any
 * assertion comparing two of them agrees.
 *
 * That is not hypothetical and `--sabotage` cannot see it. `timers` passes
 * `test-timers-promises.js`, whose whole body is
 * `deepStrictEqual(timerPromises, timer.promises)`; the addon publishes
 * `decRefCount` and `TIMEOUT_MAX` and no `promises`, so the shim's guard returns
 * `{}` and both sides are `undefined`. `vacuous-lane.mjs` misses it too, because
 * that lane asks whether the *module* published nothing and `timers` published
 * two things.
 *
 * A file that passes under this passes without the module having supplied the
 * thing it names.
 */
const emptyExports = process.env["NTS_CONFORMANCE_EMPTY_EXPORTS"] === "1";
/** Keep the addon's exported names and destroy their behaviour; see `poison`. */
const mutatedAddon = process.env["NTS_CONFORMANCE_ADDON_MUTATE"] === "1";
/**
 * The second poison, and the one that catches what the first cannot.
 *
 * Poisoning by throwing makes every "this should throw" test pass for the
 * wrong reason -- `test-net-write-arguments.js` asserts that a bad argument
 * throws, and a thrower obliges. This poison returns `undefined` instead, so a
 * test expecting a throw fails and a test expecting a value fails. **A file
 * that survives both poisons did not depend on the module's behaviour at
 * all**, which is the question neither poison answers alone.
 */
const mutatedSilent = process.env["NTS_CONFORMANCE_ADDON_MUTATE"] === "silent";

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

/**
 * Mutation for the compiled lane, because sabotage is not enough there.
 *
 * Blanking a module proves the suite is connected to its subject. It cannot
 * prove that a *passing* file depends on anything the subject does, and on
 * this axis that gap was not hypothetical: `path`'s compiled addon reported
 * two passes, and both were `assert.strictEqual(require('path/posix'),
 * require('path').posix)` holding because each side was `undefined`. The
 * addon published one name and neither side of the comparison was it.
 * Sabotage failed those files -- for the wrong reason, because the subpath
 * stopped resolving -- and so reported a clean hollow count.
 *
 * This keeps the addon's shape and destroys its behaviour: every exported
 * function throws, every exported value becomes a value nothing would expect.
 * A file that still passes did not depend on what the module *does*, which is
 * the question sabotage cannot ask.
 */
/** What a poisoned callable does: refuse loudly, or answer wrongly and quietly. */
function poisonedBody(what) {
  return mutatedSilent
    ? () => undefined
    : () => {
        throw new Error(`poisoned ${what} was called`);
      };
}

function poison(exports) {
  const poisoned = {};
  for (const key of Object.keys(exports)) {
    const value = exports[key];
    if (typeof value === "function") {
      // A class is a function too, and replacing it with a thrower would break
      // `shape.mjs` at load rather than at use -- which reports every file as
      // failing and looks exactly like "no degenerate passes". Keep anything
      // with a populated prototype; its methods are poisoned instead.
      const isClass = value.prototype !== undefined && Object.getOwnPropertyNames(value.prototype).length > 1;
      poisoned[key] = isClass ? poisonClass(value, key) : poisonedBody(`export ${key}`);
    } else if (value !== null && typeof value === "object") {
      // An exported object is a facade: `querystring`'s `shape.mjs` returns
      // `exports.QueryString` and the tests call *its* methods, so leaving it
      // alone let the entire module escape mutation and report four survivors
      // that were an artefact of this function rather than of any test.
      const copy = {};
      for (const inner of Object.keys(value)) {
        const member = value[inner];
        copy[inner] = typeof member === "function" ? poisonedBody(`${key}.${inner}`) : member;
      }
      poisoned[key] = copy;
    } else {
      // Primitives are left alone. Replacing an exported constant breaks the
      // facade at load, and a run where every file fails for that reason is
      // indistinguishable from one where nothing was degenerate.
      poisoned[key] = value;
    }
  }
  return poisoned;
}

/** Same class, every method throwing: the shape survives, the behaviour does not. */
function poisonClass(Class, name) {
  class Poisoned extends Class {}
  for (const method of Object.getOwnPropertyNames(Class.prototype)) {
    if (method === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(Class.prototype, method);
    if (descriptor === undefined || typeof descriptor.value !== "function") continue;
    Object.defineProperty(Poisoned.prototype, method, {
      ...descriptor,
      value: poisonedBody(`${name}.${method}`),
    });
  }
  // Statics too. `Buffer.alloc`, `Buffer.from` and `Buffer.concat` are static,
  // and node's tests reach for them far more often than for instance methods --
  // poisoning only the prototype left forty of `buffer`'s fifty files passing
  // and looked exactly like forty degenerate tests.
  for (const stat of Object.getOwnPropertyNames(Class)) {
    if (stat === "length" || stat === "name" || stat === "prototype") continue;
    const descriptor = Object.getOwnPropertyDescriptor(Class, stat);
    if (descriptor === undefined || typeof descriptor.value !== "function" || !descriptor.writable) {
      continue;
    }
    Object.defineProperty(Poisoned, stat, {
      ...descriptor,
      value: poisonedBody(`${name}.${stat}`),
    });
  }
  Object.defineProperty(Poisoned, "name", { value: Class.name });
  return Poisoned;
}

let underTest;
try {
  let exports;
  if (addon && addon !== "-") {
    exports = createRequire(import.meta.url)(resolvePath(addon));
    if (mutatedAddon || mutatedSilent) exports = poison(exports);
  } else {
    const shims = join(moduleDir, "bindings.node.mjs");
    if (existsSync(shims)) await import(shims);
    hideBindingGlobals();
    exports = await import(join(moduleDir, "src/main.ts"));
    if (mutatedAddon || mutatedSilent) exports = poison(exports);
  }
  // A module may declare canonical web-platform globals its tests need, one
  // name per line in a `globals` file. Declared rather than installed for
  // everyone, because the swap is not free: a canonical `AbortSignal` handed
  // to a *host* function that expects the host's own -- `node:events`'s
  // `listenerCount`, for one -- is not understood, so a module gets this only
  // when its own tests are the reason.
  const globalsPath = join(moduleDir, "globals");
  if (existsSync(globalsPath)) {
    const wanted = readFileSync(globalsPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    // Web-platform source reads its environment slot through a typed native ABI
    // -- `nts_environment_has_platform` and its two siblings -- which compiled
    // code satisfies and a host lane must stand in for. `provider/environment.ts`
    // says so directly: "host-only conformance providers may supply equivalent
    // globals while executing the same source as ordinary JavaScript."
    //
    // Nothing here installs a runtime, and the source is written for that: the
    // `Event` constructor asks before reading, because "an `Event` is built by
    // code that has no idea whether there is one". But *asking* is still a call,
    // and an undefined binding throws where a `false` was wanted. Without these
    // three, `new AbortController().abort()` dies inside `Event` and takes every
    // abort-listener test in `node:events` with it, reported as a listener that
    // was called 0 times -- which names neither the constructor nor the binding.
    if (globalThis.nts_environment_has_platform === undefined) {
      let platform;
      globalThis.nts_environment_install_platform = (runtime) => {
        platform = runtime;
      };
      globalThis.nts_environment_platform = () => platform;
      globalThis.nts_environment_has_platform = () => platform !== undefined;
    }

    for (const name of wanted) {
      if (name === "abort") {
        const abort = await import(join(moduleDir, "../../web-platform/src/core/abort.ts"));
        globalThis.AbortController = abort.AbortController;
        globalThis.AbortSignal = abort.AbortSignal;
      } else if (name === "encoding") {
        const encoding = await import(join(moduleDir, "../../web-platform/src/core/encoding.ts"));
        globalThis.TextEncoder = encoding.TextEncoder;
        globalThis.TextDecoder = encoding.TextDecoder;
      } else {
        throw new Error(`unknown canonical global group in ${globalsPath}: ${name}`);
      }
    }
  }

  const shapePath = join(moduleDir, "shape.mjs");
  let shapeModule = null;
  if (existsSync(shapePath)) {
    const compiledShapeGuard =
      addon && addon !== "-"
        ? registerHooks({
            resolve(specifier, context, nextResolve) {
              const resolved = nextResolve(specifier, context);
              if (/\.[cm]?ts$/.test(new URL(resolved.url).pathname)) {
                throw new Error(
                  "shape.mjs loaded TypeScript source in the compiled lane; expose hidden raw addon exports and shape those instead",
                );
              }
              return resolved;
            },
          })
        : null;
    try {
      // A resolver guard observes imports, re-exports, and transitive static
      // dependencies during module evaluation. Text matching would miss some
      // of those forms and could mistake comments or strings for imports.
      shapeModule = await import(shapePath);
    } finally {
      compiledShapeGuard?.deregister();
    }
  }
  // `emptyExports` blanks what the shim is given, not what the test is given.
  // The shim still runs, its guards still fire, and the test sees whatever a
  // shim produces for a module that published nothing.
  const shapeInput = emptyExports ? {} : { ...exports };
  underTest = shapeModule ? shapeModule.shape(shapeInput) : shapeInput;
  // A subpath can be an exact member of the shaped public object. Passing that
  // object avoids rebuilding a second, merely equal value and losing identity
  // (`require('path/posix') === require('path').posix`). Existing shapers that
  // need only raw exports simply ignore the second argument.
  // `shapeInput`, not `{ ...exports }`, and the same below for internals and
  // test bindings.
  //
  // `emptyExports` used to blank only what `shape()` was given. `subpaths()`,
  // `internals()` and `testBindings()` each received the **real** exports, so a
  // test reaching `internal/async_hooks` saw a fully working module while the
  // public surface was empty -- and passed, and was counted hollow by
  // `axis-controls.mjs` for it. Found by writing a file that exercises the
  // async id stack and having the hollow check flag my own test.
  //
  // The claim this control makes is "a file that passes under this passes
  // without the module having supplied the thing it names", and the facade is
  // the module supplying it.
  const declaredSubpaths = shapeModule?.subpaths?.(shapeInput, underTest) ?? null;
  if (declaredSubpaths !== null) {
    for (const [id, implementation] of Object.entries(declaredSubpaths)) {
      siblings.set(id, sabotaged ? {} : implementation);
    }
  }
  const declaredInternals = shapeModule?.internals?.(shapeInput) ?? null;
  const declaredTestBindings = shapeModule?.testBindings?.(shapeInput) ?? null;
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
  shapeModule?.installGlobals?.(underTest, sabotaged ? {} : exports);
  if (sabotaged && declaredInternals !== null) {
    // Keep the ids resolvable but blank their exports. Dropping the ids makes
    // a test report "needs internal/..." and skip before it reaches the API
    // under test; an empty module instead makes the same access fail, which is
    // the evidence sabotage is meant to collect.
    internals = {};
    for (const id of Object.keys(declaredInternals)) internals[id] = {};
  } else {
    internals = declaredInternals;
  }
  if (sabotaged && declaredTestBindings !== null) {
    subjectTestBindings = {};
    for (const name of Object.keys(declaredTestBindings)) {
      subjectTestBindings[name] = {};
    }
  } else {
    subjectTestBindings = declaredTestBindings;
  }
  uncaughtHandler = sabotaged ? null : (shapeModule?.dispatchUncaught ?? null);

  const usesPath = join(moduleDir, "uses");
  if (existsSync(usesPath)) {
    for (const requestedName of readFileSync(usesPath, "utf8")
      .split("\n")
      .map((l) => l.trim())) {
      if (!requestedName || requestedName.startsWith("#")) continue;
      // A dependency may name one exported subpath. That keeps the bare module
      // available as an independent Node oracle in tests such as
      // `zlib/iter` versus `zlib`, instead of replacing both sides with ours.
      const slash = requestedName.indexOf("/");
      const name = slash === -1 ? requestedName : requestedName.slice(0, slash);
      const requestedSubpath = slash === -1 ? null : requestedName;
      const dir = join(ROOT, "runtime/node", name);
      const siblingShims = join(dir, "bindings.node.mjs");
      if (existsSync(siblingShims)) await import(siblingShims);
      hideBindingGlobals();
      const siblingExports = { ...(await import(join(dir, "src/main.ts"))) };
      const siblingShape = join(dir, "shape.mjs");
      const siblingShapeModule = existsSync(siblingShape) ? await import(siblingShape) : null;
      // Sabotage is specific to the subject module. Its declared dependencies
      // remain intact, otherwise a mixed test can fail while loading a helper
      // or sibling API before it ever observes the empty subject. Such a
      // failure is not evidence that the test measures this module.
      const shaped = siblingShapeModule ? siblingShapeModule.shape(siblingExports) : siblingExports;
      if (requestedSubpath === null) siblings.set(name, shaped);
      const siblingSubpaths = siblingShapeModule?.subpaths?.(siblingExports, shaped) ?? null;
      if (siblingSubpaths !== null) {
        for (const [id, implementation] of Object.entries(siblingSubpaths)) {
          if (requestedSubpath === null || id === requestedSubpath) {
            siblings.set(id, implementation);
          }
        }
      }
      const siblingInternals =
        requestedSubpath === null
          ? (siblingShapeModule?.internals?.(siblingExports) ?? null)
          : null;
      if (siblingInternals !== null) {
        if (internals === null) internals = {};
        for (const [id, implementation] of Object.entries(siblingInternals)) {
          if (!(id in internals)) internals[id] = implementation;
        }
      }
      // A sibling that owns globals has to install them, or the test reaches
      // node's. An `async_hooks` test calling `setImmediate` is the case that
      // found this: it was measuring node's timers and reporting the result as
      // ours, which is a hollow pass the sabotage run cannot catch. Dependency
      // globals are test prerequisites; only the subject's globals are blanked.
      if (requestedSubpath === null) {
        siblingShapeModule?.installGlobals?.(shaped, siblingExports);
      }
    }
  }
} catch (e) {
  // Nothing to run against, so stop here rather than letting the test fail
  // later for a reason that only restates this one.
  report({ kind: "fail", why: `loading the module: ${e?.message ?? e}` });
  hostProcess.exit(0);
}

const realRequire = createRequire(import.meta.url);
const nodeTestRoot = join(ROOT, "third_party/node/test");
const localTestRoot = join(moduleDir, "test");
const hostNodeExecutable = realpathSync(hostProcess.execPath);
const testModuleCache = new Map();
const realChildProcess = realRequire("node:child_process");
const realWorkerThreads = realRequire("node:worker_threads");
const conformanceRunner = join(HERE, "run-one.mjs");
const commonJsWorkerRunner = join(HERE, "run-cjs-worker.mjs");
const declaredChildFixtures = new Set();
const childFixturesPath = join(moduleDir, "child-fixtures");
if (existsSync(childFixturesPath)) {
  for (const childName of readFileSync(childFixturesPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))) {
    const child = resolvePath(nodeTestRoot, childName);
    const withinTestTree = relative(nodeTestRoot, child);
    if (
      withinTestTree.startsWith("..") ||
      isAbsolute(withinTestTree) ||
      !/\.m?js$/.test(child)
    ) {
      throw new Error(`invalid declared child fixture: ${childName}`);
    }
    declaredChildFixtures.add(child);
  }
}

function nodeTestTarget(candidate, cwd) {
  if (typeof candidate !== "string") return null;
  const target = resolvePath(cwd, candidate);
  const withinNodeTests = relative(nodeTestRoot, target);
  const withinLocalTests = relative(localTestRoot, target);
  const belongsToKnownTestTree =
    (!withinNodeTests.startsWith("..") && !isAbsolute(withinNodeTests)) ||
    (!withinLocalTests.startsWith("..") && !isAbsolute(withinLocalTests));
  if (
    !/\.m?js$/.test(target) ||
    (dirname(target) !== dirname(resolvePath(file)) && !declaredChildFixtures.has(target)) ||
    !belongsToKnownTestTree
  ) {
    return null;
  }
  return target;
}

/** Whether a spawn command names this Node binary, directly or through a symlink. */
function isNodeExecutable(command) {
  if (command === hostProcess.execPath) return true;
  if (typeof command !== "string") return false;

  let resolved;
  try {
    resolved = realpathSync(command);
  } catch {
    return false;
  }
  return resolved === hostNodeExecutable;
}

function nestedChildOptions(options) {
  return {
    ...options,
    env: {
      ...(options?.env ?? hostProcess.env),
      NTS_CONFORMANCE_NESTED_CHILD: "1",
    },
  };
}

/**
 * Preserve the subject and Node's per-file test-runner mode when a fixture
 * forks itself, another fixture in the same suite directory, or a JavaScript
 * helper the module explicitly declares in `child-fixtures`.
 *
 * Re-entering this runner prevents two false behaviors at once: the root ESM
 * package cannot reinterpret an upstream CommonJS fixture, and either module
 * mode keeps the implementation under test instead of silently switching to
 * Node's builtin. The explicit manifest keeps unrelated programs on Node's
 * implementation.
 */
function forkInfrastructure(modulePath, argsOrOptions, maybeOptions) {
  const hasArgs = Array.isArray(argsOrOptions);
  const args = hasArgs ? argsOrOptions : [];
  const options = hasArgs ? maybeOptions : argsOrOptions;
  const cwd = typeof options?.cwd === "string" ? options.cwd : hostProcess.cwd();
  const target = nodeTestTarget(modulePath, cwd);

  if (target !== null) {
    return realChildProcess.fork(
      conformanceRunner,
      [moduleName, target, addon ?? "-", ...args],
      nestedChildOptions(options),
    );
  }
  return hasArgs
    ? realChildProcess.fork(modulePath, args, options)
    : realChildProcess.fork(modulePath, options);
}

/** Re-enter this runner when Node is asked to execute this or a sibling fixture. */
function spawnInfrastructure(command, argsOrOptions, maybeOptions) {
  const hasArgs = Array.isArray(argsOrOptions);
  const args = hasArgs ? argsOrOptions : [];
  const options = hasArgs ? maybeOptions : argsOrOptions;
  const cwd = typeof options?.cwd === "string" ? options.cwd : hostProcess.cwd();
  const shellRoute = routedShellSpawn(command, args, options, cwd);
  if (shellRoute !== null) {
    return realChildProcess.spawn(command, shellRoute.args, shellRoute.options);
  }
  const fixtureIndex = args.findIndex((argument) => nodeTestTarget(argument, cwd) !== null);
  const target = nodeTestTarget(args[fixtureIndex], cwd);

  if (
    isNodeExecutable(command) &&
    fixtureIndex >= 0 &&
    target !== null &&
    args
      .slice(0, fixtureIndex)
      .every((argument) => typeof argument === "string" && argument.startsWith("-"))
  ) {
    return realChildProcess.spawn(
      command,
      [
        ...args.slice(0, fixtureIndex),
        conformanceRunner,
        moduleName,
        target,
        addon ?? "-",
        ...args.slice(fixtureIndex + 1),
      ],
      nestedChildOptions(options),
    );
  }
  return hasArgs
    ? realChildProcess.spawn(command, args, options)
    : realChildProcess.spawn(command, options);
}

/** Synchronous counterpart of `spawnInfrastructure`, with identical targeting. */
function spawnSyncInfrastructure(command, argsOrOptions, maybeOptions) {
  const hasArgs = Array.isArray(argsOrOptions);
  const args = hasArgs ? argsOrOptions : [];
  const options = hasArgs ? maybeOptions : argsOrOptions;
  const cwd = typeof options?.cwd === "string" ? options.cwd : hostProcess.cwd();
  const shellRoute = routedShellSpawn(command, args, options, cwd);
  if (shellRoute !== null) {
    return realChildProcess.spawnSync(command, shellRoute.args, shellRoute.options);
  }
  const fixtureIndex = args.findIndex((argument) => nodeTestTarget(argument, cwd) !== null);
  const target = nodeTestTarget(args[fixtureIndex], cwd);

  if (
    isNodeExecutable(command) &&
    fixtureIndex >= 0 &&
    target !== null &&
    args
      .slice(0, fixtureIndex)
      .every((argument) => typeof argument === "string" && argument.startsWith("-"))
  ) {
    return realChildProcess.spawnSync(
      command,
      [
        ...args.slice(0, fixtureIndex),
        conformanceRunner,
        moduleName,
        target,
        addon ?? "-",
        ...args.slice(fixtureIndex + 1),
      ],
      nestedChildOptions(options),
    );
  }
  return hasArgs
    ? realChildProcess.spawnSync(command, args, options)
    : realChildProcess.spawnSync(command, options);
}

/**
 * Locate an environment-quoted `node fixture.js` invocation in a shell command.
 *
 * Node's `escapePOSIXShell` passes interpolated paths through environment
 * variables, conventionally `${ESCAPED_0}` and `${ESCAPED_1}`. Match those
 * references only after their values have independently proved to be this
 * Node executable and a declared test fixture. This keeps routing structural:
 * it does not parse or reinterpret the rest of the caller's shell program.
 */
function routedShellInvocation(command, environment, cwd) {
  if (typeof command !== "string" || environment === undefined) return null;

  const name = "[A-Za-z_][A-Za-z0-9_]*";
  const quotedPair = new RegExp(
    `(\\"\\$(?:\\{(${name})\\}|(${name}))\\") +` + `(\\"\\$(?:\\{(${name})\\}|(${name}))\\")`,
    "g",
  );
  for (const match of command.matchAll(quotedPair)) {
    const nodeName = match[2] ?? match[3];
    const targetName = match[5] ?? match[6];
    if (
      nodeName === undefined ||
      targetName === undefined ||
      !Object.hasOwn(environment, nodeName) ||
      !Object.hasOwn(environment, targetName) ||
      !isNodeExecutable(environment[nodeName]) ||
      nodeTestTarget(environment[targetName], cwd) === null
    ) {
      continue;
    }
    const nodeReference = match[1];
    const targetReference = match[4];
    return {
      invocation: match[0],
      replacement:
        `${nodeReference} "$NTS_CONFORMANCE_RUNNER" ` +
        `"$NTS_CONFORMANCE_MODULE" ${targetReference} ` +
        `"$NTS_CONFORMANCE_ADDON"`,
    };
  }
  return null;
}

/** Add the private routing values without disturbing any caller environment. */
function nestedShellChildOptions(options) {
  const nested = nestedChildOptions(options);
  nested.env.NTS_CONFORMANCE_RUNNER = conformanceRunner;
  nested.env.NTS_CONFORMANCE_MODULE = moduleName;
  nested.env.NTS_CONFORMANCE_ADDON = addon ?? "-";
  return nested;
}

/**
 * Route the command string of an explicit `/bin/sh -c` child.
 *
 * This is deliberately narrower than recognizing arbitrary shells or their
 * options. Node's fixtures use this exact spelling when they need shell state
 * such as `ulimit` around a self-spawn, and the invocation inside the command
 * still has to pass `routedShellInvocation`'s executable and fixture checks.
 */
function routedShellSpawn(command, args, options, cwd) {
  if (command !== "/bin/sh" || args[0] !== "-c") return null;
  const shellCommand = args[1];
  const routed = routedShellInvocation(shellCommand, options?.env, cwd);
  if (routed === null) return null;

  return {
    args: [
      args[0],
      shellCommand.replaceAll(routed.invocation, routed.replacement),
      ...args.slice(2),
    ],
    options: nestedShellChildOptions(options),
  };
}

/** Re-enter the runner for an environment-quoted fixture in a shell pipeline. */
function execInfrastructure(command, optionsOrCallback, maybeCallback) {
  const callbackOnly = typeof optionsOrCallback === "function";
  const options = callbackOnly ? undefined : optionsOrCallback;
  const callback = callbackOnly ? optionsOrCallback : maybeCallback;
  const cwd = typeof options?.cwd === "string" ? options.cwd : hostProcess.cwd();
  const environment = options?.env;
  const routed = routedShellInvocation(command, environment, cwd);

  if (routed !== null) {
    const nested = nestedShellChildOptions(options);
    const rewritten = command.replaceAll(routed.invocation, routed.replacement);
    return callback === undefined
      ? realChildProcess.exec(rewritten, nested)
      : realChildProcess.exec(rewritten, nested, callback);
  }
  if (callbackOnly) return realChildProcess.exec(command, optionsOrCallback);
  if (options === undefined) return realChildProcess.exec(command);
  return callback === undefined
    ? realChildProcess.exec(command, options)
    : realChildProcess.exec(command, options, callback);
}

/** Re-enter the runner for `execFile(process.execPath, [fixture], ...)`. */
function execFileInfrastructure(file, argsOrOptionsOrCallback, optionsOrCallback, maybeCallback) {
  const hasArgs = Array.isArray(argsOrOptionsOrCallback);
  const args = hasArgs ? argsOrOptionsOrCallback : [];
  const second = hasArgs ? optionsOrCallback : argsOrOptionsOrCallback;
  const callbackOnly = typeof second === "function";
  const options = callbackOnly ? undefined : second;
  const callback = callbackOnly ? second : hasArgs ? maybeCallback : optionsOrCallback;
  const cwd = typeof options?.cwd === "string" ? options.cwd : hostProcess.cwd();
  const fixtureIndex = args.findIndex((argument) => nodeTestTarget(argument, cwd) !== null);
  const target = nodeTestTarget(args[fixtureIndex], cwd);

  if (
    isNodeExecutable(file) &&
    fixtureIndex >= 0 &&
    target !== null &&
    args
      .slice(0, fixtureIndex)
      .every((argument) => typeof argument === "string" && argument.startsWith("-"))
  ) {
    const routedArgs = [
      ...args.slice(0, fixtureIndex),
      conformanceRunner,
      moduleName,
      target,
      addon ?? "-",
      ...args.slice(fixtureIndex + 1),
    ];
    const nested = nestedChildOptions(options);
    return callback === undefined
      ? realChildProcess.execFile(file, routedArgs, nested)
      : realChildProcess.execFile(file, routedArgs, nested, callback);
  }

  if (hasArgs) {
    if (callbackOnly) return realChildProcess.execFile(file, args, callback);
    if (options === undefined) {
      return callback === undefined
        ? realChildProcess.execFile(file, args)
        : realChildProcess.execFile(file, args, undefined, callback);
    }
    return callback === undefined
      ? realChildProcess.execFile(file, args, options)
      : realChildProcess.execFile(file, args, options, callback);
  }
  if (callbackOnly) return realChildProcess.execFile(file, callback);
  if (options === undefined) {
    return callback === undefined
      ? realChildProcess.execFile(file)
      : realChildProcess.execFile(file, undefined, callback);
  }
  return callback === undefined
    ? realChildProcess.execFile(file, options)
    : realChildProcess.execFile(file, options, callback);
}

const childProcessInfrastructure = {
  ...realChildProcess,
  exec: execInfrastructure,
  execFile: execFileInfrastructure,
  fork: forkInfrastructure,
  spawn: spawnInfrastructure,
  spawnSync: spawnSyncInfrastructure,
};

/**
 * Keep an explicitly declared CommonJS Worker fixture in CommonJS mode.
 *
 * These Workers are test infrastructure, not another instance of the subject:
 * running the compiled addon in a second Node Environment would claim Worker
 * isolation that its process-wide generated state does not provide. The small
 * runner only restores Node's upstream module mode; the Worker otherwise uses
 * Node's own modules and preserves all constructor options.
 */
class CommonJsFixtureWorker extends realWorkerThreads.Worker {
  constructor(filename, options = {}) {
    const candidate = options.eval === true
      ? null
      : nodeTestTarget(filename, hostProcess.cwd());
    const target = candidate?.endsWith(".js") ? candidate : null;
    if (target === null) {
      super(filename, options);
      return;
    }
    super(commonJsWorkerRunner, {
      ...options,
      workerData: {
        target,
        value: options.workerData,
      },
    });
  }
}

const workerThreadsInfrastructure = {
  ...realWorkerThreads,
  Worker: CommonJsFixtureWorker,
};

// Unix-domain socket paths have a small fixed kernel limit (108 bytes on
// Linux). Node's own common helper therefore makes PIPE relative to cwd; an
// absolute workspace path can exceed the limit before the test adds its own
// suffix. Its process helper receives our routed spawn so declared subject
// fixtures cannot silently fall back to Node's builtin implementation.
const common = makeCommon(
  relative(hostProcess.cwd(), tmpdir.resolve(`node-test.${hostProcess.pid}.sock`)),
  join(ROOT, "third_party/node/test/common"),
  spawnInfrastructure,
);

/** Node's `test/common/countdown`, attached to this runner's call tally. */
class Countdown {
  #remaining;
  #callback;

  constructor(limit, callback) {
    assert.strictEqual(typeof limit, "number");
    assert.strictEqual(typeof callback, "function");
    this.#remaining = limit;
    this.#callback = common.mustCall(callback);
  }

  dec() {
    assert(this.#remaining > 0, "Countdown expired");
    this.#remaining--;
    if (this.#remaining === 0) this.#callback();
    return this.#remaining;
  }

  get remaining() {
    return this.#remaining;
  }
}

// Node's `test/common/gc.onGC`, using the substituted async_hooks export and
// this runner's assertion tally. The weak-map ephemeron is the behavior the
// helper exists to provide: once `target` dies, the AsyncResource becomes
// collectible and its destroy hook calls the listener.
const gcTrackerMap = new WeakMap();
const GC_TRACKER_TAG = "NODE_TEST_COMMON_GC_TRACKER";
function onGC(target, listener) {
  let trackedId;
  let destroyed = false;
  // In the async_hooks lane this helper must use the implementation under
  // test. In every other lane async hooks are test infrastructure: using the
  // subject module here made a net test call `net.createHook()`.
  const asyncHooks = moduleName === "async_hooks" ? underTest : realRequire("node:async_hooks");
  const gcHook = asyncHooks
    .createHook({
      init(id, type) {
        if (trackedId === undefined) {
          assert.strictEqual(type, GC_TRACKER_TAG);
          trackedId = id;
        }
      },
      destroy(id) {
        if (id === trackedId) {
          destroyed = true;
          listener.ongc();
          gcHook.disable();
        }
      },
    })
    .enable();

  gcTrackerMap.set(target, new asyncHooks.AsyncResource(GC_TRACKER_TAG));

  // A finalizer is queued after collection; forcing one collection and then
  // letting the process exit is not enough to give that queue a turn. Node's
  // own helper documents the same requirement. Keep a bounded number of host
  // immediate turns alive and collect again between them. A retained target
  // still fails: only the resource's destroy hook can set `destroyed` and
  // satisfy the test's mustCall expectation.
  let attempts = 0;
  function collectUntilDestroyed() {
    if (destroyed || attempts === 16) return;
    attempts++;
    globalThis.gc();
    hostSetImmediate(collectUntilDestroyed);
  }
  hostSetImmediate(collectUntilDestroyed);
}

// Node's `test/common/gc.checkIfCollectableByCounting`. Unlike `onGC`, this
// helper does not depend on the async-hooks implementation under test: V8
// counts live instances after collecting, and the test's factory reports how
// many it created. Keep the helper here so requiring `common/gc` never falls
// through to Node's copy and silently changes which module its other helpers
// observe.
async function checkIfCollectableByCounting(factory, constructor, count, waitTime = 20) {
  const { queryObjects } = realRequire("node:v8");
  const initialCount = queryObjects(constructor, { format: "count" });
  let totalCreated = 0;

  for (let i = 0; i < count; i++) {
    totalCreated += await factory(i);
    await new Promise((resolve) => hostSetTimeout(resolve, waitTime));
    const currentCount = queryObjects(constructor, { format: "count" });
    if (totalCreated > currentCount - initialCount) return;
  }

  await new Promise((resolve) => hostSetTimeout(resolve, waitTime));
  const currentCount = queryObjects(constructor, { format: "count" });
  if (totalCreated > currentCount - initialCount) return;
  throw new Error(`${constructor.name} cannot be collected`);
}

const commonGc = { onGC, checkIfCollectableByCounting };

/** Node's `test/common/crypto` fact used by metadata/CLI consistency tests. */
const commonCrypto = {
  hasOpenSSL3: Number.parseInt(hostProcess.versions.openssl ?? "0", 10) >= 3,
};

/**
 * Let mixed tests import Node's private binding helper without claiming that
 * those bindings exist. The uv table is test input rather than the subject:
 * it supplies the running platform's exact errno constants for expected-error
 * objects. Any other attempted private lookup remains an explicit skip.
 */
const systemErrors = getSystemErrorMap();
const hostUvBinding = {
  errname(code) {
    try {
      return getSystemErrorName(code);
    } catch {
      return `Unknown system error ${code}`;
    }
  },
  getErrorMessage(code) {
    try {
      return getSystemErrorMessage(code);
    } catch {
      return `Unknown system error ${code}`;
    }
  },
  getErrorMap() {
    return new Map(systemErrors);
  },
};
for (const [code, [name]] of systemErrors) {
  hostUvBinding[`UV_${name}`] = code;
}
Object.freeze(hostUvBinding);
const internalTestBinding = {
  internalBinding(name) {
    const subjectBinding = subjectTestBindings?.[name];
    if (subjectBinding !== undefined) return subjectBinding;
    if (name === "uv") return hostUvBinding;
    throw new Skip(`needs internalBinding(${name})`);
  },
};

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
  const invoke = (fn, args, forcedSkip = false) => {
    testCases.registered++;
    // `test(name, options, fn)` and `test(options, fn)` both carry `skip`.
    const options = args.find((a) => a !== null && typeof a === "object" && !Array.isArray(a));
    if (forcedSkip || options?.skip || options?.todo) testCases.skipped++;
    return fn(...args);
  };
  const count = (fn) => {
    const counted = (...args) => invoke(fn, args);
    Object.assign(counted, fn);
    if (typeof fn.skip === "function") {
      counted.skip = (...args) => invoke(fn.skip, args, true);
    }
    if (typeof fn.todo === "function") {
      counted.todo = (...args) => invoke(fn.todo, args, true);
    }
    if (typeof fn.only === "function") {
      counted.only = (...args) => invoke(fn.only, args);
    }
    return counted;
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

// The same common helper can be required with several equivalent spellings.
// Tests usually say `../common`, while helpers beside it say `./index.js`;
// suffix matching catches only the first spelling and lets the second load
// Node's real common harness, including its process-wide leak checker. Resolve
// first and substitute by identity so recursively loaded helpers stay attached
// to this runner's assertions and infrastructure too.
const testInfrastructure = new Map([
  [join(nodeTestRoot, "common/index.js"), common],
  [join(nodeTestRoot, "common/index.mjs"), common],
  [join(nodeTestRoot, "common/countdown.js"), Countdown],
  [join(nodeTestRoot, "common/gc.js"), commonGc],
  [join(nodeTestRoot, "common/crypto.js"), commonCrypto],
  [join(nodeTestRoot, "common/tmpdir.js"), tmpdir],
  [join(nodeTestRoot, "common/fixtures.js"), fixtures],
  [join(nodeTestRoot, "common/hijackstdio.js"), hijackstdio],
]);

const esmRegistryName = "nts.conformance.esm-modules";
const esmRegistry = new Map();
globalThis[Symbol.for(esmRegistryName)] = esmRegistry;

/** Build one live host-object bridge that both `import` and `require` can use. */
function esmBridgeSource(key, value) {
  const lines = [
    `const value = globalThis[Symbol.for(${JSON.stringify(esmRegistryName)})].get(${JSON.stringify(key)});`,
    "export default value;",
  ];
  let index = 0;
  for (const name of Object.keys(value)) {
    if (name === "default" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
    const local = `binding${index++}`;
    lines.push(`const ${local} = value[${JSON.stringify(name)}];`);
    lines.push(`export { ${local} as ${name} };`);
  }
  return lines.join("\n");
}

/**
 * Install per-process ESM redirects for the subject and Node test helpers.
 *
 * The bridge modules contain no behavior: each exports the exact object the
 * CommonJS shim already exposes. Module hooks are preferable to source
 * rewriting here because `.mjs` ordering and top-level await remain Node's.
 */
function installEsmHooks() {
  const sources = new Map();
  const bareModules = new Map();
  const files = new Map();
  let nextKey = 0;

  const bridge = (label, value) => {
    const key = `${label}:${nextKey++}`;
    const url = `nts-conformance:${encodeURIComponent(key)}`;
    esmRegistry.set(key, value);
    sources.set(url, esmBridgeSource(key, value));
    return url;
  };

  bareModules.set(moduleName, bridge(`module:${moduleName}`, underTest));
  bareModules.set(
    "worker_threads",
    bridge("infrastructure:worker_threads", workerThreadsInfrastructure),
  );
  for (const [name, implementation] of siblings) {
    bareModules.set(name, bridge(`module:${name}`, implementation));
  }
  if (internals !== null) {
    for (const [name, implementation] of Object.entries(internals)) {
      bareModules.set(name, bridge(`internal:${name}`, implementation));
    }
  }
  for (const [path, implementation] of testInfrastructure) {
    files.set(pathToFileURL(path).href, bridge(`test:${path}`, implementation));
  }

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const bare = specifier.replace(/^node:/, "");
      const direct = bareModules.get(bare);
      if (direct !== undefined) {
        if (bare === moduleName || bare.startsWith(`${moduleName}/`)) {
          revealLoadTimeWarnings();
        }
        return { url: direct, format: "module", shortCircuit: true };
      }
      const resolved = nextResolve(specifier, context);
      let infrastructure = files.get(resolved.url);
      // An ESM test can import a CommonJS helper directly. Node's ordinary
      // CJS loader would execute that helper with its real `require`, which
      // silently switches every nested dependency back to the host runtime.
      // Give every imported `.js` helper in Node's test tree the same
      // recursive substitution as a helper reached from a CommonJS test.
      if (infrastructure === undefined && resolved.url.startsWith("file:")) {
        const resolvedPath = fileURLToPath(resolved.url);
        const withinTestTree = relative(nodeTestRoot, resolvedPath);
        if (
          resolvedPath.endsWith(".js") &&
          !withinTestTree.startsWith("..") &&
          !isAbsolute(withinTestTree)
        ) {
          infrastructure = bridge(`test:${resolvedPath}`, executeTestModule(resolvedPath));
          files.set(resolved.url, infrastructure);
        }
      }
      return infrastructure === undefined
        ? resolved
        : { url: infrastructure, format: "module", shortCircuit: true };
    },
    load(url, context, nextLoad) {
      const source = sources.get(url);
      return source === undefined
        ? nextLoad(url, context)
        : { format: "module", source, shortCircuit: true };
    },
  });
}

/** Execute a real ESM test, including its top-level await. */
async function executeEsmTest(modulePath) {
  installEsmHooks();
  await import(pathToFileURL(modulePath).href);
}

function revealLoadTimeWarnings() {
  for (const args of loadTimeWarnings.splice(0)) realEmitWarning(...args);
}

/**
 * The binding surface, reachable and not enumerable.
 *
 * A stand-in installs its bindings with `globalThis.nts_x = ...` -- 339 such
 * assignments across 11 `bindings.node.mjs` files on `main`, counted with `awk`
 * rather than an interactive `grep -c` -- and a plain assignment makes
 * an **enumerable** own property. node's own `test/common/index.js` walks
 * `for (const val in globalThis)` at exit and fails the file with
 * `Unexpected global(s) found: nts_write_stdout, ...`, so any test that reaches
 * the real `common` fails for the scaffolding rather than for the module. Every
 * `.mjs` test does, because `import '../common/index.mjs'` is not substituted,
 * and so does any CJS test requiring `common/child_process`, whose line 5 is
 * `require('./')`.
 *
 * On the compiled lane these names are C externs and not globals at all, so the
 * enumerability is an artefact of this lane and not something the profile
 * publishes. Nothing is hidden from the code under test: `declare function
 * nts_x` resolves exactly as before, the property stays writable and
 * configurable, and only `for...in` and `Object.keys` stop listing it.
 *
 * Which is also the limit of it, and worth knowing before reading a module for a
 * cause: the names are still **there**. Anything walking
 * `Object.getOwnPropertyNames(globalThis)` or `Reflect.ownKeys` sees every one of
 * them, and would fail the same way node's `common` used to, one layer from
 * anything the module did. This makes them invisible to enumeration, not absent.
 *
 * The count was first written here as 350, which is the number in the
 * `nodejs/child-process-wip` worktree: that tree has `child_process`'s 12 and its
 * `tty` stand-in has none, so both trees happen to show 11 files and the totals
 * differ by 11. A number measured in one tree and published in a commit to another
 * is the error, not the arithmetic -- and it is the same shape as the entry in this
 * directory about measuring the wrong tree.
 */
function hideBindingGlobals() {
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (!key.startsWith("nts_")) continue;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor === undefined || !descriptor.enumerable || !descriptor.configurable) continue;
    Object.defineProperty(globalThis, key, { ...descriptor, enumerable: false });
  }
}

function shimmedRequire(id, fromFile) {
  const bare = id.replace(/^node:/, "");
  if (bare === moduleName) {
    revealLoadTimeWarnings();
    return underTest;
  }
  if (bare.startsWith(`${moduleName}/`)) {
    if (siblings.has(bare)) return siblings.get(bare);
    const half = bare.slice(moduleName.length + 1);
    if (half in underTest && underTest[half]) return underTest[half];
    throw new Skip(`needs ${id}`);
  }
  if (bare === "assert" || bare === "assert/strict") return assert;
  if (bare === "test" || bare === "node:test") return countingTestRunner();
  if (bare === "child_process") return childProcessInfrastructure;
  if (bare === "worker_threads") return workerThreadsInfrastructure;
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
  if (bare === "internal/test/binding") return internalTestBinding;
  if (id.endsWith("../common")) return common;
  if (id.endsWith("common/countdown")) return Countdown;
  if (id.endsWith("common/gc")) return commonGc;
  if (id.endsWith("common/crypto")) return commonCrypto;
  if (id.endsWith("common/tmpdir")) return tmpdir;
  if (id.endsWith("common/fixtures")) return fixtures;
  if (id.endsWith("common/hijackstdio")) return hijackstdio;
  // Dedicated subsystem suites keep shared helpers beside their tests. Load
  // those helpers through this same CommonJS shim so a helper's
  // `require('async_hooks')` reaches the implementation under test rather than
  // silently switching back to Node's builtin module.
  const isPathRequest =
    id === "." ||
    id === ".." ||
    id.startsWith("./") ||
    id.startsWith("../") ||
    isAbsolute(id);
  if (isPathRequest) {
    const localRequire = createRequire(fromFile);
    let resolved = null;
    try {
      resolved = localRequire.resolve(id);
    } catch {
      // Let the ordinary infrastructure fallback below try its own spelling.
    }
    if (resolved !== null) {
      const infrastructure = testInfrastructure.get(resolved);
      if (infrastructure !== undefined) return infrastructure;
      if (resolved.startsWith(`${nodeTestRoot}/`) && resolved.endsWith(".js")) {
        return executeTestModule(resolved);
      }
      // Resolution succeeded, so any error here came from evaluating the
      // module and must reach the test rather than be mistaken for a miss.
      return localRequire(id);
    }
  }
  // Anything else is infrastructure rather than the subject: `node:test` is a
  // test runner, `child_process` spawns, `util` formats. Node's own is the
  // right answer for those -- substituting ours would test ours. A module we
  // do not have is a skip, and the reason names it.
  for (const candidate of [id, bare]) {
    let resolved = false;
    try {
      realRequire.resolve(candidate);
      resolved = true;
    } catch {
      // Try the next spelling only when this spelling cannot be resolved.
    }
    if (resolved) {
      // Evaluation is deliberately outside the resolution catch. An
      // infrastructure module that throws while loading has failed the test;
      // it is not a missing module and must not be loaded a second time.
      return realRequire(candidate);
    }
  }
  throw new Skip(`needs ${id}`);
}

/** Execute one Node test/helper as CommonJS with recursive module substitution. */
function executeTestModule(modulePath) {
  const cached = testModuleCache.get(modulePath);
  if (cached !== undefined) return cached.exports;

  const loaded = { exports: {} };
  testModuleCache.set(modulePath, loaded);
  try {
    const run = new Function(
      // Globals are deliberately absent from the parameter list. Node's real
      // CommonJS wrapper receives only these five values; `process`, `global`,
      // `globalThis`, and `console` are ordinary global lookups. Besides being
      // faithful, this lets a test declare a local binding such as
      // `const process = require('node:process')` without a false duplicate-
      // declaration syntax error.
      "require",
      "module",
      "exports",
      "__filename",
      "__dirname",
      `${readFileSync(modulePath, "utf8")}\n//# sourceURL=${pathToFileURL(modulePath).href}`,
    );
    const localRequire = createRequire(modulePath);
    const requireFromHere = (id) => shimmedRequire(id, modulePath);
    requireFromHere.resolve = localRequire.resolve.bind(localRequire);
    run.call(
      loaded.exports,
      requireFromHere,
      loaded,
      loaded.exports,
      modulePath,
      dirname(modulePath),
    );
    return loaded.exports;
  } catch (error) {
    testModuleCache.delete(modulePath);
    throw error;
  }
}

try {
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
  // Not awaited, and that is the point: an `await` here put a promise
  // continuation immediately after the test body, and a test that had enabled
  // promise hooks saw it. Node runs these files as CommonJS with nothing of
  // its own outstanding, so there is no such promise to see. Everything after
  // the body therefore happens inside this callback, and the harness owns no
  // promise while the test is running.
  hostSetImmediate(() => {
    if (file.endsWith(".mjs")) {
      executeEsmTest(file).then(
        () => judgeWhenQuiet(),
        (error) => {
          if (error instanceof Skip || error?.name === "Skip") {
            reportFailure(error);
          } else if (!dispatchEscapedException(error)) {
            reportFailure(error);
          } else {
            judgeWhenQuiet();
          }
        },
      );
      return;
    }
    try {
      // `globalThis.process`, not the captured one: node hands the CJS wrapper
      // the real global, so when `node:process` has installed itself the test
      // must see the installed object under both names.
      // Node's CommonJS loader invokes the wrapper with `module.exports` as
      // its receiver. That is observable from a top-level arrow function,
      // which captures `this`; calling the wrapper as a plain function made
      // those arrows capture `undefined` instead of the exports object.
      executeTestModule(file);
    } catch (e) {
      // A module that owns uncaught-exception dispatch gets first refusal.
      //
      // Node's runtime hands an escaped exception to `process`, which runs a
      // capture callback or emits `uncaughtException`; a program with either
      // of those carries on. Catching it here and reporting a failure would
      // make every such test fail for the one reason the test is about. Only
      // a module that declares the hook can claim one -- for everything else
      // an escaped exception is exactly the failure it looks like.
      if (!dispatchEscapedException(e)) {
        reportFailure(e);
        return;
      }
    }
    judgeWhenQuiet();
  });
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
    why:
      (e?.message ?? String(e))
        .split("\n")
        .find((l) => l.trim())
        ?.trim() ?? "",
    // The message and the frames that are ours. Node's own frames and the
    // harness's are noise; the test file and the module under test are not.
    detail: [
      (e?.message ?? String(e)).split("\n").slice(0, 16).join("\n"),
      // Our frames, the test file's, and the anonymous ones -- a test runs
      // inside `new Function`, so its own frames are `<anonymous>` with a line
      // number two off the file's, which is still the fastest way to find the
      // assertion that failed.
      ...(e?.stack ?? "")
        .split("\n")
        .filter(
          (l) =>
            l.includes("/runtime/node/") ||
            l.includes("/test/parallel/") ||
            l.includes("<anonymous"),
        )
        .slice(0, 8),
    ].join("\n"),
  });
}
