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
  instance.hrtime.bigint = exports._hrtimeBigInt;
  instance.memoryUsage.rss = exports._memoryUsageRss;

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
