// The object node's tests see as `require('buffer')`.
//
// Node's module exports `Buffer` alongside `kMaxLength`, `constants`, `atob`,
// `btoa` and the rest; the class itself is one property, not the module.

export function shape(exports) {
  // ESM namespace keys are sorted. Node's CommonJS module is populated in
  // this insertion order, so spell out the public surface instead of leaking
  // the namespace object's unrelated ordering into `Object.keys(buffer)`.
  const mod = {
    Buffer: exports.Buffer,
    SlowBuffer: exports.SlowBuffer,
    transcode: exports.transcode,
    isUtf8: exports.isUtf8,
    isAscii: exports.isAscii,
    kMaxLength: exports.kMaxLength,
    kStringMaxLength: exports.kStringMaxLength,
    btoa: exports.btoa,
    atob: exports.atob,
    constants: exports.constants,
    INSPECT_MAX_BYTES: exports.INSPECT_MAX_BYTES,
    Blob: exports.Blob,
    resolveObjectURL: exports.resolveObjectURL,
    File: exports.File,
  };

  // Class syntax makes methods non-enumerable. Node installs Buffer's public
  // operations with ordinary assignments, so its static and prototype
  // operations are enumerable. Keep that host-object representation here;
  // the typed implementation does not depend on descriptors.
  makePropertiesEnumerable(mod.Buffer, ["length", "name", "prototype"]);
  makePropertiesEnumerable(mod.Buffer.prototype, ["constructor"]);

  return mod;
}

function makePropertiesEnumerable(target, excluded) {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (excluded.includes(name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (descriptor !== undefined && !descriptor.enumerable) {
      Object.defineProperty(target, name, { ...descriptor, enumerable: true });
    }
  }
}

// `Buffer` is installed as a global, and the pass count argues against it while
// the hollow count argues for it -- which is the whole reason the hollow count
// exists.
//
// Substituting it does change what *node's own modules* do: `fs`,
// `util.inspect` and the test harness all reach for the global and none of
// them accepts ours, so a number of files fail that would otherwise pass.
// Removing it takes this module from 33 passing to 54.
//
// Those 54 include **46 hollow**. Without the global, a test writing
// `Buffer.alloc(...)` unqualified gets node's Buffer and never touches ours at
// all -- it passes, and it measures nothing. Real coverage is 32 with the
// global and 8 without it. The higher number is the worse measurement by a
// factor of four.
//
// Measured in both directions, and the sabotage run is the only thing that
// could tell them apart. An earlier version of this comment said there was no
// `installGlobals` here, directly above one; going by that comment and the
// pass count alone, removing it looked like a twenty-one file win.

export function installGlobals(underTest) {
  globalThis.Buffer = underTest.Buffer;
  globalThis.Blob = underTest.Blob;
  globalThis.File = underTest.File;
  globalThis.atob = underTest.atob;
  globalThis.btoa = underTest.btoa;
}
