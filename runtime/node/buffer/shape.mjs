// The object node's tests see as `require('buffer')`.
//
// Node's module exports `Buffer` alongside `kMaxLength`, `constants`, `atob`,
// `btoa` and the rest; the class itself is one property, not the module.

export function shape(exports) {
  const mod = { ...exports };
  delete mod.default;
  delete mod._createBlobFromExternalSource;
  return mod;
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
