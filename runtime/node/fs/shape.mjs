// The object node's tests see as `require('fs')`.

// `lib/fs.js` populates a CommonJS object in this order. The typed build is an
// ESM namespace, whose keys are sorted, so a spread has the right values but
// the wrong public enumeration order.
const publicExportNames = [
  "appendFile",
  "appendFileSync",
  "access",
  "accessSync",
  "chown",
  "chownSync",
  "chmod",
  "chmodSync",
  "close",
  "closeSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "createReadStream",
  "createWriteStream",
  "exists",
  "existsSync",
  "fchown",
  "fchownSync",
  "fchmod",
  "fchmodSync",
  "fdatasync",
  "fdatasyncSync",
  "fstat",
  "fstatSync",
  "fsync",
  "fsyncSync",
  "ftruncate",
  "ftruncateSync",
  "futimes",
  "futimesSync",
  "glob",
  "globSync",
  "lchown",
  "lchownSync",
  "lchmod",
  "lchmodSync",
  "link",
  "linkSync",
  "lstat",
  "lstatSync",
  "lutimes",
  "lutimesSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "mkdtempDisposableSync",
  "open",
  "openSync",
  "openAsBlob",
  "readdir",
  "readdirSync",
  "read",
  "readSync",
  "readv",
  "readvSync",
  "readFile",
  "readFileSync",
  "readlink",
  "readlinkSync",
  "realpath",
  "realpathSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "stat",
  "statfs",
  "statSync",
  "statfsSync",
  "symlink",
  "symlinkSync",
  "truncate",
  "truncateSync",
  "unwatchFile",
  "unlink",
  "unlinkSync",
  "utimes",
  "utimesSync",
  "watch",
  "watchFile",
  "writeFile",
  "writeFileSync",
  "write",
  "writeSync",
  "writev",
  "writevSync",
  "Dirent",
  "Stats",
  "ReadStream",
  "WriteStream",
  "FileReadStream",
  "FileWriteStream",
  "Utf8Stream",
  "_toUnixTimestamp",
  "Dir",
  "opendir",
  "opendirSync",
  "constants",
  "promises",
];

const promiseExportNames = [
  "access",
  "copyFile",
  "cp",
  "glob",
  "open",
  "opendir",
  "rename",
  "truncate",
  "rm",
  "rmdir",
  "mkdir",
  "readdir",
  "readlink",
  "symlink",
  "lstat",
  "stat",
  "statfs",
  "link",
  "unlink",
  "chmod",
  "lchmod",
  "lchown",
  "chown",
  "utimes",
  "lutimes",
  "realpath",
  "mkdtemp",
  "mkdtempDisposable",
  "writeFile",
  "appendFile",
  "readFile",
  "watch",
  "constants",
];

export function shape(exports) {
  const module = { ...exports };
  const promiseNamespace = { ...exports.promises };
  // FileHandle is the public result type of promises.open(), not a runtime
  // property of the node:fs/promises namespace.
  delete promiseNamespace.FileHandle;
  const promises = {};
  for (const name of promiseExportNames) promises[name] = promiseNamespace[name];
  module.promises = promises;
  module.Stats = callableStats(exports.Stats);
  module.ReadStream = callableReadStream(exports.ReadStream);
  module.WriteStream = callableWriteStream(exports.WriteStream);
  // Node retains these old names as separately writable CommonJS accessors.
  // Mutable export-object properties are outside the typed runtime model; the
  // ordinary read path is a direct alias to the same two constructors.
  module.FileReadStream = module.ReadStream;
  module.FileWriteStream = module.WriteStream;
  // Linux exposes the two platform-unavailable operations as enumerable
  // properties whose value is undefined; omitting the keys changes namespace
  // enumeration and permission allowlists even though neither is callable.
  module.lchmod = undefined;
  module.lchmodSync = undefined;
  // Function properties are a Node compatibility shape. The ordinary
  // realpath functions walk components in TypeScript; only `.native` takes
  // libuv's direct resolver.
  // Same guard as the callable helpers: a compiled fs publishes neither of
  // these yet, and `undefined.native = ...` reported a load failure for all 394
  // of the module's files rather than naming the export.
  if (module.realpath !== undefined) {
    module.realpath.native = exports._realpathNative;
  }
  if (module.realpathSync !== undefined) {
    module.realpathSync.native = exports._realpathSyncNative;
  }
  delete module._realpathNative;
  delete module._realpathSyncNative;
  delete module._BigIntStats;
  delete module._closeAsync;
  delete module._close;
  delete module._createBlobFromExternalSource;
  delete module._fstatBigIntColumns;
  delete module._fstatColumns;
  delete module._openAsync;
  delete module._open;
  delete module._openBytesAsync;
  delete module._openBytes;
  delete module._readAsync;
  delete module._statBigIntByteColumns;
  delete module._statBigIntColumns;
  delete module._statByteColumns;
  delete module._statColumns;
  delete module._validateRmOptionsSync;
  delete module.flagsOf;

  const ordered = {};
  for (const name of publicExportNames) ordered[name] = module[name];
  return ordered;
}

