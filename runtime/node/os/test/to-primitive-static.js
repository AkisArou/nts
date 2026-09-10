"use strict";

// `${os.arch}` is `"x64"` on node, with no call written anywhere.
//
// Node gives its zero-argument, primitive-returning `os` functions a
// `Symbol.toPrimitive` that answers what calling them answers. The split is
// uniform, which is why it is asserted as a rule and not as a list: exactly the
// fourteen below have it, and the six that do not -- `cpus`, `getPriority`,
// `loadavg`, `networkInterfaces`, `setPriority`, `userInfo` -- are precisely the
// ones that take an argument or return an object, where a primitive conversion
// has nowhere to put either.
//
// Nothing upstream asserts it. On node the property is installed beside the
// definition and cannot be absent, so node's suite has nothing to check.

require("../common");
const assert = require("assert");
const os = require("os");

const WITH = [
  "arch", "availableParallelism", "endianness", "freemem", "homedir",
  "hostname", "platform", "release", "tmpdir", "totalmem", "type",
  "uptime", "version", "machine",
];
const WITHOUT = [
  "cpus", "getPriority", "loadavg", "networkInterfaces", "setPriority", "userInfo",
];

for (const name of WITH) {
  const fn = os[name];
  assert.strictEqual(typeof fn[Symbol.toPrimitive], "function", `os.${name}[Symbol.toPrimitive]`);
  assert.strictEqual(
    String(fn[Symbol.toPrimitive]()),
    String(fn()),
    `os.${name}[Symbol.toPrimitive]() must answer what os.${name}() answers`,
  );
  // Node's descriptor is a plain assignment's, not a defineProperty's.
  const descriptor = Object.getOwnPropertyDescriptor(fn, Symbol.toPrimitive);
  assert.strictEqual(descriptor.writable, true, `os.${name} toPrimitive writable`);
  assert.strictEqual(descriptor.enumerable, true, `os.${name} toPrimitive enumerable`);
  assert.strictEqual(descriptor.configurable, true, `os.${name} toPrimitive configurable`);
}

for (const name of WITHOUT) {
  assert.strictEqual(
    typeof os[name][Symbol.toPrimitive],
    "undefined",
    `os.${name} must not have Symbol.toPrimitive`,
  );
}

// The point of the property, in the form a user meets it.
assert.strictEqual(`${os.arch}`, os.arch());
assert.strictEqual(typeof +os.freemem, "number");
