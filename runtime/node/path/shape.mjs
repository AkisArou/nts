// The object node's tests see as `require('path')`.
//
// Node's `path` *is* the platform's half: `path.posix === path` on a posix
// host, a self-reference the tests check with `assert.strictEqual`. So this
// builds one object from the flat exports and points `posix` at it, rather
// than at a copy -- a copy is deep-equal and fails reference equality, which
// is what `test-path.js` asserts.
//
// It adds shape and no behaviour: nothing here answers a question the
// implementation cannot.
export function shape(exports) {
  const { posix: _posix, win32: win32Exports, ...flat } = exports;

  const posix = { ...flat, sep: "/", delimiter: ":" };
  const win32 = win32Exports ? { ...win32Exports, sep: "\\", delimiter: ";" } : undefined;

  posix.posix = posix;
  posix.win32 = win32;
  if (win32) {
    win32.win32 = win32;
    win32.posix = posix;
  }
  return posix;
}

/** The two documented module subpaths are the exact shaped namespace values. */
export function subpaths(_exports, shaped) {
  return {
    "path/posix": shaped.posix,
    "path/win32": shaped.win32,
  };
}
