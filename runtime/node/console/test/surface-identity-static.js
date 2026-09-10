"use strict";

// Which console names are backed by the *same function object*, and what each
// one is called. Node has no reason to assert this: the invariant is a
// consequence of how its constructor builds an instance, not a behaviour anyone
// reported.
//
// Node's prototype really does alias two pairs --
//
//     Console.prototype.dirxml = Console.prototype.log;
//     Console.prototype.groupCollapsed = Console.prototype.group;
//
// -- and reading only that led this module to do the same. But the constructor
// then walks `ObjectKeys(Console.prototype)`, binds each method to the instance
// and redefines `.name` to the key it was found under, so no object any test can
// reach is shared and every one carries its own name. The prototype is aliased;
// the surface is not.
//
// Before this was written, ours had `dirxml === log` with `dirxml.name` of
// `"log"`, and `profile`, `profileEnd` and `timeStamp` were three references to
// one `noopLabel` reporting `length` 1 where node reports 0. Every existing test
// passed: the behaviour was right and only identity and naming were wrong.

require("../common");
const assert = require("assert");
const { Console } = require("console");
const { Writable } = require("stream");

const sink = () => new Writable({ write(chunk, encoding, cb) { cb(); } });
const console_ = new Console(sink());

// Distinct objects, in the pairs node's prototype aliases and its constructor
// then separates.
assert.notStrictEqual(console_.dirxml, console_.log);
assert.notStrictEqual(console_.groupCollapsed, console_.group);

// The three global-only markers are three functions, not three names for one.
const markers = [console.profile, console.profileEnd, console.timeStamp];
for (let i = 0; i < markers.length; i++) {
  for (let j = i + 1; j < markers.length; j++) {
    assert.notStrictEqual(markers[i], markers[j]);
  }
}

// Each carries its own name, and the arity node reports.
for (const [name, length] of [
  ["log", 0], ["dirxml", 0], ["group", 0], ["groupCollapsed", 0],
]) {
  assert.strictEqual(console_[name].name, name, `${name}.name`);
  assert.strictEqual(console_[name].length, length, `${name}.length`);
}
for (const name of ["profile", "profileEnd", "timeStamp"]) {
  assert.strictEqual(console[name].name, name, `${name}.name`);
  assert.strictEqual(console[name].length, 0, `${name}.length`);
}

// Identity is not the whole contract: the aliases must still do what the names
// they alias do, and reach the same `log` node's do.
{
  const seen = [];
  const out = new Writable({
    write(chunk, encoding, cb) { seen.push(chunk.toString()); cb(); },
  });
  const c = new Console(out);
  c.log("x", 1);
  const viaLog = seen.join("");
  seen.length = 0;
  c.dirxml("x", 1);
  assert.strictEqual(seen.join(""), viaLog, "dirxml must print what log prints");
}

// `dirxml` does not route through the current `.log`; `groupCollapsed` does.
// Measured against node, which answers 0 and 1 respectively.
{
  const c = new Console(sink());
  let calls = 0;
  const original = c.log;
  c.log = function (...args) { calls++; return original(...args); };
  c.dirxml("y");
  assert.strictEqual(calls, 0, "dirxml must not dispatch through a replaced .log");
  c.groupCollapsed("y");
  assert.strictEqual(calls, 1, "groupCollapsed must reach the replaced .log");
}

// And `groupCollapsed` does not route through the current `.group`.
{
  const c = new Console(sink());
  let calls = 0;
  const original = c.group;
  c.group = function (...args) { calls++; return original(...args); };
  c.groupCollapsed("y");
  assert.strictEqual(calls, 0, "groupCollapsed must not dispatch through a replaced .group");
}
