// The object node's tests see as `require('os')`.
//
// `EOL` and `devNull` are not writable on node's module -- `test-os-eol.js`
// asserts that assigning to `os.EOL` throws in strict mode -- and an ESM
// export copied into a plain object is. Node defines them with
// `ObjectDefineProperties` on `module.exports`, so this is the same step in
// the same place, not a workaround.
//
// Node publishes null-prototype constant tables and freezes `signals`. Copying
// into that public shape leaves the statically assembled TypeScript records
// ordinary and keeps all metaobject work at this host boundary.
export function shape(exports) {
  const copyTable = (table) => Object.assign(Object.create(null), table);
  const constants = Object.assign(Object.create(null), {
    UV_UDP_REUSEADDR: exports.constants.UV_UDP_REUSEADDR,
    dlopen: copyTable(exports.constants.dlopen),
    errno: copyTable(exports.constants.errno),
    signals: copyTable(exports.constants.signals),
    priority: copyTable(exports.constants.priority),
  });
  Object.freeze(constants.signals);

  // `lib/os.js` publishes this exact insertion order. ESM namespace objects
  // are sorted, so spell out the CommonJS surface instead of spreading one.
  const os = {
    arch: exports.arch,
    availableParallelism: exports.availableParallelism,
    cpus: exports.cpus,
    endianness: exports.endianness,
    freemem: exports.freemem,
    getPriority: exports.getPriority,
    homedir: exports.homedir,
    hostname: exports.hostname,
    loadavg: exports.loadavg,
    networkInterfaces: exports.networkInterfaces,
    platform: exports.platform,
    release: exports.release,
    setPriority: exports.setPriority,
    tmpdir: exports.tmpdir,
    totalmem: exports.totalmem,
    type: exports.type,
    userInfo: exports.userInfo,
    uptime: exports.uptime,
    version: exports.version,
    machine: exports.machine,
  };
  Object.defineProperty(os, "constants", {
    configurable: false,
    enumerable: true,
    value: constants,
  });
  for (const [name, value] of [
    ["EOL", exports.EOL],
    ["devNull", exports.devNull],
  ]) {
    Object.defineProperty(os, name, {
      configurable: true,
      enumerable: true,
      writable: false,
      value,
    });
  }
  return os;
}
