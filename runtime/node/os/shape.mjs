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

  // `constants` may be absent, and a shape that dereferences it anyway turns a
  // partially published addon into a module that cannot load at all.
  //
  // That is not hypothetical: the compiled `os` publishes 17 of the 23 names
  // this shape wants, and every one of its seven applicable test files failed
  // with "Cannot read properties of undefined (reading 'UV_UDP_REUSEADDR')" --
  // one message, at load, for tests that never touch `constants`. **A shape that
  // throws on a missing export reports one fact about the addon and hides seven.**
  //
  // Absence is not being swallowed here: `sweep.mjs` computes the names a
  // module's shape needs against the names its addon publishes and reports the
  // difference, so a missing `constants` is already named by the instrument
  // whose job that is. What this stops is one absence masquerading as total
  // failure.
  const rawConstants = exports.constants;
  const constants = rawConstants === undefined
    ? undefined
    : Object.assign(Object.create(null), {
      UV_UDP_REUSEADDR: rawConstants.UV_UDP_REUSEADDR,
      dlopen: copyTable(rawConstants.dlopen),
      errno: copyTable(rawConstants.errno),
      signals: copyTable(rawConstants.signals),
      priority: copyTable(rawConstants.priority),
    });
  if (constants !== undefined) Object.freeze(constants.signals);

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
  // Node gives its zero-argument, primitive-returning `os` functions a
  // `Symbol.toPrimitive` that answers what calling them answers, so `${os.arch}`
  // is `"x64"` and `+os.freemem` is a number without a call anywhere in sight.
  //
  // The split is uniform and is the reason to state it as a rule rather than a
  // list: exactly these fourteen have it, and the six that do not --
  // `cpus`, `getPriority`, `loadavg`, `networkInterfaces`, `setPriority`,
  // `userInfo` -- are precisely the ones that take an argument or return an
  // object. A primitive conversion has nowhere to put either.
  //
  // Plain assignment rather than `defineProperty`, because node's descriptor is
  // `{ writable: true, enumerable: true, configurable: true }`, which is what an
  // assignment produces. Measured rather than matched by eye.
  for (const name of [
    "arch", "availableParallelism", "endianness", "freemem", "homedir",
    "hostname", "platform", "release", "tmpdir", "totalmem", "type",
    "uptime", "version", "machine",
  ]) {
    const fn = os[name];
    if (typeof fn !== "function") continue;
    fn[Symbol.toPrimitive] = () => fn();
  }
  return os;
}
