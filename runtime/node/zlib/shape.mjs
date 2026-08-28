// The object node's tests see as `require('zlib')`.
//
// `codes` and `constants` are defined read-only rather than copied, because
// node's are and its test checks: `zlib.codes = {}` has to throw, not just
// `zlib.codes.Z_OK = 1`. A table describing a file format is not something a
// program should be able to replace.
export function shape(exports) {
  const zlib = { ...exports };
  delete zlib.default;
  for (const name of ["codes", "constants"]) {
    Object.defineProperty(zlib, name, {
      value: exports[name],
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return zlib;
}
