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
import { join, dirname, isAbsolute, relative, resolve as resolvePath } from "node:path";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert";
import process from "node:process";
import {
  getSystemErrorMap,
  getSystemErrorMessage,
  getSystemErrorName,
} from "node:util";
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
  const line = `${JSON.stringify(result)}\n`;
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
      detail: missed.map((pendingCall) =>
        `${pendingCall.name}: ${pendingCall.actual}/${pendingCall.expected}` +
        (pendingCall.registeredAt === undefined ? "" : ` ${pendingCall.registeredAt.trim()}`),
      ).join("\n"),
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
    if (peekPending().length > 0 && rounds < SETTLE_ROUNDS) return;
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
  let shapeModule = null;
  if (existsSync(shapePath)) {
    const compiledShapeGuard = addon && addon !== "-"
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
  underTest = shapeModule ? shapeModule.shape({ ...exports }) : { ...exports };
  const declaredSubpaths = shapeModule?.subpaths?.({ ...exports }) ?? null;
  if (declaredSubpaths !== null) {
    for (const [id, implementation] of Object.entries(declaredSubpaths)) {
      siblings.set(id, sabotaged ? {} : implementation);
    }
  }
  const declaredInternals = shapeModule?.internals?.({ ...exports }) ?? null;
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
  uncaughtHandler = sabotaged ? null : (shapeModule?.dispatchUncaught ?? null);

  const usesPath = join(moduleDir, "uses");
  if (existsSync(usesPath)) {
    for (const requestedName of readFileSync(usesPath, "utf8").split("\n").map((l) => l.trim())) {
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
      const siblingExports = { ...(await import(join(dir, "src/main.ts"))) };
      const siblingShape = join(dir, "shape.mjs");
      const siblingShapeModule = existsSync(siblingShape) ? await import(siblingShape) : null;
      // Sabotage is specific to the subject module. Its declared dependencies
      // remain intact, otherwise a mixed test can fail while loading a helper
      // or sibling API before it ever observes the empty subject. Such a
      // failure is not evidence that the test measures this module.
      const shaped = siblingShapeModule
        ? siblingShapeModule.shape(siblingExports)
        : siblingExports;
      if (requestedSubpath === null) siblings.set(name, shaped);
      const siblingSubpaths = siblingShapeModule?.subpaths?.(siblingExports) ?? null;
      if (siblingSubpaths !== null) {
        for (const [id, implementation] of Object.entries(siblingSubpaths)) {
          if (requestedSubpath === null || id === requestedSubpath) {
            siblings.set(id, implementation);
          }
        }
      }
      const siblingInternals = requestedSubpath === null
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

// Unix-domain socket paths have a small fixed kernel limit (108 bytes on
// Linux). Node's own common helper therefore makes PIPE relative to cwd; an
// absolute workspace path can exceed the limit before the test adds its own
// suffix.
const common = makeCommon(
  relative(hostProcess.cwd(), tmpdir.resolve(`node-test.${hostProcess.pid}.sock`)),
  join(ROOT, "third_party/node/test/common"),
);
const realRequire = createRequire(import.meta.url);
const nodeTestRoot = join(ROOT, "third_party/node/test");
const testModuleCache = new Map();

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
  const asyncHooks = moduleName === "async_hooks"
    ? underTest
    : realRequire("node:async_hooks");
  const gcHook = asyncHooks.createHook({
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
  }).enable();

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
      const infrastructure = files.get(resolved.url);
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
  if (id.startsWith("./") || id.startsWith("../") || isAbsolute(id)) {
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
      "require", "module", "exports", "__filename", "__dirname",
      readFileSync(modulePath, "utf8"),
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
          } else if (!uncaughtHandler?.(underTest, error)) {
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
      if (!uncaughtHandler?.(underTest, e)) {
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
