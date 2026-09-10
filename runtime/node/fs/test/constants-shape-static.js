"use strict";

// `fs.constants` is an ordinary object, not an ESM module namespace.
//
// `constants.ts` is reached with `import * as constants`, and a module namespace
// object is frozen and carries `Symbol.toStringTag` of `"Module"` by
// specification. Node's is neither:
//
//                        node        here, before
//     Symbol.toStringTag undefined   "Module"
//     isExtensible       true        false
//
// Node's *is* null-prototyped, which is why the shim rebuilds it that way rather
// than with `{ ... }` -- measured against node rather than assumed, because
// `stream.promises` is the same class of defect and has `Object.prototype`.
//
// Nothing upstream asserts it: on node there is no namespace object anywhere near
// this value, so there is nothing for node's suite to rule out.

require("../common");
const assert = require("assert");
const fs = require("fs");
const fsPromises = require("fs/promises");

for (const [name, table] of [["fs.constants", fs.constants], ["fs.promises.constants", fsPromises.constants]]) {
  assert.strictEqual(table[Symbol.toStringTag], undefined, `${name} must carry no toStringTag`);
  assert.strictEqual(Object.isExtensible(table), true, `${name} must be extensible`);
  assert.strictEqual(Object.getPrototypeOf(table), null, `${name} must be null-prototyped, as node's is`);
  assert.strictEqual(typeof table.O_RDONLY, "number", `${name} must still hold its values`);
}
assert.strictEqual(fs.constants.O_RDONLY, fsPromises.constants.O_RDONLY);
