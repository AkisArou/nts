// The object node's tests see as `require('zlib')`.
//
// `codes` and `constants` are defined read-only rather than copied, because
// node's are and its test checks: `zlib.codes = {}` has to throw, not just
// `zlib.codes.Z_OK = 1`. A table describing a file format is not something a
// program should be able to replace.
export function shape(exports) {
  const zlib = { ...exports };
  const codes = Object.freeze({ ...exports.codes });
  delete zlib.default;
  delete zlib.iter;
  for (const name of ["codes", "constants"]) {
    Object.defineProperty(zlib, name, {
      value: name === "codes" ? codes : exports.constants,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return zlib;
}

export function subpaths(exports) {
  return { "zlib/iter": exports.iter };
}
