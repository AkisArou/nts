// The object node's tests see as `require('process')`, and the global.
//
// Node's `process` is a global first and a module second -- `require('process')
// === globalThis.process` is true, and almost every test uses the global. So
// the same object has to be both, or a test that sets `process.exitCode` on one
// and reads it from the other sees two different answers.

export function shape(exports) {
  const instance = exports.default ?? exports.process;

  // These operations are implemented and typed in resources.ts. Only their
  // unusual CommonJS location -- a property of another function -- belongs in
  // this public-object shape layer.
  // A compiled module may not publish the instance yet, and when it does not,
  // the rest of what it publishes is still real.
  //
  // This used to `return {}`, on the ground that the compiled `process`
  // publishes `env` and that the environment was therefore reachable even with
  // no instance. **That was measured and it was wrong, 2026-09-24.**
  //
  // `env` was published as a *name* and its value was `undefined`. The sentence
  // that stood here -- "105 keys, all matching node" -- is a claim about the
  // value, and nothing had ever read the value: `Object.keys(require(...))`
  // answers `["env"]` either way, and `hidden-exports.mjs` asks about presence.
  // So every test reading `process.env.PATH` got a `TypeError` on `undefined`
  // rather than a missing export it could report, which is the
  // present-and-throwing failure `querystring/shape.mjs` records four
  // occurrences of.
  //
  // The cause was in the backend, not here: `env` is written by `module#init`,
  // and `module#init` is refused with
  // `NTS2009 ... because it calls EventEmitter#on`. The napi wrapper published
  // the name anyway, because its guard against exactly this consulted what
  // *lowering* refused and a backend cascade is a different list. Fixed there,
  // so `process` now publishes **nothing** and says why -- which is the honest
  // answer and the one a reader can act on.
  //
  // The early exit below therefore does hand back an empty object today. That
  // is not this file's bug to fix: it is `module#init`'s cascade, and the
  // sentence to keep is that a shape must not assert a value it never read.
  //
  // `stream/shape.mjs` carries the same correction, and `os/shape.mjs` records
  // the throwing version of it: "a shape that throws on a missing export
  // reports one fact about the addon and hides seven." The guard is right and
  // its scope was wrong -- it did not distinguish "cannot build the public
  // object" from "cannot build any of it".
  //
  // The wiring below genuinely needs the instance, so the early exit stays and
  // hands back the published names instead of nothing. `installGlobals` then
  // installs that partial object, which is strictly more than the empty one it
  // installed before.
  if (instance === undefined) {
    const partial = {};
    for (const [name, value] of Object.entries(exports)) {
      if (name === "default" || name === "process") continue;
      partial[name] = value;
    }
    return partial;
  }
  if (instance.hrtime !== undefined) {
    instance.hrtime.bigint = exports._hrtimeBigInt;
  }
  if (instance.memoryUsage !== undefined) {
    instance.memoryUsage.rss = exports._memoryUsageRss;
  }

  // The class's members, promoted to own enumerable properties of the instance.
  //
  // Node's `process` carries `title`, `ppid`, `stdin`, `exitCode` and `_exiting`
  // as its own keys; ours held them on `Process.prototype`, so `Object.keys`,
  // spread, `JSON.stringify` and `assert.deepStrictEqual` all saw five fewer
  // properties than node's. `stream/shape.mjs` carries the same correction for
  // its class facades.
  //
  // Blanket, and measured before it was written: `Process.prototype` has exactly
  // five members and node has own-enumerable versions of all five, so nothing is
  // promoted that node does not have. The descriptor is carried across as it is,
  // accessors included, so a getter still runs with the instance as its receiver.
  const prototype = Object.getPrototypeOf(instance);
  if (prototype !== null && prototype !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === "constructor") continue;
      if (Object.prototype.hasOwnProperty.call(instance, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (descriptor === undefined) continue;
      Object.defineProperty(instance, key, { ...descriptor, enumerable: true });
    }
  }

  // `Object.prototype.toString.call(process)` is `"[object process]"` on node.
  // Its descriptor differs from `console`'s in both directions -- writable and
  // *non*-configurable, where console's is non-writable and configurable -- so
  // the two were read off node separately rather than shaped with one idiom.
  Object.defineProperty(instance, Symbol.toStringTag, {
    value: "process",
    writable: true,
    enumerable: false,
    configurable: false,
  });

  return instance;
}

export function installGlobals(underTest) {
  globalThis.process = underTest;
}

/**
 * Give the process under test an exception that escaped the test body.
 *
 * The runtime is what does this in a real program: the stack unwinds to the
 * top, and whatever is driving the loop hands the exception to `process`.
 * Nothing else can -- by the time the exception is loose, the frame that could
 * have caught it is gone. So the runner stands in for the runtime here, as it
 * does for the event loop everywhere else, and this says how.
 *
 * Returns whether it was handled. False means nothing was listening, and the
 * runner should report it as the failure it is.
 */
export function dispatchUncaught(underTest, error) {
  return underTest._fatalException(error);
}
