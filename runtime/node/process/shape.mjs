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
  // This used to `return {}`. The compiled `process` publishes **`env` and
  // nothing else** -- 105 keys, all matching node -- and neither `default` nor
  // `process` is published, so the shape handed back an empty object and the
  // environment was unreachable from every test. `hidden-exports.mjs` reported
  // it as `NOT PUBLIC env: object`, which is what that instrument is for.
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
