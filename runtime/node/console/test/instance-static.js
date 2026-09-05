// Retained from pinned upstream `parallel/test-console-instance.js`.
// Calling a class without `new` and discovering/binding subclass prototype
// overrides require the §13 metaobject model. This keeps the typed constructor,
// stream validation, instance identity, detached calls, and error policy.
"use strict";

const common = require("../common");
const assert = require("assert");
const requiredConsole = require("console");
const { Console } = requiredConsole;

assert.strictEqual(requiredConsole, globalThis.console);
assert.strictEqual(typeof Console, "function");
assert.ok(globalThis.console instanceof Console);
assert.ok(!({} instanceof Console));

assert.throws(() => new Console(), {
  code: "ERR_CONSOLE_WRITABLE_STREAM",
  name: "TypeError",
  message: /stdout/,
});

const out = { write() {}, removeListener() {} };
const err = { write() {}, removeListener() {} };

assert.throws(() => new Console(out, {}), {
  code: "ERR_CONSOLE_WRITABLE_STREAM",
  name: "TypeError",
  message: /stderr/,
});

const instance = new Console(out, err);
assert.ok(instance instanceof Console);
for (const method of ["profile", "profileEnd", "timeStamp"]) {
  assert.strictEqual(typeof globalThis.console[method], "function");
  assert.strictEqual(instance[method], undefined);
}

let call = 0;
out.write = common.mustCall((data) => {
  call++;
  assert.strictEqual(data, `${call} ${call - 1} [ 1, 2, 3 ]\n`);
}, 3);
[1, 2, 3].forEach(instance.log);

const strict = new Console(out, err, false);
out.write = () => {
  throw new Error("out");
};
err.write = () => {
  throw new Error("err");
};
assert.throws(() => strict.log("foo"), /^Error: out$/);
assert.throws(() => strict.warn("foo"), /^Error: err$/);
assert.throws(() => strict.dir("foo"), /^Error: out$/);

for (const inspectOptions of [null, true, false, "foo", 5, Symbol()]) {
  assert.throws(() => new Console({ stdout: out, stderr: err, inspectOptions }), {
    code: "ERR_INVALID_ARG_TYPE",
  });
}
