// The object node's tests see as `require('fs')`.
export function shape(exports) {
  const module = { ...exports };
  module.Stats = callableStats(exports.Stats);
  module.ReadStream = callableReadStream(exports.ReadStream);
  module.WriteStream = callableWriteStream(exports.WriteStream);
  // Function properties are a Node compatibility shape. The ordinary
  // realpath functions walk components in TypeScript; only `.native` takes
  // libuv's direct resolver.
  module.realpath.native = exports._realpathNative;
  module.realpathSync.native = exports._realpathSyncNative;
  delete module._realpathNative;
  delete module._realpathSyncNative;
  return module;
}

/** `node:fs/promises` is the exact same namespace exposed as `fs.promises`. */
export function subpaths(exports) {
  return { "fs/promises": exports.promises };
}

/**
 * `fs.Stats` predates classes and remains callable with or without `new`, even
 * though direct construction is deprecated. The typed implementation remains
 * a class; this wrapper supplies only the legacy CommonJS constructor shape.
 */
function callableStats(Implementation) {
  let warned = false;
  function Stats(...columns) {
    if (!warned) {
      warned = true;
      process.emitWarning(
        "fs.Stats constructor is deprecated.",
        "DeprecationWarning",
        "DEP0180",
      );
    }
    return new Implementation(columns);
  }
  Object.setPrototypeOf(Stats, Implementation);
  Stats.prototype = Implementation.prototype;
  return Stats;
}

/**
 * Node's historical stream constructors are functions: each is callable both
 * with and without `new`.  TypeScript classes deliberately are not callable,
 * so this compatibility-only distinction belongs in the public-object shape
 * rather than in the typed stream implementation.
 *
 * Sharing the implementation's prototype preserves `instanceof` in both
 * directions.  Inheriting from the implementation constructor preserves the
 * static side of the `Readable`/`Writable` subclass.
 */
function callableReadStream(Implementation) {
  function ReadStream(path, options) {
    return new Implementation(path, options);
  }
  Object.setPrototypeOf(ReadStream, Implementation);
  ReadStream.prototype = Implementation.prototype;
  return ReadStream;
}

function callableWriteStream(Implementation) {
  function WriteStream(path, options) {
    return new Implementation(path, options);
  }
  Object.setPrototypeOf(WriteStream, Implementation);
  WriteStream.prototype = Implementation.prototype;
  return WriteStream;
}
