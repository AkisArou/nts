"use strict";

// A `Dirent` has exactly node's own keys, and its kind is not one of them.
//
//     node   ["name", "parentPath"]
//     ours   ["name", "parentPath", "type"]   before this
//
// `private type` in TypeScript is compile-time only, so the field was an own
// enumerable key on every entry `readdirSync(…, { withFileTypes: true })`
// returns. `"type" in dirent` is false on node.
//
// Nothing upstream asserts it: node's `Dirent` cannot grow a key, so node's suite
// has nothing to check, and none of its tests reads a `Dirent`'s kind other than
// through the predicates. Which is the design -- the ten `isFile`/`isDirectory`/…
// methods are the whole interface, on node and here.

require("../common");
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const entries = fs.readdirSync(path.dirname(__dirname), { withFileTypes: true });
assert.ok(entries.length > 0, "the fixture needs a non-empty directory");

for (const entry of entries) {
  assert.deepStrictEqual(
    Object.keys(entry).sort(),
    ["name", "parentPath"],
    "a Dirent's own keys are node's two and nothing else",
  );
  assert.strictEqual("type" in entry, false, "the kind must not be reachable");
}

// The predicates still work, which is the half a `#` field could have broken.
const self = entries.find((e) => e.name === "test");
assert.ok(self !== undefined, "the fixture expects a `test` directory beside it");
assert.strictEqual(self.isDirectory(), true);
assert.strictEqual(self.isFile(), false);
assert.strictEqual(self.isSymbolicLink(), false);
