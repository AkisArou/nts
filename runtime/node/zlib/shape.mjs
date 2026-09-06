// The object node's tests see as `require('zlib')`.

// These nine constructors predate classes and remain callable without `new`.
// Keep that legacy function-object shape out of the typed implementation: the
// compression classes themselves are ordinary static classes, and this Node
// facade is the only place that needs prototypes, function metadata, and
// `new.target`.
const legacyConstructorNames = [
  "Deflate",
  "Inflate",
  "Gzip",
  "Gunzip",
  "DeflateRaw",
  "InflateRaw",
  "Unzip",
  "BrotliCompress",
  "BrotliDecompress",
];

const implementationExportNames = [
  "Brotli",
  "Zlib",
  "ZlibBase",
  "ZlibError",
  "Zstd",
];

const factoryNames = [
  "createBrotliCompress",
  "createBrotliDecompress",
  "createDeflate",
  "createDeflateRaw",
  "createGunzip",
  "createGzip",
  "createInflate",
  "createInflateRaw",
  "createUnzip",
  "createZstdCompress",
  "createZstdDecompress",
];

let instantiationWarningEmitted = false;

function callableConstructor(Implementation, name) {
  const callable = function (...args) {
    if (new.target === undefined) {
      // Node deduplicates deprecation warnings by code. DEP0184 belongs only
      // to these zlib constructors, so all nine wrappers share one flag.
      if (!instantiationWarningEmitted) {
        instantiationWarningEmitted = true;
        process.emitWarning(
          `Instantiating ${name} without the 'new' keyword has been deprecated.`,
          "DeprecationWarning",
          "DEP0184",
          callable,
        );
      }
      return new Implementation(...args);
    }
    return Reflect.construct(
      Implementation,
      args,
      new.target === callable ? Implementation : new.target,
    );
  };
  Object.setPrototypeOf(callable, Implementation);
  callable.prototype = Implementation.prototype;
  Object.defineProperties(callable, {
    length: { value: 1, configurable: true },
    name: { value: name, configurable: true },
  });
  Implementation.prototype.constructor = callable;
  return callable;
}
//
// `codes` and `constants` are defined read-only rather than copied, because
// node's are and its test checks: `zlib.codes = {}` has to throw, not just
// `zlib.codes.Z_OK = 1`. A table describing a file format is not something a
// program should be able to replace.
export function shape(exports) {
  const zlib = { ...exports };
  for (const name of legacyConstructorNames) {
    zlib[name] = callableConstructor(exports[name], name);
  }
  for (const name of implementationExportNames) delete zlib[name];
  for (const name of factoryNames) {
    Object.defineProperty(zlib, name, {
      value: exports[name],
      enumerable: true,
      writable: false,
      configurable: true,
    });
  }
  const constants = Object.create(null);
  for (const [name, value] of Object.entries(exports.constants)) {
    if (name === "codes") continue;
    Object.defineProperty(constants, name, { value, enumerable: true });
  }
  const codes = Object.freeze({ ...exports.codes });
  delete zlib.default;
  delete zlib.iter;
  delete zlib.zlibCodeForStatus;
  for (const name of ["codes", "constants"]) {
    Object.defineProperty(zlib, name, {
      value: name === "codes" ? codes : constants,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  for (const [name, value] of Object.entries(constants)) {
    if (name.startsWith("BROTLI")) continue;
    Object.defineProperty(zlib, name, { value });
  }
  return zlib;
}

export function subpaths(exports) {
  return { "zlib/iter": exports.iter };
}
