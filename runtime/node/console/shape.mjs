// What node's tests see as `require('console')`.
//
// The module *is* the global console object, with the constructor hung off it
// -- `require('console').Console` and `console.Console` are the same function,
// and `require('console') === globalThis.console` is asserted by node's own
// test-console-instance.js.
export function shape(exports) {
  const underTest = exports.globalConsole ?? exports.default;

  // TypeScript fields are enumerable data properties. Node keeps these
  // Console implementation details off the enumerable module namespace.
  for (const name of [
    "_stdout",
    "_stderr",
    "_ignoreErrors",
    "_stdoutErrorHandler",
    "_stderrErrorHandler",
    "_times",
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(underTest, name);
    if (descriptor !== undefined) {
      Object.defineProperty(underTest, name, {
        ...descriptor,
        enumerable: false,
      });
    }
  }

  return underTest;
}

/**
 * `console` is a global as well as a module, and a test that compares the two
 * is testing that fact. Without this the comparison sees node's console on one
 * side and ours on the other and fails for a reason that is about the harness.
 */
export function installGlobals(underTest) {
  globalThis.console = underTest;
}

/**
 * Node files `formatTime` under `internal/util/debuglog`, because `debuglog`
 * and `console.time` print durations the same way. Ours is in
 * `runtime/node/internal/time.ts` and re-exported here; the test that checks
 * it runs with `--expose-internals` and asks for it by node's path.
 */
export function internals(exports) {
  return { "internal/util/debuglog": { formatTime: exports.formatTime } };
}
