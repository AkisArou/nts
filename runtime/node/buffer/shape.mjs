// The object node's tests see as `require('buffer')`.
//
// Node's module exports `Buffer` alongside `kMaxLength`, `constants`, `atob`,
// `btoa` and the rest; the class itself is one property, not the module.
export function shape(exports) {
  const mod = { ...exports };
  delete mod.default;
  mod.Buffer = callableBuffer(exports.Buffer);
  return mod;
}

/**
 * `Buffer` is callable with and without `new`, and both are deprecated.
 *
 * `Buffer(10)` and `new Buffer(10)` both mean `Buffer.alloc(10)`, and
 * `Buffer("ab")` means `Buffer.from("ab")`. A class constructor cannot be
 * called without `new`, so the export is a function that dispatches -- the
 * same shape `Console` and `Assert` need, and for the same reason.
 *
 * It lives here rather than in the TypeScript because a module cannot export a
 * callable class, and because the deprecated form is a compatibility surface
 * rather than something a compiled program should carry.
 */
function callableBuffer(Buffer) {
  const legacy = function Buffer_(value, encodingOrOffset, length) {
    return typeof value === "number"
      ? Buffer.alloc(value)
      : Buffer.from(value, encodingOrOffset, length);
  };
  Object.setPrototypeOf(legacy, Buffer);
  legacy.prototype = Buffer.prototype;
  Object.defineProperty(legacy, "name", { value: "Buffer" });
  return legacy;
}

// No `installGlobals` here, deliberately, though `Buffer` is a global as well
// as an export. Substituting it changes what *node's own modules* do: `fs`,
// `util.inspect` and the test harness all reach for the global, and none of
// them accepts ours. Tried, and it took buffer from 49 passing to 15. The cost
// is that a test writing `Buffer.concat(...)` unqualified measures node's
// Buffer against our `kMaxLength`, which is a statement about neither; those
// are listed as failures rather than papered over.

export function installGlobals(underTest) {
  globalThis.Buffer = underTest.Buffer;
}