/** `node:fs/promises` is the exact same namespace exposed as `fs.promises`. */
export function subpaths(_exports, underTest) {
  return { "fs/promises": underTest.promises };
}

/** Private utilities explicitly exercised by otherwise applicable fs tests. */
export function internals(exports) {
  return {
    "internal/fs/utils": {
      BigIntStats: callableBigIntStats(exports._BigIntStats),
      stringToFlags: exports.flagsOf,
      toUnixTimestamp: exports._toUnixTimestamp,
      validateRmOptionsSync: exports._validateRmOptionsSync,
    },
  };
}

/** Node's internal constructor takes fourteen bigint columns positionally. */
function callableBigIntStats(Implementation) {
  // Same guard as callableStats above.
  if (Implementation === undefined) return undefined;
  function BigIntStats(
    dev,
    mode,
    nlink,
    uid,
    gid,
    rdev,
    blksize,
    ino,
    size,
    blocks,
    atimeNs,
    mtimeNs,
    ctimeNs,
    birthtimeNs,
  ) {
    return new Implementation(
      [
        dev,
        mode,
        nlink,
        uid,
        gid,
        rdev,
        blksize,
        ino,
        size,
        blocks,
        atimeNs,
        mtimeNs,
        ctimeNs,
        birthtimeNs,
      ].map(String),
    );
  }
  BigIntStats.prototype = Implementation.prototype;
  return BigIntStats;
}

/**
 * `fs.Stats` predates classes and remains callable with or without `new`, even
 * though direct construction is deprecated. The typed implementation remains
 * a class; this wrapper supplies only the legacy CommonJS constructor shape.
 */
function callableStats(Implementation) {
  // Same guard as callableStats above.
  if (Implementation === undefined) return undefined;
  // A compiled module may not publish this yet. Reaching through an absent
  // export turns "one export is missing" into "the module did not load" -- one
  // message for every test, naming nothing. See the same guard in buffer,
  // console, events, http, net, querystring, stream, timers, url, util, zlib.
  if (Implementation === undefined) return undefined;
  let warned = false;
  function Stats(...columns) {
    if (!warned) {
      warned = true;
      process.emitWarning("fs.Stats constructor is deprecated.", "DeprecationWarning", "DEP0180");
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
  // Same guard as callableStats above.
  if (Implementation === undefined) return undefined;
  function ReadStream(path, options) {
    return new Implementation(path, options);
  }
  Object.setPrototypeOf(ReadStream, Implementation);
  ReadStream.prototype = Implementation.prototype;
  return ReadStream;
}

function callableWriteStream(Implementation) {
  // Same guard as callableStats above.
  if (Implementation === undefined) return undefined;
  function WriteStream(path, options) {
    return new Implementation(path, options);
  }
  Object.setPrototypeOf(WriteStream, Implementation);
  WriteStream.prototype = Implementation.prototype;
  return WriteStream;
}
