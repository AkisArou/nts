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
  const posix = pathVariant(exports);
  const win32 = exports.win32 ? pathVariant(exports.win32) : undefined;

  // These final four assignments follow `lib/path.js`'s CommonJS insertion
  // order. In particular `win32` precedes the self-referential `posix` key,
  // while the legacy `_makeLong` alias is last.
  posix.win32 = win32;
  posix.posix = posix;
  posix._makeLong = exports._makeLong;
  if (win32) {
    win32.win32 = win32;
    win32.posix = posix;
    win32._makeLong = exports.win32._makeLong;
  }
  return posix;
}

/** The documented operations in the order Node installs them.
 *
 * `sep` and `delimiter` come from the module, not from this file.
 *
 * They were literals here -- `pathVariant(exports, "/", ":")` -- and the module
 * exports both, so every test that read `path.sep` was reading a constant
 * *this shim* supplied. `posix.ts` could have said `sep = "\\"` and nothing in
 * node's suite could have failed: the value under test never reached the
 * object the tests see. That is the `bindings.node.mjs` blind spot in a
 * different file, and it is worse here because a shape shim is supposed to add
 * shape and no behaviour.
 *
 * No fallback to a literal. A module that does not export `sep` should fail
 * loudly rather than be handed the right answer by its own harness. */
function pathVariant(exports) {
  const { sep, delimiter } = exports;
  return {
    resolve: exports.resolve,
    normalize: exports.normalize,
    isAbsolute: exports.isAbsolute,
    join: exports.join,
    relative: exports.relative,
    toNamespacedPath: exports.toNamespacedPath,
    dirname: exports.dirname,
    basename: exports.basename,
    extname: exports.extname,
    format: exports.format,
    parse: exports.parse,
    matchesGlob: exports.matchesGlob,
    sep,
    delimiter,
  };
}

/** The two documented module subpaths are the exact shaped namespace values. */
export function subpaths(_exports, shaped) {
  return {
    "path/posix": shaped.posix,
    "path/win32": shaped.win32,
  };
}
