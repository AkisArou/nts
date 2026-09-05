// Retained from pinned upstream `parallel/test-console.js`.
// The upstream file invokes Symbol-based util.inspect.custom, observes the
// hook function's metadata, and coerces non-string timer labels through
// ToPrimitive. This keeps every ordinary typed console path from that file.
"use strict";

const common = require("../common");

const assert = require("assert");
const { Console } = require("console");

let stdout = "";
let stderr = "";
const out = {
  write(data) {
    stdout += data;
  },
  removeListener() {},
};
const err = {
  write(data) {
    stderr += data;
  },
  removeListener() {},
};
const instance = new Console(out, err, false);

for (const method of [instance.log, instance.debug, instance.info]) {
  method("foo");
  method("foo", "bar");
  method("%s %s", "foo", "bar", "hop");
  method({ slashes: "\\\\" });
}
const ordinaryOutput = "foo\n" + "foo bar\n" + "foo bar hop\n" + "{ slashes: '\\\\\\\\' }\n";
assert.strictEqual(stdout, ordinaryOutput.repeat(3));

for (const method of [instance.error, instance.warn]) {
  method("foo");
  method("foo", "bar");
  method("%s %s", "foo", "bar", "hop");
  method({ slashes: "\\\\" });
}
assert.strictEqual(stderr, ordinaryOutput.repeat(2));

stdout = "";
instance.dir({ foo: 1 });
assert.strictEqual(stdout, "{ foo: 1 }\n");

stdout = "";
instance.dirxml(
  { foo: { bar: { baz: true } } },
  { foo: { bar: { quux: false } } },
  { foo: { bar: { quux: true } } },
);
assert.ok(stdout.includes("baz: true"));
assert.ok(stdout.includes("quux: false"));
assert.ok(stdout.includes("quux: true"));

stderr = "";
instance.assert(true, "not printed");
instance.assert(false);
instance.assert(false, "%s failed", "check");
assert.strictEqual(stderr, "Assertion failed\nAssertion failed: check failed\n");

stderr = "";
instance.trace("This is a %j %d", { formatted: "trace" }, 10, "foo");
assert.match(stderr, /^Trace: This is a \{"formatted":"trace"\} 10 foo\n/);

stdout = "";
instance.dir({ foo: { bar: { baz: true } } }, { depth: 0 });
instance.dir({ foo: { bar: { baz: true } } }, { depth: 1 });
const directoryLines = stdout.trim().split("\n");
assert.ok(directoryLines[0].includes("foo: [Object]"));
assert.strictEqual(directoryLines[0].includes("baz"), false);
assert.ok(stdout.includes("foo: { bar: [Object] }"));

stdout = "";
instance.time("elapsed");
instance.timeLog("elapsed", "data");
instance.timeEnd("elapsed");
const lines = stdout.trim().split("\n");
assert.match(lines[0], /^elapsed: \d+(\.\d{1,3})?(ms|s) data$/);
assert.match(lines[1], /^elapsed: \d+(\.\d{1,3})?(ms|s)$/);
assert.strictEqual(instance._times.has("elapsed"), false);

stdout = "";
for (const label of ["__proto__", "constructor", "hasOwnProperty"]) {
  instance.time(label);
  instance.timeEnd(label);
}
const specialLabelLines = stdout.trim().split("\n");
assert.match(specialLabelLines[0], /^__proto__: \d+(\.\d{1,3})?(ms|s)$/);
assert.match(specialLabelLines[1], /^constructor: \d+(\.\d{1,3})?(ms|s)$/);
assert.match(specialLabelLines[2], /^hasOwnProperty: \d+(\.\d{1,3})?(ms|s)$/);

stdout = "";
instance.time("log");
instance.timeLog("log");
instance.timeLog("log", "test");
instance.timeLog("log", {}, [1, 2, 3]);
instance.timeEnd("log");
const logLines = stdout.trim().split("\n");
assert.match(logLines[0], /^log: \d+(\.\d{1,3})?(ms|s)$/);
assert.match(logLines[1], /^log: \d+(\.\d{1,3})?(ms|s) test$/);
assert.match(logLines[2], /^log: \d+(\.\d{1,3})?(ms|s) {} \[ 1, 2, 3 \]$/);
assert.match(logLines[3], /^log: \d+(\.\d{1,3})?(ms|s)$/);

const timesMapSize = instance._times.size;
for (const label of ["first", "second", "third"]) instance.time(label);
for (const label of ["first", "second", "third"]) instance.timeEnd(label);
assert.strictEqual(instance._times.size, timesMapSize);

// `parallel/test-console.js` checks these alongside its Symbol-based custom
// inspection cases. Keep the ordinary warning contract even though that file
// cannot run as a whole in the static profile.
common.expectWarning("Warning", [
  ["Count for 'missing' does not exist", undefined],
  ["No such label 'missing' for console.timeLog()", undefined],
  ["No such label 'missing' for console.timeEnd()", undefined],
  ["Count for 'default' does not exist", undefined],
  ["No such label 'default' for console.timeLog()", undefined],
  ["No such label 'default' for console.timeEnd()", undefined],
  ["Label 'default' already exists for console.time()", undefined],
  ["Label 'duplicate' already exists for console.time()", undefined],
]);
instance.countReset("missing");
instance.timeLog("missing");
instance.timeEnd("missing");
instance.countReset();
instance.timeLog();
instance.timeEnd();
instance.time();
const defaultTimestamp = instance._times.get("default");
instance.time();
assert.strictEqual(instance._times.get("default"), defaultTimestamp);
instance.timeEnd();
instance.time("duplicate");
const duplicateTimestamp = instance._times.get("duplicate");
instance.time("duplicate");
assert.strictEqual(instance._times.get("duplicate"), duplicateTimestamp);
instance.timeEnd("duplicate");
