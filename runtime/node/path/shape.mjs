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
  const posix = pathVariant(exports, "/", ":");
  const win32 = exports.win32 ? pathVariant(exports.win32, "\\", ";") : undefined;

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

/** The documented operations in the order Node installs them. */
function pathVariant(exports, sep, delimiter) {
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
